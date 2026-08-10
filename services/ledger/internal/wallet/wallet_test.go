package wallet_test

// Real integration tests — see internal/ledger/service_test.go's header
// comment for how to point DATABASE_URL at a migrated database.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

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
		t.Skip("DATABASE_URL not set — skipping wallet integration tests")
	}
	pool, err := dbctx.NewPool(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func freshTenantID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	suffix := uuid.New().String()[:8]
	tn, _, err := tenant.Create(context.Background(), pool, tenant.CreateInput{
		Slug: "wallet-test-" + suffix, Name: "Wallet Test " + suffix,
		LicenseType: domain.BaaSReseller, BaseCurrency: "NGN",
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	return tn.ID
}

func TestOpenAccount_SucceedsAndIsLookupable(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	acc, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID, ProductType: "wallet", KYCTier: 1,
	})
	if err != nil {
		t.Fatalf("open account: %v", err)
	}
	if acc.AccountNumber == "" {
		t.Fatalf("expected an auto-generated account number, got empty string")
	}

	found, err := wallet.GetAccountByCustomer(ctx, pool, tenantID, customerID)
	if err != nil {
		t.Fatalf("get account by customer: %v", err)
	}
	if found.ID != acc.ID {
		t.Fatalf("expected lookup to return the same account, got %s vs %s", found.ID, acc.ID)
	}
	if found.ProductType != "wallet" {
		t.Fatalf("expected lookup to return productType 'wallet', got %q", found.ProductType)
	}
	if found.KYCTier != 1 {
		t.Fatalf("expected lookup to return kycTier 1, got %d", found.KYCTier)
	}
}

func TestOpenAccount_DuplicateCustomerRejected(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID,
	}); err != nil {
		t.Fatalf("first open: %v", err)
	}

	_, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID,
	})
	if !errors.Is(err, wallet.ErrCustomerAlreadyHasAccount) {
		t.Fatalf("expected ErrCustomerAlreadyHasAccount, got %v", err)
	}
}

func TestGetAccountByCustomer_NotFound(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()

	_, err := wallet.GetAccountByCustomer(ctx, pool, tenantID, "no-such-customer")
	if !errors.Is(err, wallet.ErrCustomerAccountNotFound) {
		t.Fatalf("expected ErrCustomerAccountNotFound, got %v", err)
	}
}

func TestConfirmDeposit_CreditsCustomer(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	acc, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID,
	})
	if err != nil {
		t.Fatalf("open account: %v", err)
	}

	_, err = wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 20_000,
		ProviderRef: "provider-ref-1", Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("confirm deposit: %v", err)
	}

	bal, err := ledger.GetBalance(ctx, pool, tenantID, acc.ID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 20_000 {
		t.Fatalf("expected balance 20000, got %d", bal.Amount)
	}
}

func TestTransferP2P_MovesFundsBetweenTwoAccounts(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	senderID := "customer-" + uuid.NewString()[:8]
	recipientID := "customer-" + uuid.NewString()[:8]

	senderAcc, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: senderID})
	if err != nil {
		t.Fatalf("open sender account: %v", err)
	}
	recipientAcc, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: recipientID})
	if err != nil {
		t.Fatalf("open recipient account: %v", err)
	}

	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: senderID, Amount: 10_000,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund sender: %v", err)
	}

	if _, err := wallet.TransferP2P(ctx, pool, wallet.TransferP2PInput{
		TenantID: tenantID, FromExternalCustomerID: senderID, ToExternalCustomerID: recipientID,
		Amount: 4_000, Reference: "P2P-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("p2p transfer: %v", err)
	}

	senderBal, err := ledger.GetBalance(ctx, pool, tenantID, senderAcc.ID)
	if err != nil {
		t.Fatalf("get sender balance: %v", err)
	}
	if senderBal.Amount != 6_000 {
		t.Fatalf("expected sender balance 6000, got %d", senderBal.Amount)
	}

	recipientBal, err := ledger.GetBalance(ctx, pool, tenantID, recipientAcc.ID)
	if err != nil {
		t.Fatalf("get recipient balance: %v", err)
	}
	if recipientBal.Amount != 4_000 {
		t.Fatalf("expected recipient balance 4000, got %d", recipientBal.Amount)
	}
}

func TestTransferP2P_SameAccountRejected(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open account: %v", err)
	}

	_, err := wallet.TransferP2P(ctx, pool, wallet.TransferP2PInput{
		TenantID: tenantID, FromExternalCustomerID: customerID, ToExternalCustomerID: customerID,
		Amount: 100, Reference: "P2P-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if !errors.Is(err, wallet.ErrSameAccount) {
		t.Fatalf("expected ErrSameAccount, got %v", err)
	}
}

func TestRecordWithdrawal_InsufficientBalanceRejected(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open account: %v", err)
	}

	_, err := wallet.RecordWithdrawal(ctx, pool, wallet.RecordWithdrawalInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 500,
		Reference: "WD-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if !errors.Is(err, ledger.ErrInsufficientBalance) {
		t.Fatalf("expected ErrInsufficientBalance, got %v", err)
	}
}
