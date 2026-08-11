// Locked savings pockets — a second ledger-account product type per
// customer, layered on the same generic journal-entry primitive P2P and
// deposits already use. No new ledger concept needed to move money in or
// out; the only new things are the account itself and the maturity check.
//
// Deliberately not gated by services/compliance: moving money between a
// customer's own wallet and their own savings pocket never leaves the
// institution's control — it isn't a CBN daily-limit "transaction" the
// way P2P or an external withdrawal is, and a compromised device can't
// drain a pocket to a third party by funding or withdrawing it (the
// money stays internal either way). See COMPLIANCE_DESIGN_AND_BACKLOG.md.
package wallet

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/coa"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/tenant"
)

// SavingsProductType distinguishes a savings pocket from a customer's
// single wallet account — a customer can have many of these, unlike the
// wallet (see account.ListByExternalCustomerIDAndProduct).
const SavingsProductType = "savings_locked"

// SavingsMetadata is what gets marshaled into a savings LedgerAccount's
// metadata column at open time — internal_accrual.RunOnce reads
// AnnualRateBps back out of it for interest calculation, and
// WithdrawSavings reads LockedUntil for the maturity check.
type SavingsMetadata struct {
	AnnualRateBps int       `json:"annualRateBps"`
	LockedUntil   time.Time `json:"lockedUntil"`
}

type OpenSavingsAccountInput struct {
	TenantID           string
	ExternalCustomerID string
	AnnualRateBps      int
	LockDays           int
	PrincipalKobo      int64
	Reference          string
	IdempotencyKey     string
	Description        string
}

// OpenSavingsAccount creates a new locked savings pocket and immediately
// funds it from the customer's wallet in the same call — two ledger
// primitives composed (account.Open, then a generic journal entry), not
// a new one.
func OpenSavingsAccount(ctx context.Context, pool *pgxpool.Pool, in OpenSavingsAccountInput) (*domain.LedgerAccount, *domain.JournalEntry, error) {
	meta := SavingsMetadata{
		AnnualRateBps: in.AnnualRateBps,
		LockedUntil:   time.Now().Add(time.Duration(in.LockDays) * 24 * time.Hour),
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return nil, nil, fmt.Errorf("wallet: marshal savings metadata: %w", err)
	}

	var savingsAcc *domain.LedgerAccount
	err = dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		depositsGL, err := coa.ByCode(ctx, tx, in.TenantID, tenant.CustomerDepositsGLCode)
		if err != nil {
			return fmt.Errorf("wallet: chart of accounts not seeded for tenant %s: %w", in.TenantID, err)
		}

		opened, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: in.TenantID, GLAccountID: depositsGL.ID,
			ExternalCustomerID: &in.ExternalCustomerID, ProductType: SavingsProductType,
			Metadata: metaJSON,
		})
		if err != nil {
			return err
		}
		savingsAcc = opened
		return nil
	})
	if err != nil {
		return nil, nil, err
	}

	walletID, err := resolveAccountID(ctx, pool, in.TenantID, in.ExternalCustomerID)
	if err != nil {
		return savingsAcc, nil, err
	}

	entry, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "savings_deposit", Description: in.Description,
		Lines: []ledger.LineInput{
			{LedgerAccountID: walletID, Direction: domain.Debit, Amount: in.PrincipalKobo},
			{LedgerAccountID: savingsAcc.ID, Direction: domain.Credit, Amount: in.PrincipalKobo},
		},
	})
	if err != nil {
		return savingsAcc, nil, err
	}
	return savingsAcc, entry, nil
}

type WithdrawSavingsInput struct {
	TenantID           string
	ExternalCustomerID string
	SavingsAccountID   string
	Amount             int64
	Reference          string
	IdempotencyKey     string
	Description        string
}

// WithdrawSavings moves money from a matured savings pocket back to the
// customer's wallet. Early withdrawal isn't supported this pass — a
// strict "locked pocket" MVP, not a partial implementation; a penalty-
// based early-withdrawal path is a deliberate later increment, not an
// oversight.
func WithdrawSavings(ctx context.Context, pool *pgxpool.Pool, in WithdrawSavingsInput) (*domain.JournalEntry, error) {
	var savingsAcc *domain.LedgerAccount
	err := dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, err := account.GetSavingsAccount(ctx, tx, in.TenantID, in.SavingsAccountID)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrSavingsAccountNotFound, in.SavingsAccountID)
		}
		if acc.ProductType != SavingsProductType {
			return fmt.Errorf("%w: %s", ErrSavingsAccountNotFound, in.SavingsAccountID)
		}
		if acc.ExternalCustomerID == nil || *acc.ExternalCustomerID != in.ExternalCustomerID {
			return ErrSavingsAccountNotOwned
		}
		savingsAcc = acc
		return nil
	})
	if err != nil {
		return nil, err
	}

	var meta SavingsMetadata
	if err := json.Unmarshal(savingsAcc.Metadata, &meta); err != nil {
		return nil, fmt.Errorf("wallet: unmarshal savings metadata for %s: %w", in.SavingsAccountID, err)
	}
	if time.Now().Before(meta.LockedUntil) {
		return nil, fmt.Errorf("%w: matures %s", ErrSavingsLocked, meta.LockedUntil.Format(time.RFC3339))
	}

	walletID, err := resolveAccountID(ctx, pool, in.TenantID, in.ExternalCustomerID)
	if err != nil {
		return nil, err
	}

	return ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "savings_withdrawal", Description: in.Description,
		Lines: []ledger.LineInput{
			{LedgerAccountID: savingsAcc.ID, Direction: domain.Debit, Amount: in.Amount},
			{LedgerAccountID: walletID, Direction: domain.Credit, Amount: in.Amount},
		},
	})
}

// ListSavingsAccounts returns every savings pocket a customer has.
func ListSavingsAccounts(ctx context.Context, pool *pgxpool.Pool, tenantID, externalCustomerID string) ([]domain.LedgerAccount, error) {
	var accounts []domain.LedgerAccount
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		list, err := account.ListByExternalCustomerIDAndProduct(ctx, tx, tenantID, externalCustomerID, SavingsProductType)
		if err != nil {
			return err
		}
		accounts = list
		return nil
	})
	return accounts, err
}
