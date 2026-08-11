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
	Metadata             []byte // optional JSON — e.g. savings.go's rate/lock terms. Defaults to '{}'.
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

		metadata := in.Metadata
		if metadata == nil {
			metadata = []byte("{}")
		}

		row := tx.QueryRow(ctx, `
			INSERT INTO ledger_accounts (
				tenant_id, gl_account_id, account_number, external_customer_id,
				product_type, currency, kyc_tier, is_system_account, allow_negative_balance, metadata
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING id, status, created_at
		`, in.TenantID, in.GLAccountID, candidate, in.ExternalCustomerID,
			in.ProductType, currency, in.KYCTier, in.IsSystemAccount, in.AllowNegativeBalance, metadata)

		acc := &domain.LedgerAccount{
			TenantID: in.TenantID, GLAccountID: in.GLAccountID, AccountNumber: candidate,
			ExternalCustomerID: in.ExternalCustomerID, ProductType: in.ProductType, Currency: currency,
			KYCTier: in.KYCTier, IsSystemAccount: in.IsSystemAccount, AllowNegativeBalance: in.AllowNegativeBalance,
			Metadata: metadata,
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
// customer by the ID the calling backend uses for them, scoped to a
// product type. A customer can have more than one ledger account now
// (a wallet, one or more savings pockets) — productType is what keeps
// this resolving to the right one; every existing caller pins it to
// "wallet" to preserve exactly the behavior this had before savings
// existed. Use ListByExternalCustomerIDAndProduct for products where a
// customer can have more than one (savings).
func GetByExternalCustomerID(ctx context.Context, tx pgx.Tx, tenantID, externalCustomerID, productType string) (*domain.LedgerAccount, domain.Direction, error) {
	row := tx.QueryRow(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, la.account_number,
		       la.product_type, la.kyc_tier, coa.normal_balance
		FROM ledger_accounts la
		JOIN chart_of_accounts coa ON coa.id = la.gl_account_id
		WHERE la.tenant_id = $1 AND la.external_customer_id = $2 AND la.product_type = $3
	`, tenantID, externalCustomerID, productType)

	acc := &domain.LedgerAccount{TenantID: tenantID, ExternalCustomerID: &externalCustomerID}
	var normal domain.Direction
	if err := row.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &acc.AccountNumber,
		&acc.ProductType, &acc.KYCTier, &normal); err != nil {
		return nil, "", fmt.Errorf("account: get by external customer %s (product %s): %w", externalCustomerID, productType, err)
	}
	return acc, normal, nil
}

// ListByExternalCustomerIDAndProduct returns every account a customer has
// of a given product type — a customer can have several savings pockets,
// unlike the single wallet GetByExternalCustomerID resolves.
func ListByExternalCustomerIDAndProduct(ctx context.Context, tx pgx.Tx, tenantID, externalCustomerID, productType string) ([]domain.LedgerAccount, error) {
	rows, err := tx.Query(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, la.account_number,
		       la.product_type, la.kyc_tier, la.metadata, la.created_at
		FROM ledger_accounts la
		WHERE la.tenant_id = $1 AND la.external_customer_id = $2 AND la.product_type = $3
		ORDER BY la.created_at
	`, tenantID, externalCustomerID, productType)
	if err != nil {
		return nil, fmt.Errorf("account: list by external customer %s (product %s): %w", externalCustomerID, productType, err)
	}
	defer rows.Close()

	var accounts []domain.LedgerAccount
	for rows.Next() {
		acc := domain.LedgerAccount{TenantID: tenantID, ExternalCustomerID: &externalCustomerID}
		if err := rows.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &acc.AccountNumber,
			&acc.ProductType, &acc.KYCTier, &acc.Metadata, &acc.CreatedAt); err != nil {
			return nil, fmt.Errorf("account: scan list row: %w", err)
		}
		accounts = append(accounts, acc)
	}
	return accounts, rows.Err()
}

// ListByProductType returns every account of a given product type for a
// tenant, regardless of customer — what the interest accrual job needs
// to find every savings pocket across a tenant, not just one customer's.
func ListByProductType(ctx context.Context, tx pgx.Tx, tenantID, productType string) ([]domain.LedgerAccount, error) {
	rows, err := tx.Query(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, la.account_number,
		       la.product_type, la.external_customer_id, la.metadata, la.created_at
		FROM ledger_accounts la
		WHERE la.tenant_id = $1 AND la.product_type = $2 AND la.status = 'ACTIVE'
		ORDER BY la.created_at
	`, tenantID, productType)
	if err != nil {
		return nil, fmt.Errorf("account: list by product type %s: %w", productType, err)
	}
	defer rows.Close()

	var accounts []domain.LedgerAccount
	for rows.Next() {
		acc := domain.LedgerAccount{TenantID: tenantID}
		if err := rows.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &acc.AccountNumber,
			&acc.ProductType, &acc.ExternalCustomerID, &acc.Metadata, &acc.CreatedAt); err != nil {
			return nil, fmt.Errorf("account: scan list-by-product row: %w", err)
		}
		accounts = append(accounts, acc)
	}
	return accounts, rows.Err()
}

// GetSavingsAccount loads a ledger account with the fields savings-specific
// operations need (metadata, for the lock/rate; product type and external
// customer id, to confirm it's actually a savings account owned by the
// caller) — kept separate from Get, which stays lean since it's on the
// hot path for every transaction's balance-guard check.
func GetSavingsAccount(ctx context.Context, tx pgx.Tx, tenantID, ledgerAccountID string) (*domain.LedgerAccount, error) {
	row := tx.QueryRow(ctx, `
		SELECT la.id, la.status, la.allow_negative_balance, la.currency, la.account_number,
		       la.product_type, la.external_customer_id, la.metadata, la.created_at
		FROM ledger_accounts la
		WHERE la.tenant_id = $1 AND la.id = $2
	`, tenantID, ledgerAccountID)

	acc := &domain.LedgerAccount{TenantID: tenantID}
	if err := row.Scan(&acc.ID, &acc.Status, &acc.AllowNegativeBalance, &acc.Currency, &acc.AccountNumber,
		&acc.ProductType, &acc.ExternalCustomerID, &acc.Metadata, &acc.CreatedAt); err != nil {
		return nil, fmt.Errorf("account: get savings account %s: %w", ledgerAccountID, err)
	}
	return acc, nil
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
