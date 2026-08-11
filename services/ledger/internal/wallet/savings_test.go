package wallet_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/wallet"
)

func TestOpenSavingsAccount_FundsFromWalletCorrectly(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open wallet: %v", err)
	}
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 100_000_00,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	savingsAcc, entry, err := wallet.OpenSavingsAccount(ctx, pool, wallet.OpenSavingsAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID, AnnualRateBps: 1200, LockDays: 30,
		PrincipalKobo: 40_000_00, Reference: "SAV-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("open savings account: %v", err)
	}
	if entry == nil || len(entry.Lines) != 2 {
		t.Fatalf("expected a 2-line funding entry, got %v", entry)
	}

	walletAcc, err := wallet.GetAccountByCustomer(ctx, pool, tenantID, customerID)
	if err != nil {
		t.Fatalf("get wallet: %v", err)
	}
	walletBal, err := ledger.GetBalance(ctx, pool, tenantID, walletAcc.ID)
	if err != nil {
		t.Fatalf("wallet balance: %v", err)
	}
	if walletBal.Amount != 60_000_00 {
		t.Fatalf("expected wallet balance 60000 (100000-40000), got %d", walletBal.Amount)
	}

	savingsBal, err := ledger.GetBalance(ctx, pool, tenantID, savingsAcc.ID)
	if err != nil {
		t.Fatalf("savings balance: %v", err)
	}
	if savingsBal.Amount != 40_000_00 {
		t.Fatalf("expected savings balance 40000, got %d", savingsBal.Amount)
	}
}

func TestWithdrawSavings_RejectedBeforeMaturity(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open wallet: %v", err)
	}
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 50_000_00,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	savingsAcc, _, err := wallet.OpenSavingsAccount(ctx, pool, wallet.OpenSavingsAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID, AnnualRateBps: 1200, LockDays: 30,
		PrincipalKobo: 20_000_00, Reference: "SAV-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("open savings account: %v", err)
	}

	_, err = wallet.WithdrawSavings(ctx, pool, wallet.WithdrawSavingsInput{
		TenantID: tenantID, ExternalCustomerID: customerID, SavingsAccountID: savingsAcc.ID,
		Amount: 5_000_00, Reference: "WD-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if !errors.Is(err, wallet.ErrSavingsLocked) {
		t.Fatalf("expected ErrSavingsLocked, got %v", err)
	}
}

func TestWithdrawSavings_SucceedsAfterMaturity(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open wallet: %v", err)
	}
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 50_000_00,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	savingsAcc, _, err := wallet.OpenSavingsAccount(ctx, pool, wallet.OpenSavingsAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID, AnnualRateBps: 1200, LockDays: 0,
		PrincipalKobo: 20_000_00, Reference: "SAV-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("open savings account: %v", err)
	}

	_, err = wallet.WithdrawSavings(ctx, pool, wallet.WithdrawSavingsInput{
		TenantID: tenantID, ExternalCustomerID: customerID, SavingsAccountID: savingsAcc.ID,
		Amount: 5_000_00, Reference: "WD-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("withdraw from matured savings: %v", err)
	}

	walletAcc, _ := wallet.GetAccountByCustomer(ctx, pool, tenantID, customerID)
	walletBal, err := ledger.GetBalance(ctx, pool, tenantID, walletAcc.ID)
	if err != nil {
		t.Fatalf("wallet balance: %v", err)
	}
	if walletBal.Amount != 35_000_00 {
		t.Fatalf("expected wallet balance 35000 (50000-20000+5000), got %d", walletBal.Amount)
	}
}

func TestWithdrawSavings_RejectedForWrongCustomer(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	ownerID := "customer-" + uuid.NewString()[:8]
	otherID := "customer-" + uuid.NewString()[:8]

	for _, id := range []string{ownerID, otherID} {
		if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: id}); err != nil {
			t.Fatalf("open wallet for %s: %v", id, err)
		}
	}
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: ownerID, Amount: 50_000_00,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund owner wallet: %v", err)
	}
	savingsAcc, _, err := wallet.OpenSavingsAccount(ctx, pool, wallet.OpenSavingsAccountInput{
		TenantID: tenantID, ExternalCustomerID: ownerID, AnnualRateBps: 1200, LockDays: 0,
		PrincipalKobo: 20_000_00, Reference: "SAV-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("open savings account: %v", err)
	}

	_, err = wallet.WithdrawSavings(ctx, pool, wallet.WithdrawSavingsInput{
		TenantID: tenantID, ExternalCustomerID: otherID, SavingsAccountID: savingsAcc.ID,
		Amount: 5_000_00, Reference: "WD-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if !errors.Is(err, wallet.ErrSavingsAccountNotOwned) {
		t.Fatalf("expected ErrSavingsAccountNotOwned, got %v", err)
	}
}

// TestAccountResolution_WalletAndSavingsDontCrossResolve is the regression
// check for the account.GetByExternalCustomerID product-type fix — before
// it, a customer with both a wallet and a savings account risked P2P/
// deposit/withdrawal silently resolving to the wrong one.
func TestAccountResolution_WalletAndSavingsDontCrossResolve(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	ctx := context.Background()
	customerID := "customer-" + uuid.NewString()[:8]

	walletAcc, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tenantID, ExternalCustomerID: customerID})
	if err != nil {
		t.Fatalf("open wallet: %v", err)
	}
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 50_000_00,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
	savingsAcc, _, err := wallet.OpenSavingsAccount(ctx, pool, wallet.OpenSavingsAccountInput{
		TenantID: tenantID, ExternalCustomerID: customerID, AnnualRateBps: 1200, LockDays: 30,
		PrincipalKobo: 10_000_00, Reference: "SAV-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("open savings account: %v", err)
	}
	if savingsAcc.ID == walletAcc.ID {
		t.Fatalf("savings and wallet accounts should be distinct")
	}

	// A deposit-confirm call after the customer has both accounts must
	// still credit the wallet, not the savings pocket.
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tenantID, ExternalCustomerID: customerID, Amount: 1_000_00,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("second deposit: %v", err)
	}

	walletBal, err := ledger.GetBalance(ctx, pool, tenantID, walletAcc.ID)
	if err != nil {
		t.Fatalf("wallet balance: %v", err)
	}
	if walletBal.Amount != 41_000_00 { // 50000 - 10000 (to savings) + 1000 (second deposit)
		t.Fatalf("expected wallet balance 41000, got %d — deposit may have resolved to the wrong account", walletBal.Amount)
	}

	savingsBal, err := ledger.GetBalance(ctx, pool, tenantID, savingsAcc.ID)
	if err != nil {
		t.Fatalf("savings balance: %v", err)
	}
	if savingsBal.Amount != 10_000_00 {
		t.Fatalf("expected savings balance unchanged at 10000, got %d", savingsBal.Amount)
	}
}
