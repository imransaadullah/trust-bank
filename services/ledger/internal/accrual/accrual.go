// Package accrual posts daily interest on two product types: locked
// savings pockets (internal/wallet/savings.go — interest paid TO the
// customer) and active loans (internal/loan — interest owed BY the
// customer, the reversed direction: debit the loan, credit interest
// income instead of debit expense, credit savings). Same periodic-
// goroutine shape as internal/outbox — one process, started alongside it
// in cmd/ledger.
//
// Idempotency is the ledger's existing idempotency-key uniqueness, not
// anything this package tracks itself: each day's posting for an account
// uses a per-product idempotencyKey ("interest:{accountId}:{YYYY-MM-DD}"
// for savings, "loan-interest:{accountId}:{YYYY-MM-DD}" for loans), so a
// rerun on the same day (a retry, a restart, a shorter-than-24h poll
// interval during testing) is a safe no-op rather than a double-credit.
package accrual

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/loan"
	"trustbank/ledger/internal/tenant"
	"trustbank/ledger/internal/wallet"
)

type Consumer struct {
	pool      *pgxpool.Pool
	pollEvery time.Duration
}

func NewConsumer(pool *pgxpool.Pool, pollEvery time.Duration) *Consumer {
	if pollEvery <= 0 {
		pollEvery = 24 * time.Hour
	}
	return &Consumer{pool: pool, pollEvery: pollEvery}
}

// Run polls until ctx is cancelled. Meant to be started as a goroutine
// alongside the HTTP server and the outbox consumer.
func (c *Consumer) Run(ctx context.Context) {
	ticker := time.NewTicker(c.pollEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.RunOnce(ctx); err != nil {
				log.Printf("accrual: run error: %v", err)
			}
		}
	}
}

// RunOnce accrues one day's interest for every active tenant's savings
// accounts. Exported so tests (and an eventual admin trigger) can call it
// directly instead of waiting on the poll interval.
func (c *Consumer) RunOnce(ctx context.Context) error {
	tenantIDs, err := c.listActiveTenantIDs(ctx)
	if err != nil {
		return fmt.Errorf("accrual: list tenants: %w", err)
	}
	for _, tenantID := range tenantIDs {
		if err := c.accrueTenant(ctx, tenantID); err != nil {
			log.Printf("accrual: tenant %s: %v", tenantID, err)
		}
	}
	return nil
}

func (c *Consumer) listActiveTenantIDs(ctx context.Context) ([]string, error) {
	rows, err := c.pool.Query(ctx, `SELECT id FROM tenants WHERE status = 'ACTIVE'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (c *Consumer) accrueTenant(ctx context.Context, tenantID string) error {
	var savingsAccounts, loanAccounts []domain.LedgerAccount
	var interestExpenseAccountID, interestIncomeAccountID string
	var provisionExpenseAccountID, reserveAccountID string

	err := dbctx.WithTenant(ctx, c.pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		savingsList, err := account.ListByProductType(ctx, tx, tenantID, wallet.SavingsProductType)
		if err != nil {
			return err
		}
		savingsAccounts = savingsList

		loanList, err := account.ListByProductType(ctx, tx, tenantID, loan.LoanProductType)
		if err != nil {
			return err
		}
		loanAccounts = loanList

		if len(savingsAccounts) == 0 && len(loanAccounts) == 0 {
			return nil
		}

		if len(savingsAccounts) > 0 {
			interestAcc, _, err := account.GetByAccountNumber(ctx, tx, tenantID, tenant.InterestExpenseAccountNumber)
			if err != nil {
				return fmt.Errorf("interest expense account missing for tenant %s: %w", tenantID, err)
			}
			interestExpenseAccountID = interestAcc.ID
		}
		if len(loanAccounts) > 0 {
			incomeAcc, _, err := account.GetByAccountNumber(ctx, tx, tenantID, tenant.InterestIncomeAccountNumber)
			if err != nil {
				return fmt.Errorf("interest income account missing for tenant %s: %w", tenantID, err)
			}
			interestIncomeAccountID = incomeAcc.ID

			// Loan-loss accounts, unlike interest income, don't exist for
			// every tenant that has loans: a tenant provisioned before this
			// slice shipped needs cmd/backfill-loan-loss-accounts run once.
			// Log and skip provisioning for this tenant rather than failing
			// interest accrual (savings and loan) along with it — the
			// backfill closes the gap, not a hard dependency on it existing.
			if provisionAcc, _, err := account.GetByAccountNumber(ctx, tx, tenantID, tenant.LoanLossProvisionAccountNumber); err == nil {
				provisionExpenseAccountID = provisionAcc.ID
			} else {
				log.Printf("accrual: tenant %s: loan loss provision account missing, skipping provisioning (run cmd/backfill-loan-loss-accounts): %v", tenantID, err)
			}
			if reserveAcc, _, err := account.GetByAccountNumber(ctx, tx, tenantID, tenant.LoanLossReserveAccountNumber); err == nil {
				reserveAccountID = reserveAcc.ID
			} else {
				log.Printf("accrual: tenant %s: loan loss reserve account missing, skipping provisioning (run cmd/backfill-loan-loss-accounts): %v", tenantID, err)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}

	today := time.Now().UTC().Format("2006-01-02")
	for _, acc := range savingsAccounts {
		if err := c.postDailyInterest(ctx, tenantID, interestExpenseAccountID, acc, today); err != nil {
			log.Printf("accrual: savings account %s: %v", acc.ID, err)
		}
	}
	for _, acc := range loanAccounts {
		if err := c.postLoanInterest(ctx, tenantID, interestIncomeAccountID, acc, today); err != nil {
			log.Printf("accrual: loan account %s: %v", acc.ID, err)
		}
		if provisionExpenseAccountID != "" && reserveAccountID != "" {
			if err := c.postLoanProvision(ctx, tenantID, provisionExpenseAccountID, reserveAccountID, acc, today); err != nil {
				log.Printf("accrual: loan provision %s: %v", acc.ID, err)
			}
		}
	}
	return nil
}

func (c *Consumer) postDailyInterest(ctx context.Context, tenantID, interestExpenseAccountID string, acc domain.LedgerAccount, today string) error {
	var meta wallet.SavingsMetadata
	if err := json.Unmarshal(acc.Metadata, &meta); err != nil {
		return fmt.Errorf("unmarshal metadata for %s: %w", acc.ID, err)
	}

	bal, err := ledger.GetBalance(ctx, c.pool, tenantID, acc.ID)
	if err != nil {
		return fmt.Errorf("get balance for %s: %w", acc.ID, err)
	}
	if bal.Amount <= 0 {
		return nil
	}

	dailyInterest := bal.Amount * int64(meta.AnnualRateBps) / 10_000 / 365
	if dailyInterest <= 0 {
		return nil
	}

	idempotencyKey := fmt.Sprintf("interest:%s:%s", acc.ID, today)
	_, err = ledger.PostJournalEntry(ctx, c.pool, ledger.PostInput{
		TenantID: tenantID, Reference: idempotencyKey, IdempotencyKey: idempotencyKey,
		EntryType: "interest_accrual", Description: fmt.Sprintf("Daily interest accrual (%s)", today),
		Lines: []ledger.LineInput{
			{LedgerAccountID: interestExpenseAccountID, Direction: domain.Debit, Amount: dailyInterest},
			{LedgerAccountID: acc.ID, Direction: domain.Credit, Amount: dailyInterest},
		},
	})
	return err
}

// postLoanInterest is postDailyInterest's mirror image: a loan accrues
// interest the customer owes, so the direction is reversed — debit the
// loan (receivable increases), credit interest income, instead of debit
// expense, credit savings.
func (c *Consumer) postLoanInterest(ctx context.Context, tenantID, interestIncomeAccountID string, acc domain.LedgerAccount, today string) error {
	var meta loan.LoanMetadata
	if err := json.Unmarshal(acc.Metadata, &meta); err != nil {
		return fmt.Errorf("unmarshal metadata for %s: %w", acc.ID, err)
	}

	bal, err := ledger.GetBalance(ctx, c.pool, tenantID, acc.ID)
	if err != nil {
		return fmt.Errorf("get balance for %s: %w", acc.ID, err)
	}
	if bal.Amount <= 0 {
		return nil
	}

	dailyInterest := bal.Amount * int64(meta.AnnualRateBps) / 10_000 / 365
	if dailyInterest <= 0 {
		return nil
	}

	idempotencyKey := fmt.Sprintf("loan-interest:%s:%s", acc.ID, today)
	_, err = ledger.PostJournalEntry(ctx, c.pool, ledger.PostInput{
		TenantID: tenantID, Reference: idempotencyKey, IdempotencyKey: idempotencyKey,
		EntryType: "loan_interest_accrual", Description: fmt.Sprintf("Daily loan interest accrual (%s)", today),
		Lines: []ledger.LineInput{
			{LedgerAccountID: acc.ID, Direction: domain.Debit, Amount: dailyInterest},
			{LedgerAccountID: interestIncomeAccountID, Direction: domain.Credit, Amount: dailyInterest},
		},
	})
	return err
}

// provisionRateBps is a fixed default expected-credit-loss matrix keyed
// by loan.Bucket — a per-tenant configurable matrix is real future scope
// (same "fixed for now, not built speculatively" stance already taken for
// RBAC's role set), and the Ledger can't fetch one from Compliance
// without breaking the "never calls another service" rule.
var provisionRateBps = map[string]int64{
	"current": 0,
	"1-30":    100,  // 1%
	"31-60":   1000, // 10%
	"61-90":   2500, // 25%
	"90+":     5000, // 50%
}

// postLoanProvision trues up this loan's loan-loss reserve to the target
// implied by its current delinquency bucket. Only ever posts an
// *incremental* delta (today's target minus what's already reserved), and
// deliberately one-directional: a loan that cures or is repaid keeps
// whatever reserve it already accumulated rather than reversing it
// automatically (named follow-up, not built in this slice) — which also
// means target is monotonically non-decreasing for this loan's lifetime,
// making it safe to key idempotency off the target itself rather than the
// date. That distinction matters: a *date*-keyed idempotency key (this
// package's other idempotency keys all use "today") breaks here, because
// postWithinTx's existing dedup-by-key behavior silently returns the
// first entry posted under a key without erroring — caught live during
// this slice's own verification (a faster-than-24h poll interval let the
// bucket advance twice in one calendar day; the date-keyed version's
// second post silently no-opped against the first day's entry while
// still advancing meta.ProvisionedKobo to the new target, permanently
// understating the reserve actually on the books).
func (c *Consumer) postLoanProvision(ctx context.Context, tenantID, provisionExpenseAccountID, reserveAccountID string, acc domain.LedgerAccount, today string) error {
	var meta loan.LoanMetadata
	if err := json.Unmarshal(acc.Metadata, &meta); err != nil {
		return fmt.Errorf("unmarshal metadata for %s: %w", acc.ID, err)
	}

	bal, err := ledger.GetBalance(ctx, c.pool, tenantID, acc.ID)
	if err != nil {
		return fmt.Errorf("get balance for %s: %w", acc.ID, err)
	}
	if bal.Amount <= 0 {
		return nil
	}

	daysPastDue := loan.DaysPastDue(meta, time.Now().UTC())
	rateBps := provisionRateBps[loan.Bucket(daysPastDue)]
	target := bal.Amount * rateBps / 10_000
	delta := target - meta.ProvisionedKobo
	if delta <= 0 {
		return nil
	}

	idempotencyKey := fmt.Sprintf("loan-provision:%s:%d", acc.ID, target)
	_, err = ledger.PostJournalEntry(ctx, c.pool, ledger.PostInput{
		TenantID: tenantID, Reference: idempotencyKey, IdempotencyKey: idempotencyKey,
		EntryType: "loan_loss_provision", Description: fmt.Sprintf("Loan loss provision, %s bucket (%s)", loan.Bucket(daysPastDue), today),
		Lines: []ledger.LineInput{
			{LedgerAccountID: provisionExpenseAccountID, Direction: domain.Debit, Amount: delta},
			{LedgerAccountID: reserveAccountID, Direction: domain.Credit, Amount: delta},
		},
	})
	if err != nil {
		return err
	}

	meta.ProvisionedKobo = target
	metaJSON, err := json.Marshal(meta)
	if err == nil {
		_ = dbctx.WithTenant(ctx, c.pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
			_, execErr := tx.Exec(ctx, `UPDATE ledger_accounts SET metadata = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
				tenantID, acc.ID, metaJSON)
			return execErr
		})
	}
	return nil
}
