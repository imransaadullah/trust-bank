// Package account manages ledger accounts — the sub-ledger rows a
// customer's savings account, a loan, or a system float account are
// represented by. Balances are always derived from ledger_lines, never
// stored, so there is no "balance" column to drift out of sync.
package account

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"trustbank/ledger/internal/domain"
)

type OpenInput struct {
	TenantID             string
	GLAccountID          string
	AccountNumber        string // optional — auto-generated if empty
	ExternalCustomerID   *string
	ProductType          string
	Currency             string
	KYCTier              int
	IsSystemAccount      bool
	AllowNegativeBalance bool
}

const uniqueViolationCode = "23505"
const maxAccountNumberAttempts = 5

// Open creates a ledger account. If AccountNumber is empty, one is
// generated — a real bank account number (a Paystack DVA, for example)
// can be attached later via the metadata column without touching this
// field; it exists as the ledger's own stable identifier, not necessarily
// a bank-issued one.
func Open(ctx context.Context, tx pgx.Tx, in OpenInput) (*domain.LedgerAccount, error) {
	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}

	accountNumber := in.AccountNumber
	attempts := 1
	if accountNumber == "" {
		attempts = maxAccountNumberAttempts
	}

	var lastErr error
	for i := 0; i < attempts; i++ {
		candidate := accountNumber
		if candidate == "" {
			num, err := generateAccountNumber()
			if err != nil {
				return nil, fmt.Errorf("account: generate account number: %w", err)
			}
			candidate = num
		}

		row := tx.QueryRow(ctx, `
			INSERT INTO ledger_accounts (
				tenant_id, gl_account_id, account_number, external_customer_id,
				product_type, currency, kyc_tier, is_system_account, allow_negative_balance
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING id, status, created_at
		`, in.TenantID, in.GLAccountID, candidate, in.ExternalCustomerID,
			in.ProductType, currency, in.KYCTier, in.IsSystemAccount, in.AllowNegativeBalance)

		acc := &domain.LedgerAccount{
			TenantID: in.TenantID, GLAccountID: in.GLAccountID, AccountNumber: candidate,
			ExternalCustomerID: in.ExternalCustomerID, ProductType: in.ProductType, Currency: currency,
			KYCTier: in.KYCTier, IsSystemAccount: in.IsSystemAccount, AllowNegativeBalance: in.AllowNegativeBalance,
		}
		err := row.Scan(&acc.ID, &acc.Status, &acc.CreatedAt)
		if err == nil {
			return acc, nil
		}

		if in.AccountNumber == "" && isUniqueViolation(err) {
			lastErr = err
			continue // collision on a generated number — try another
		}
		return nil, fmt.Errorf("account: open %s: %w", candidate, err)
	}

	return nil, fmt.Errorf("account: gave up generating a unique account number after %d attempts: %w", attempts, lastErr)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == uniqueViolationCode
	}
	return false
}

// generateAccountNumber produces a 10-digit numeric identifier — shaped
// like a NUBAN, but this is purely the ledger's internal identifier, not
// itself a bank-issued account number.
func generateAccountNumber() (string, error) {
	var b [5]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	n := uint64(b[0])<<32 | uint64(b[1])<<24 | uint64(b[2])<<16 | uint64(b[3])<<8 | uint64(b[4])
	return fmt.Sprintf("%010d", n%10_000_000_000), nil
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

// GetByExternalCustomerID looks up a tenant's ledger account for a
// customer by the ID the calling backend uses for them — the lookup a
// wallet product actually needs; nothing outside the ledger should have
// to track raw ledger_account_id values.
func GetByExternalCustomerID(ctx context.Context, tx pgx.Tx, tenantID, externalCustomerID string) (*domain.LedgerAccount, domain.Direction, error) {
	row := tx.QueryRow(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, la.account_number,
		       la.product_type, la.kyc_tier, coa.normal_balance
		FROM ledger_accounts la
		JOIN chart_of_accounts coa ON coa.id = la.gl_account_id
		WHERE la.tenant_id = $1 AND la.external_customer_id = $2
	`, tenantID, externalCustomerID)

	acc := &domain.LedgerAccount{TenantID: tenantID, ExternalCustomerID: &externalCustomerID}
	var normal domain.Direction
	if err := row.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &acc.AccountNumber,
		&acc.ProductType, &acc.KYCTier, &normal); err != nil {
		return nil, "", fmt.Errorf("account: get by external customer %s: %w", externalCustomerID, err)
	}
	return acc, normal, nil
}

// GetByAccountNumber looks up a ledger account by its account number —
// used to find a tenant's fixed-name system accounts (SYS-FLOAT etc).
func GetByAccountNumber(ctx context.Context, tx pgx.Tx, tenantID, accountNumber string) (*domain.LedgerAccount, domain.Direction, error) {
	row := tx.QueryRow(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, coa.normal_balance
		FROM ledger_accounts la
		JOIN chart_of_accounts coa ON coa.id = la.gl_account_id
		WHERE la.tenant_id = $1 AND la.account_number = $2
	`, tenantID, accountNumber)

	acc := &domain.LedgerAccount{TenantID: tenantID, AccountNumber: accountNumber}
	var normal domain.Direction
	if err := row.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &normal); err != nil {
		return nil, "", fmt.Errorf("account: get by account number %s: %w", accountNumber, err)
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
