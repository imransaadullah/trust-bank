package ledger_test

// Integration tests against a real Postgres database with the migrations
// in migrations/ already applied — SERIALIZABLE isolation and row-level
// security can't be meaningfully faked with a lighter substitute. Point
// DATABASE_URL at a disposable database and run:
//
//   psql "$DATABASE_URL" -f ../../migrations/0001_init.sql
//   psql "$DATABASE_URL" -f ../../migrations/0002_rls_and_triggers.sql
//   DATABASE_URL=... go test ./...
//
// Tests are skipped entirely if DATABASE_URL is unset.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/account"
	"trustbank/ledger/internal/coa"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/ledger"
	"trustbank/ledger/internal/tenant"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set — skipping ledger integration tests")
	}
	pool, err := dbctx.NewPool(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// freshTenant creates an isolated tenant with a customer deposit account
// (funded to zero) plus the system float account, so each test gets its
// own namespace without needing to truncate tables between runs.
func freshTenant(t *testing.T, pool *pgxpool.Pool) (tenantID, floatAccountID, customerAccountID string) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	tn, sysAccounts, err := tenant.Create(ctx, pool, tenant.CreateInput{
		Slug: "test-" + suffix, Name: "Test Bank " + suffix,
		LicenseType: domain.UnitMFB, BaseCurrency: "NGN",
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	var customerAccID string
	err = dbctx.WithTenant(ctx, pool, tn.ID, func(ctx context.Context, tx pgx.Tx) error {
		depositsGL, err := coa.ByCode(ctx, tx, tn.ID, "2100")
		if err != nil {
			return err
		}
		acc, err := account.Open(ctx, tx, account.OpenInput{
			TenantID: tn.ID, GLAccountID: depositsGL.ID, AccountNumber: "CUST-" + suffix,
			ProductType: "savings", Currency: "NGN",
		})
		if err != nil {
			return err
		}
		customerAccID = acc.ID
		return nil
	})
	if err != nil {
		t.Fatalf("open customer account: %v", err)
	}

	return tn.ID, sysAccounts.Float.ID, customerAccID
}

func TestPostJournalEntry_BalancedMultiLegPosts(t *testing.T) {
	pool := testPool(t)
	tenantID, floatID, customerID := freshTenant(t, pool)
	ctx := context.Background()

	entry, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: tenantID, Reference: "TX-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
		EntryType: "deposit", Currency: "NGN",
		Lines: []ledger.LineInput{
			{LedgerAccountID: floatID, Direction: domain.Debit, Amount: 10_000},
			{LedgerAccountID: customerID, Direction: domain.Credit, Amount: 10_000},
		},
	})
	if err != nil {
		t.Fatalf("post entry: %v", err)
	}
	if len(entry.Lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(entry.Lines))
	}

	bal, err := ledger.GetBalance(ctx, pool, tenantID, customerID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 10_000 {
		t.Fatalf("expected balance 10000, got %d", bal.Amount)
	}
}

func TestPostJournalEntry_UnbalancedRejected(t *testing.T) {
	pool := testPool(t)
	tenantID, floatID, customerID := freshTenant(t, pool)
	ctx := context.Background()

	_, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: tenantID, Reference: "TX-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
		EntryType: "deposit", Currency: "NGN",
		Lines: []ledger.LineInput{
			{LedgerAccountID: floatID, Direction: domain.Debit, Amount: 10_000},
			{LedgerAccountID: customerID, Direction: domain.Credit, Amount: 9_000},
		},
	})
	if !errors.Is(err, ledger.ErrUnbalancedEntry) {
		t.Fatalf("expected ErrUnbalancedEntry, got %v", err)
	}
}

func TestPostJournalEntry_InsufficientBalanceRejected(t *testing.T) {
	pool := testPool(t)
	tenantID, floatID, customerID := freshTenant(t, pool)
	ctx := context.Background()

	// customer account starts at 0 — a withdrawal (debit the liability
	// account, which opposes its CREDIT normal balance) must be rejected.
	_, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: tenantID, Reference: "TX-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
		EntryType: "withdrawal", Currency: "NGN",
		Lines: []ledger.LineInput{
			{LedgerAccountID: customerID, Direction: domain.Debit, Amount: 5_000},
			{LedgerAccountID: floatID, Direction: domain.Credit, Amount: 5_000},
		},
	})
	if !errors.Is(err, ledger.ErrInsufficientBalance) {
		t.Fatalf("expected ErrInsufficientBalance, got %v", err)
	}
}

func TestPostJournalEntry_IdempotentReplayReturnsSameEntry(t *testing.T) {
	pool := testPool(t)
	tenantID, floatID, customerID := freshTenant(t, pool)
	ctx := context.Background()
	idemKey := uuid.NewString()

	in := ledger.PostInput{
		TenantID: tenantID, Reference: "TX-" + uuid.NewString(), IdempotencyKey: idemKey,
		EntryType: "deposit", Currency: "NGN",
		Lines: []ledger.LineInput{
			{LedgerAccountID: floatID, Direction: domain.Debit, Amount: 2_500},
			{LedgerAccountID: customerID, Direction: domain.Credit, Amount: 2_500},
		},
	}

	first, err := ledger.PostJournalEntry(ctx, pool, in)
	if err != nil {
		t.Fatalf("first post: %v", err)
	}
	second, err := ledger.PostJournalEntry(ctx, pool, in)
	if err != nil {
		t.Fatalf("replayed post: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected replay to return the same entry, got %s and %s", first.ID, second.ID)
	}

	bal, err := ledger.GetBalance(ctx, pool, tenantID, customerID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 2_500 {
		t.Fatalf("expected balance 2500 (not doubled), got %d", bal.Amount)
	}
}

func TestReverseJournalEntry_RestoresBalanceAndBlocksDoubleReversal(t *testing.T) {
	pool := testPool(t)
	tenantID, floatID, customerID := freshTenant(t, pool)
	ctx := context.Background()

	entry, err := ledger.PostJournalEntry(ctx, pool, ledger.PostInput{
		TenantID: tenantID, Reference: "TX-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
		EntryType: "deposit", Currency: "NGN",
		Lines: []ledger.LineInput{
			{LedgerAccountID: floatID, Direction: domain.Debit, Amount: 7_000},
			{LedgerAccountID: customerID, Direction: domain.Credit, Amount: 7_000},
		},
	})
	if err != nil {
		t.Fatalf("post entry: %v", err)
	}

	_, err = ledger.ReverseJournalEntry(ctx, pool, ledger.ReverseInput{
		TenantID: tenantID, JournalEntryID: entry.ID, Reason: "customer dispute",
		IdempotencyKey: uuid.NewString(),
	})
	if err != nil {
		t.Fatalf("reverse entry: %v", err)
	}

	bal, err := ledger.GetBalance(ctx, pool, tenantID, customerID)
	if err != nil {
		t.Fatalf("get balance: %v", err)
	}
	if bal.Amount != 0 {
		t.Fatalf("expected balance restored to 0, got %d", bal.Amount)
	}

	_, err = ledger.ReverseJournalEntry(ctx, pool, ledger.ReverseInput{
		TenantID: tenantID, JournalEntryID: entry.ID, Reason: "duplicate reversal attempt",
		IdempotencyKey: uuid.NewString(),
	})
	if !errors.Is(err, ledger.ErrAlreadyReversed) {
		t.Fatalf("expected ErrAlreadyReversed, got %v", err)
	}
}

// TestRowLevelSecurity_BlocksCrossTenantReadEvenWithoutAppFilter proves the
// RLS policies in migrations/0002_rls_and_triggers.sql are a real second
// line of defense: it deliberately runs a query that omits tenant_id from
// the WHERE clause (the bug RLS exists to catch) and confirms tenant A
// still can't see tenant B's row.
func TestRowLevelSecurity_BlocksCrossTenantReadEvenWithoutAppFilter(t *testing.T) {
	pool := testPool(t)
	tenantAID, _, _ := freshTenant(t, pool)
	_, _, tenantBAccountID := freshTenant(t, pool)
	ctx := context.Background()

	var rowCount int
	err := dbctx.WithTenant(ctx, pool, tenantAID, func(ctx context.Context, tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `SELECT count(*) FROM ledger_accounts WHERE id = $1`, tenantBAccountID)
		return row.Scan(&rowCount)
	})
	if err != nil {
		t.Fatalf("query under tenant A context: %v", err)
	}
	if rowCount != 0 {
		t.Fatalf("expected RLS to hide tenant B's account from tenant A, got %d rows", rowCount)
	}
}
