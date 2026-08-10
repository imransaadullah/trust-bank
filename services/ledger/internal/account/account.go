// Package account manages ledger accounts — the sub-ledger rows a
// customer's savings account, a loan, or a system float account are
// represented by. Balances are always derived from ledger_lines, never
// stored, so there is no "balance" column to drift out of sync.
package account

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"trustbank/ledger/internal/domain"
)

type OpenInput struct {
	TenantID             string
	GLAccountID          string
	AccountNumber        string
	ExternalCustomerID   *string
	ProductType          string
	Currency             string
	KYCTier              int
	IsSystemAccount      bool
	AllowNegativeBalance bool
}

func Open(ctx context.Context, tx pgx.Tx, in OpenInput) (*domain.LedgerAccount, error) {
	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO ledger_accounts (
			tenant_id, gl_account_id, account_number, external_customer_id,
			product_type, currency, kyc_tier, is_system_account, allow_negative_balance
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, status, created_at
	`, in.TenantID, in.GLAccountID, in.AccountNumber, in.ExternalCustomerID,
		in.ProductType, currency, in.KYCTier, in.IsSystemAccount, in.AllowNegativeBalance)

	acc := &domain.LedgerAccount{
		TenantID: in.TenantID, GLAccountID: in.GLAccountID, AccountNumber: in.AccountNumber,
		ExternalCustomerID: in.ExternalCustomerID, ProductType: in.ProductType, Currency: currency,
		KYCTier: in.KYCTier, IsSystemAccount: in.IsSystemAccount, AllowNegativeBalance: in.AllowNegativeBalance,
	}
	if err := row.Scan(&acc.ID, &acc.Status, &acc.CreatedAt); err != nil {
		return nil, fmt.Errorf("account: open %s: %w", in.AccountNumber, err)
	}
	return acc, nil
}

// Get loads a ledger account along with the fields the ledger package
// needs to decide whether a debit against it is allowed.
func Get(ctx context.Context, tx pgx.Tx, tenantID, ledgerAccountID string) (*domain.LedgerAccount, domain.Direction, error) {
	row := tx.QueryRow(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, coa.normal_balance
		FROM ledger_accounts la
		JOIN chart_of_accounts coa ON coa.id = la.gl_account_id
		WHERE la.tenant_id = $1 AND la.id = $2
	`, tenantID, ledgerAccountID)

	acc := &domain.LedgerAccount{TenantID: tenantID}
	var normal domain.Direction
	if err := row.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &normal); err != nil {
		return nil, "", fmt.Errorf("account: get %s: %w", ledgerAccountID, err)
	}
	return acc, normal, nil
}

// Balance returns the account's balance expressed "in the normal-balance
// sense" — positive is healthy whether the account is debit-normal
// (asset/expense) or credit-normal (liability/equity/income).
func Balance(ctx context.Context, tx pgx.Tx, tenantID, ledgerAccountID string) (*domain.Balance, error) {
	row := tx.QueryRow(ctx, `
		SELECT
			coa.normal_balance,
			COALESCE(SUM(ll.amount) FILTER (WHERE ll.direction = coa.normal_balance), 0)
				- COALESCE(SUM(ll.amount) FILTER (WHERE ll.direction <> coa.normal_balance), 0)
		FROM ledger_accounts la
		JOIN chart_of_accounts coa ON coa.id = la.gl_account_id
		LEFT JOIN ledger_lines ll ON ll.ledger_account_id = la.id AND ll.tenant_id = la.tenant_id
		WHERE la.tenant_id = $1 AND la.id = $2
		GROUP BY coa.normal_balance
	`, tenantID, ledgerAccountID)

	b := &domain.Balance{LedgerAccountID: ledgerAccountID}
	if err := row.Scan(&b.NormalBalance, &b.Amount); err != nil {
		return nil, fmt.Errorf("account: balance %s: %w", ledgerAccountID, err)
	}
	return b, nil
}
