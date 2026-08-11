// Package accrual posts daily interest on locked savings pockets
// (internal/wallet/savings.go). Same periodic-goroutine shape as
// internal/outbox — one process, started alongside it in cmd/ledger.
//
// Idempotency is the ledger's existing idempotency-key uniqueness, not
// anything this package tracks itself: each day's posting for an account
// uses idempotencyKey "interest:{accountId}:{YYYY-MM-DD}", so a rerun on
// the same day (a retry, a restart, a shorter-than-24h poll interval
// during testing) is a safe no-op rather than a double-credit.
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
	var accounts []domain.LedgerAccount
	var interestExpenseAccountID string

	err := dbctx.WithTenant(ctx, c.pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		list, err := account.ListByProductType(ctx, tx, tenantID, wallet.SavingsProductType)
		if err != nil {
			return err
		}
		accounts = list
		if len(accounts) == 0 {
			return nil
		}

		interestAcc, _, err := account.GetByAccountNumber(ctx, tx, tenantID, tenant.InterestExpenseAccountNumber)
		if err != nil {
			return fmt.Errorf("interest expense account missing for tenant %s: %w", tenantID, err)
		}
		interestExpenseAccountID = interestAcc.ID
		return nil
	})
	if err != nil {
		return err
	}

	today := time.Now().UTC().Format("2006-01-02")
	for _, acc := range accounts {
		if err := c.postDailyInterest(ctx, tenantID, interestExpenseAccountID, acc, today); err != nil {
			log.Printf("accrual: account %s: %v", acc.ID, err)
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
