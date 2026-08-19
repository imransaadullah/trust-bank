// Package loan is the core lending lifecycle: origination (a PENDING
// account, no money moves), disbursement (staff-approved release of
// funds — gated by services/identity's maker-checker, not by anything in
// this package), interest accrual (internal/accrual), and repayment.
// Loans & Credit is its own bounded context per
// CORE_BANKING_PLATFORM_ARCHITECTURE.md section 3 — a peer to Deposit
// Products, not a sub-type of internal/wallet — but reuses the exact
// same primitives wallet/savings.go already proved: a second product
// type on ledger_accounts, terms in the metadata JSONB column, money
// movement through the generic internal/ledger.PostJournalEntry, no new
// ledger concept required.
//
// This package never calls another service. "Compliance is consulted
// before the Ledger writes, by the calling backend" already holds for
// every existing flow (trustpay-backend's transfers, identity's
// account-open) — the credit-eligibility decision happens in
// services/identity's own staff-initiated route, before it ever calls
// Originate here. The Ledger stays a dumb, mechanical money-mover.
package loan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/coa"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/wallet"
)

// LoanProductType distinguishes a loan from a customer's wallet or
// savings pockets, same convention as wallet.SavingsProductType.
const LoanProductType = "loan"

// LoansReceivableGLCode is the chart-of-accounts category every
// individual loan opens against — coa.SeedDefault already seeds this
// (Asset, debit-normal), unused until this package.
const LoansReceivableGLCode = "1200"

// LoanMetadata is what gets marshaled into a loan LedgerAccount's
// metadata column at origination — internal/accrual reads AnnualRateBps
// back out of it, Disburse sets DisbursedAt/MaturityDate.
type LoanMetadata struct {
	PrincipalKobo int64      `json:"principalKobo"`
	AnnualRateBps int        `json:"annualRateBps"`
	TenorDays     int        `json:"tenorDays"`
	OriginatedAt  time.Time  `json:"originatedAt"`
	DisbursedAt   *time.Time `json:"disbursedAt,omitempty"`
	MaturityDate  *time.Time `json:"maturityDate,omitempty"`
}

type OriginateInput struct {
	TenantID           string
	ExternalCustomerID string
	BranchID           *string // nil for a tenant-wide (e.g. credit_manager) origination
	PrincipalKobo      int64
	AnnualRateBps      int
	TenorDays          int
}

// Originate creates a PENDING loan account — no money moves. The caller
// (services/identity) is responsible for running the eligibility check
// against services/compliance first; this function trusts that decision
// has already been made and just records it.
func Originate(ctx context.Context, pool *pgxpool.Pool, in OriginateInput) (*domain.LedgerAccount, error) {
	meta := LoanMetadata{
		PrincipalKobo: in.PrincipalKobo, AnnualRateBps: in.AnnualRateBps,
		TenorDays: in.TenorDays, OriginatedAt: time.Now().UTC(),
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return nil, fmt.Errorf("loan: marshal metadata: %w", err)
	}

	var loanAcc *domain.LedgerAccount
	err = dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		loansGL, err := coa.ByCode(ctx, tx, in.TenantID, LoansReceivableGLCode)
		if err != nil {
			return fmt.Errorf("loan: chart of accounts not seeded for tenant %s: %w", in.TenantID, err)
		}

		opened, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: in.TenantID, GLAccountID: loansGL.ID,
			ExternalCustomerID: &in.ExternalCustomerID, BranchID: in.BranchID,
			ProductType: LoanProductType, Metadata: metaJSON, Status: domain.StatusPending,
		})
		if err != nil {
			return err
		}
		loanAcc = opened
		return nil
	})
	if err != nil {
		return nil, err
	}
	return loanAcc, nil
}

type DisburseInput struct {
	TenantID       string
	LoanAccountID  string
	Reference      string
	IdempotencyKey string
	Description    string
}

// Disburse releases loan proceeds into the customer's wallet. Two
// non-atomic steps, same accepted-window pattern OpenSavingsAccount
// already uses for open+fund: flip PENDING -> ACTIVE first (postWithinTx
// rejects posting against a non-ACTIVE account), then post the entry. If
// the second step fails, the loan is ACTIVE with no funding — a retry of
// Disburse correctly rejects (ErrLoanNotPending), same recoverable shape
// savings' own open+fund window already has.
func Disburse(ctx context.Context, pool *pgxpool.Pool, in DisburseInput) (*domain.JournalEntry, error) {
	var loanAcc *domain.LedgerAccount
	var meta LoanMetadata
	err := dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, err := account.GetLoanAccount(ctx, tx, in.TenantID, in.LoanAccountID)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrLoanNotFound, in.LoanAccountID)
		}
		if acc.ProductType != LoanProductType {
			return fmt.Errorf("%w: %s", ErrLoanNotFound, in.LoanAccountID)
		}
		if acc.Status != domain.StatusPending {
			return fmt.Errorf("%w: %s is %s", ErrLoanNotPending, in.LoanAccountID, acc.Status)
		}
		if err := json.Unmarshal(acc.Metadata, &meta); err != nil {
			return fmt.Errorf("loan: unmarshal metadata for %s: %w", in.LoanAccountID, err)
		}
		if err := account.UpdateStatus(ctx, tx, in.TenantID, in.LoanAccountID, domain.StatusActive); err != nil {
			return err
		}
		loanAcc = acc
		return nil
	})
	if err != nil {
		return nil, err
	}

	walletID, err := resolveWalletID(ctx, pool, in.TenantID, *loanAcc.ExternalCustomerID)
	if err != nil {
		return nil, err
	}

	entry, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "loan_disbursement", Description: in.Description,
		Lines: []ledger.LineInput{
			{LedgerAccountID: loanAcc.ID, Direction: domain.Debit, Amount: meta.PrincipalKobo},
			{LedgerAccountID: walletID, Direction: domain.Credit, Amount: meta.PrincipalKobo},
		},
	})
	if err != nil {
		return nil, err
	}

	disbursedAt := time.Now().UTC()
	maturity := disbursedAt.Add(time.Duration(meta.TenorDays) * 24 * time.Hour)
	meta.DisbursedAt = &disbursedAt
	meta.MaturityDate = &maturity
	metaJSON, err := json.Marshal(meta)
	if err == nil {
		_ = dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
			_, execErr := tx.Exec(ctx, `UPDATE ledger_accounts SET metadata = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
				in.TenantID, loanAcc.ID, metaJSON)
			return execErr
		})
	}

	return entry, nil
}

type RepayInput struct {
	TenantID           string
	ExternalCustomerID string
	LoanAccountID      string
	Amount             int64
	Reference          string
	IdempotencyKey     string
	Description        string
}

// Repay moves money from the customer's wallet to their loan, reducing
// what's owed. Not gated by services/identity — routine, customer-driven
// money movement, the same tier as a deposit confirm or a P2P transfer,
// neither of which is maker-checker-gated anywhere in this platform.
// Over-repayment is rejected for free by PostJournalEntry's own
// insufficient-balance guard (the loan account doesn't allow negative
// balance) — no extra check needed here.
func Repay(ctx context.Context, pool *pgxpool.Pool, in RepayInput) (*domain.JournalEntry, error) {
	var loanAcc *domain.LedgerAccount
	err := dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, err := account.GetLoanAccount(ctx, tx, in.TenantID, in.LoanAccountID)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrLoanNotFound, in.LoanAccountID)
		}
		if acc.ProductType != LoanProductType {
			return fmt.Errorf("%w: %s", ErrLoanNotFound, in.LoanAccountID)
		}
		if acc.ExternalCustomerID == nil || *acc.ExternalCustomerID != in.ExternalCustomerID {
			return ErrLoanNotOwned
		}
		if acc.Status != domain.StatusActive {
			return fmt.Errorf("%w: %s is %s", ErrLoanNotActive, in.LoanAccountID, acc.Status)
		}
		loanAcc = acc
		return nil
	})
	if err != nil {
		return nil, err
	}

	walletID, err := resolveWalletID(ctx, pool, in.TenantID, in.ExternalCustomerID)
	if err != nil {
		return nil, err
	}

	entry, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: in.TenantID, Reference: in.Reference, IdempotencyKey: in.IdempotencyKey,
		EntryType: "loan_repayment", Description: in.Description,
		Lines: []ledger.LineInput{
			{LedgerAccountID: walletID, Direction: domain.Debit, Amount: in.Amount},
			{LedgerAccountID: loanAcc.ID, Direction: domain.Credit, Amount: in.Amount},
		},
	})
	if err != nil {
		return nil, err
	}

	bal, err := ledger.GetBalance(ctx, pool, in.TenantID, loanAcc.ID)
	if err == nil && bal.Amount == 0 {
		_ = dbctx.WithTenant(ctx, pool, in.TenantID, func(ctx context.Context, tx pgx.Tx) error {
			return account.UpdateStatus(ctx, tx, in.TenantID, loanAcc.ID, domain.StatusClosed)
		})
	}

	return entry, nil
}

// ListByCustomer returns every loan a customer has, active or pending —
// used by services/identity's origination route to enforce the slice 1
// simplification of one loan at a time per customer.
func ListByCustomer(ctx context.Context, pool *pgxpool.Pool, tenantID, externalCustomerID string) ([]domain.LedgerAccount, error) {
	var accounts []domain.LedgerAccount
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		list, err := account.ListByExternalCustomerIDAndProduct(ctx, tx, tenantID, externalCustomerID, LoanProductType)
		if err != nil {
			return err
		}
		accounts = list
		return nil
	})
	return accounts, err
}

func resolveWalletID(ctx context.Context, pool *pgxpool.Pool, tenantID, externalCustomerID string) (string, error) {
	var id string
	err := dbctx.WithTenant(ctx, pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		acc, _, err := account.GetByExternalCustomerID(ctx, tx, tenantID, externalCustomerID, wallet.WalletProductType)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return wallet.ErrCustomerAccountNotFound
			}
			return err
		}
		id = acc.ID
		return nil
	})
	return id, err
}
