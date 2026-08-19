// Package tenant provisions institutions onto the platform: creating the
// tenant row plus its default chart of accounts and system ledger
// accounts, so a freshly onboarded tenant can post entries immediately.
package tenant

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/coa"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
)

const (
	FloatAccountNumber           = "SYS-FLOAT"
	FeeIncomeAccountNumber       = "SYS-FEE-INCOME"
	InterestExpenseAccountNumber = "SYS-INTEREST-EXPENSE"
	// InterestIncomeAccountNumber recognizes interest a tenant earns on
	// loans (internal/accrual's loan-interest pass) — the receiving side
	// of InterestExpenseAccountNumber's savings-side counterpart, GL 4200
	// instead of 5100.
	InterestIncomeAccountNumber = "SYS-INTEREST-INCOME"
	CustomerDepositsGLCode      = "2100"
	// LoanLossReserveAccountNumber / LoanLossProvisionAccountNumber back
	// internal/accrual's provisioning pass — the contra-asset (GL 1250)
	// and expense (GL 5200) sides of the same entry.
	LoanLossReserveAccountNumber   = "SYS-LOAN-LOSS-RESERVE"
	LoanLossProvisionAccountNumber = "SYS-LOAN-LOSS-PROVISION"
)

type CreateInput struct {
	Slug           string
	Name           string
	LicenseType    domain.LicenseType
	DeploymentMode domain.DeploymentMode
	BaseCurrency   string
	// WebhookURL, if set, is where internal/outbox delivers this tenant's
	// ledger events (journal entries posted, etc). Stored under
	// settings.webhookUrl — nothing about the schema is specific to it,
	// so other per-tenant config can land in the same JSON column later.
	WebhookURL string
}

// SystemAccounts are the ledger accounts every fresh tenant gets so that
// fees, float, and interest have somewhere to post to from day one.
type SystemAccounts struct {
	Float           *domain.LedgerAccount
	FeeIncome       *domain.LedgerAccount
	InterestExpense *domain.LedgerAccount
	InterestIncome  *domain.LedgerAccount
}

func Create(ctx context.Context, pool *pgxpool.Pool, in CreateInput) (*domain.Tenant, *SystemAccounts, error) {
	deploymentMode := in.DeploymentMode
	if deploymentMode == "" {
		deploymentMode = domain.Shared
	}
	baseCurrency := in.BaseCurrency
	if baseCurrency == "" {
		baseCurrency = "NGN"
	}

	t := &domain.Tenant{
		Slug: in.Slug, Name: in.Name, LicenseType: in.LicenseType,
		DeploymentMode: deploymentMode, BaseCurrency: baseCurrency,
	}

	settings := map[string]any{}
	if in.WebhookURL != "" {
		settings["webhookUrl"] = in.WebhookURL
	}
	settingsJSON, err := json.Marshal(settings)
	if err != nil {
		return nil, nil, fmt.Errorf("tenant: marshal settings: %w", err)
	}

	row := pool.QueryRow(ctx, `
		INSERT INTO tenants (slug, name, license_type, deployment_mode, base_currency, settings)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at
	`, in.Slug, in.Name, in.LicenseType, deploymentMode, baseCurrency, settingsJSON)
	if err := row.Scan(&t.ID, &t.CreatedAt); err != nil {
		return nil, nil, fmt.Errorf("tenant: create %s: %w", in.Slug, err)
	}

	var sysAccounts *SystemAccounts
	err = dbctx.WithTenant(ctx, pool, t.ID, func(ctx context.Context, tx pgx.Tx) error {
		chart, err := coa.SeedDefault(ctx, tx, t.ID)
		if err != nil {
			return err
		}

		floatAcc, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: t.ID, GLAccountID: chart["1100"].ID, AccountNumber: FloatAccountNumber,
			ProductType: "float", Currency: baseCurrency, IsSystemAccount: true, AllowNegativeBalance: true,
		})
		if err != nil {
			return fmt.Errorf("tenant: open float account: %w", err)
		}

		feeAcc, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: t.ID, GLAccountID: chart["4100"].ID, AccountNumber: FeeIncomeAccountNumber,
			ProductType: "fee_income", Currency: baseCurrency, IsSystemAccount: true, AllowNegativeBalance: true,
		})
		if err != nil {
			return fmt.Errorf("tenant: open fee income account: %w", err)
		}

		interestAcc, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: t.ID, GLAccountID: chart["5100"].ID, AccountNumber: InterestExpenseAccountNumber,
			ProductType: "interest_expense", Currency: baseCurrency, IsSystemAccount: true, AllowNegativeBalance: true,
		})
		if err != nil {
			return fmt.Errorf("tenant: open interest expense account: %w", err)
		}

		interestIncomeAcc, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: t.ID, GLAccountID: chart["4200"].ID, AccountNumber: InterestIncomeAccountNumber,
			ProductType: "interest_income", Currency: baseCurrency, IsSystemAccount: true, AllowNegativeBalance: true,
		})
		if err != nil {
			return fmt.Errorf("tenant: open interest income account: %w", err)
		}

		sysAccounts = &SystemAccounts{Float: floatAcc, FeeIncome: feeAcc, InterestExpense: interestAcc, InterestIncome: interestIncomeAcc}
		return EnsureLoanLossAccounts(ctx, tx, t.ID, baseCurrency)
	})
	if err != nil {
		return nil, nil, err
	}

	return t, sysAccounts, nil
}

// EnsureLoanLossAccounts creates GL 1250/5200 and their system ledger
// accounts if they don't already exist for this tenant — idempotent, so
// it's safe both inside Create's tx for a brand-new tenant (where they
// never exist yet) and standalone against an existing tenant provisioned
// before this GL pair existed (cmd/backfill-loan-loss-accounts). Not
// folded into SeedDefault itself: SeedDefault only ever runs once, at
// creation, and has no story for "some rows already exist."
func EnsureLoanLossAccounts(ctx context.Context, tx pgx.Tx, tenantID, baseCurrency string) error {
	reserveGL, err := ensureGLAccount(ctx, tx, tenantID, "1250", "Loan Loss Reserve", domain.Asset, domain.Credit, "1000")
	if err != nil {
		return err
	}
	provisionGL, err := ensureGLAccount(ctx, tx, tenantID, "5200", "Loan Loss Provision Expense", domain.Expense, domain.Debit, "5000")
	if err != nil {
		return err
	}

	if _, _, err := account.GetByAccountNumber(ctx, tx, tenantID, LoanLossReserveAccountNumber); err != nil {
		if _, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: tenantID, GLAccountID: reserveGL.ID, AccountNumber: LoanLossReserveAccountNumber,
			ProductType: "loan_loss_reserve", Currency: baseCurrency, IsSystemAccount: true, AllowNegativeBalance: true,
		}); err != nil {
			return fmt.Errorf("tenant: open loan loss reserve account: %w", err)
		}
	}

	if _, _, err := account.GetByAccountNumber(ctx, tx, tenantID, LoanLossProvisionAccountNumber); err != nil {
		if _, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: tenantID, GLAccountID: provisionGL.ID, AccountNumber: LoanLossProvisionAccountNumber,
			ProductType: "loan_loss_provision", Currency: baseCurrency, IsSystemAccount: true, AllowNegativeBalance: true,
		}); err != nil {
			return fmt.Errorf("tenant: open loan loss provision account: %w", err)
		}
	}

	return nil
}

func ensureGLAccount(ctx context.Context, tx pgx.Tx, tenantID, code, name string, t domain.GLAccountType, normal domain.Direction, parentCode string) (*coa.Entry, error) {
	existing, err := coa.ByCode(ctx, tx, tenantID, code)
	if err == nil {
		return existing, nil
	}
	parent, err := coa.ByCode(ctx, tx, tenantID, parentCode)
	if err != nil {
		return nil, fmt.Errorf("tenant: parent GL %s missing for %s: %w", parentCode, code, err)
	}
	return coa.Create(ctx, tx, tenantID, code, name, t, normal, &parent.ID, false)
}
