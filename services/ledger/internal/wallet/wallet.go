// Package wallet holds the product-level operations a wallet needs —
// opening an account for a customer, P2P transfers, and recording
// deposits/withdrawals a calling backend already collected or paid out
// through a banking provider. Each resolves external customer IDs to
// ledger accounts and then calls internal/ledger, which stays the
// generic, product-agnostic primitive underneath.
//
// KYC-tier transaction/daily limits are deliberately NOT enforced here —
// that policy decision lives with whatever backend owns KYC for a given
// tenant (see CORE_BANKING_PLATFORM_ARCHITECTURE.md and trust-bank's
// Phase 1 plan). This package only guarantees ledger correctness.
package wallet

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/coa"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/tenant"
)

type OpenAccountInput struct {
	TenantID           string
	ExternalCustomerID string
	ProductType        string // defaults to "wallet"
	Currency           string
	KYCTier            int
	AccountNumber      string // optional — auto-generated if empty
}

func OpenAccount(ctx context.Context, pool *pgxpool.Pool, in OpenAccountInput) (*domain.LedgerAccount, error) {
	productType := in.ProductType
	if productType == "" {
		productType = "wallet"
	}

	var acc *domain.LedgerAccount
	err := dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		if _, _, err := account.GetByExternalCustomerID(ctx, tx, in.TenantID, in.ExternalCustomerID); err == nil {
			return ErrCustomerAlreadyHasAccount
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		depositsGL, err := coa.ByCode(ctx, tx, in.TenantID, tenant.CustomerDepositsGLCode)
		if err != nil {
			return fmt.Errorf("wallet: chart of accounts not seeded for tenant %s: %w", in.TenantID, err)
		}

		opened, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: in.TenantID, GLAccountID: depositsGL.ID, AccountNumber: in.AccountNumber,
			ExternalCustomerID: &in.ExternalCustomerID, ProductType: productType,
			Currency: in.Currency, KYCTier: in.KYCTier,
		})
		if err != nil {
			return err
		}
		acc = opened
		return nil
	})
	if err != nil {
		return nil, err
	}
	return acc, nil
}

func GetAccountByCustomer(ctx context.Context, pool *pgxpool.Pool, tenantID, externalCustomerID string) (*domain.LedgerAccount, error) {
	var result *domain.LedgerAccount
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, _, err := account.GetByExternalCustomerID(ctx, tx, tenantID, externalCustomerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCustomerAccountNotFound
			}
			return err
		}
		result = acc
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

type TransferP2PInput struct {
	TenantID               string
	FromExternalCustomerID string
	ToExternalCustomerID   string
	Amount                 int64
	Reference              string
	IdempotencyKey         string
	Description            string
}

func TransferP2P(ctx context.Context, pool *pgxpool.Pool, in TransferP2PInput) (*domain.JournalEntry, error) {
	fromID, err := resolveAccountID(ctx, pool, in.TenantID, in.FromExternalCustomerID)
	if err != nil {
		return nil, err
	}
	toID, err := resolveAccountID(ctx, pool, in.TenantID, in.ToExternalCustomerID)
	if err != nil {
		return nil, err
	}
	if fromID == toID {
		return nil, ErrSameAccount
	}

	return ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "p2p_transfer", Description: in.Description,
		Lines: []ledger.LineInput{
			{LedgerAccountID: fromID, Direction: domain.Debit, Amount: in.Amount},
			{LedgerAccountID: toID, Direction: domain.Credit, Amount: in.Amount},
		},
	})
}

type ConfirmDepositInput struct {
	TenantID           string
	ExternalCustomerID string
	Amount             int64
	ProviderRef        string
	Reference          string
	IdempotencyKey     string
	Description        string
}

// ConfirmDeposit records money the calling backend has already collected
// through a banking provider (e.g. a Paystack DVA credit) — it does not
// talk to any provider itself.
func ConfirmDeposit(ctx context.Context, pool *pgxpool.Pool, in ConfirmDepositInput) (*domain.JournalEntry, error) {
	customerID, err := resolveAccountID(ctx, pool, in.TenantID, in.ExternalCustomerID)
	if err != nil {
		return nil, err
	}
	floatID, err := resolveAccountByNumber(ctx, pool, in.TenantID, tenant.FloatAccountNumber)
	if err != nil {
		return nil, err
	}

	metadata := map[string]any{}
	if in.ProviderRef != "" {
		metadata["providerRef"] = in.ProviderRef
	}

	return ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "deposit", Description: in.Description, Metadata: metadata,
		Lines: []ledger.LineInput{
			{LedgerAccountID: floatID, Direction: domain.Debit, Amount: in.Amount},
			{LedgerAccountID: customerID, Direction: domain.Credit, Amount: in.Amount},
		},
	})
}

type RecordWithdrawalInput struct {
	TenantID           string
	ExternalCustomerID string
	Amount             int64
	Reference          string
	IdempotencyKey     string
	Description        string
}

// RecordWithdrawal reflects money leaving the customer's ledger balance.
// The actual bank payout is the calling backend's job (a provider
// transfer call) — this only makes the ledger agree with it.
func RecordWithdrawal(ctx context.Context, pool *pgxpool.Pool, in RecordWithdrawalInput) (*domain.JournalEntry, error) {
	customerID, err := resolveAccountID(ctx, pool, in.TenantID, in.ExternalCustomerID)
	if err != nil {
		return nil, err
	}
	floatID, err := resolveAccountByNumber(ctx, pool, in.TenantID, tenant.FloatAccountNumber)
	if err != nil {
		return nil, err
	}

	return ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "withdrawal", Description: in.Description,
		Lines: []ledger.LineInput{
			{LedgerAccountID: customerID, Direction: domain.Debit, Amount: in.Amount},
			{LedgerAccountID: floatID, Direction: domain.Credit, Amount: in.Amount},
		},
	})
}

func resolveAccountID(ctx context.Context, pool *pgxpool.Pool, tenantID, externalCustomerID string) (string, error) {
	var id string
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, _, err := account.GetByExternalCustomerID(ctx, tx, tenantID, externalCustomerID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrCustomerAccountNotFound
			}
			return err
		}
		id = acc.ID
		return nil
	})
	return id, err
}

func resolveAccountByNumber(ctx context.Context, pool *pgxpool.Pool, tenantID, accountNumber string) (string, error) {
	var id string
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, _, err := account.GetByAccountNumber(ctx, tx, tenantID, accountNumber)
		if err != nil {
			return fmt.Errorf("wallet: system account %s missing for tenant %s: %w", accountNumber, tenantID, err)
		}
		id = acc.ID
		return nil
	})
	return id, err
}
