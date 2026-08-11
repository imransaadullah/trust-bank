package accrual_test

// Real integration tests — see internal/ledger/service_test.go's header
// comment for how to point DATABASE_URL at a migrated database.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/accrual"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/tenant"
	"trustbank/ledger/internal/wallet"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set — skipping accrual integration tests")
	}
	pool, err := dbctx.NewPool(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func freshFundedSavingsAccount(t *testing.T, pool *pgxpool.Pool, annualRateBps int, principal int64) (tenantID string, savingsAccountID string) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	tn, _, err := tenant.Create(ctx, pool, tenant.CreateInput{
		Slug: "accrual-test-" + suffix, Name: "Accrual Test " + suffix,
		LicenseType: domain.BaaSReseller, BaseCurrency: "NGN",
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	customerID := "customer-" + suffix
	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tn.ID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open wallet: %v", err)
	}
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tn.ID, ExternalCustomerID: customerID, Amount: principal + 1,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	savingsAcc, _, err := wallet.OpenSavingsAccount(ctx, pool, wallet.OpenSavingsAccountInput{
		TenantID: tn.ID, ExternalCustomerID: customerID, AnnualRateBps: annualRateBps, LockDays: 30,
		PrincipalKobo: principal, Reference: "SAV-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("open savings account: %v", err)
	}
	return tn.ID, savingsAcc.ID
}

func TestRunOnce_PostsExpectedDailyInterest(t *testing.T) {
	pool := testPool(t)
	// 1,000,000 kobo at 3650 bps (36.5% APY, chosen so daily interest is a
	// clean round number) -> 1,000,000 * 3650 / 10000 / 365 = 1000 kobo/day.
	tenantID, savingsAccountID := freshFundedSavingsAccount(t, pool, 3650, 1_000_000)

	consumer := accrual.NewConsumer(pool, 0)
	if err := consumer.RunOnce(context.Background()); err != nil {
		t.Fatalf("run once: %v", err)
	}

	bal, err := ledger.GetBalance(context.Background(), pool, tenantID, savingsAccountID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 1_000_000+1_000 {
		t.Fatalf("expected balance 1001000 after one day's interest, got %d", bal.Amount)
	}
}

func TestRunOnce_IsIdempotentWithinTheSameDay(t *testing.T) {
	pool := testPool(t)
	tenantID, savingsAccountID := freshFundedSavingsAccount(t, pool, 3650, 1_000_000)

	consumer := accrual.NewConsumer(pool, 0)
	ctx := context.Background()
	if err := consumer.RunOnce(ctx); err != nil {
		t.Fatalf("first run: %v", err)
	}
	if err := consumer.RunOnce(ctx); err != nil {
		t.Fatalf("second run: %v", err)
	}

	bal, err := ledger.GetBalance(ctx, pool, tenantID, savingsAccountID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 1_000_000+1_000 {
		t.Fatalf("expected balance to reflect exactly one day's interest (not doubled), got %d", bal.Amount)
	}
}

func TestRunOnce_ZeroRateAccountAccruesNothing(t *testing.T) {
	pool := testPool(t)
	tenantID, savingsAccountID := freshFundedSavingsAccount(t, pool, 0, 1_000_000)

	consumer := accrual.NewConsumer(pool, 0)
	if err := consumer.RunOnce(context.Background()); err != nil {
		t.Fatalf("run once: %v", err)
	}

	bal, err := ledger.GetBalance(context.Background(), pool, tenantID, savingsAccountID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 1_000_000 {
		t.Fatalf("expected balance unchanged at 1000000 for a 0bps account, got %d", bal.Amount)
	}
}
