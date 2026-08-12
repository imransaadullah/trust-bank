package credential_test

// Integration tests against a real Postgres — see internal/ledger's
// service_test.go for the general pattern. DATABASE_URL must point at a
// database with migrations/0001-0004 applied; tests skip cleanly if unset.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/credential"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/tenant"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set — skipping credential integration tests")
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
		Slug: "cred-test-" + suffix, Name: "Cred Test " + suffix,
		LicenseType: domain.UnitMFB, BaseCurrency: "NGN",
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	return tn.ID
}

func TestIssueAndVerify_RoundTrips(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)

	c, token, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: &tenantID, Label: "test-operate", Scope: credential.ScopeOperate,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if token == "" {
		t.Fatal("expected a non-empty plaintext token")
	}

	verified, err := credential.Verify(context.Background(), pool, token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if verified.ID != c.ID {
		t.Errorf("verified.ID = %s, want %s", verified.ID, c.ID)
	}
	if verified.Scope != credential.ScopeOperate {
		t.Errorf("verified.Scope = %s, want operate", verified.Scope)
	}
}

func TestIssue_PlaintextTokenNeverPersisted(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)

	_, token, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: &tenantID, Label: "test", Scope: credential.ScopeOperate,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	var storedHash string
	row := pool.QueryRow(context.Background(), `SELECT hashed_token FROM api_credentials WHERE tenant_id = $1`, tenantID)
	if err := row.Scan(&storedHash); err != nil {
		t.Fatalf("query stored hash: %v", err)
	}
	if storedHash == token {
		t.Fatal("plaintext token was stored directly — must be hashed")
	}
	sum := sha256.Sum256([]byte(token))
	if storedHash != hex.EncodeToString(sum[:]) {
		t.Fatal("stored hash does not match sha256(token)")
	}
}

func TestVerify_RejectsUnknownToken(t *testing.T) {
	pool := testPool(t)
	_, err := credential.Verify(context.Background(), pool, "lgr_live_0000000000000000000000000000000000000000000000000000000000000000")
	if err != credential.ErrInvalidToken {
		t.Errorf("err = %v, want ErrInvalidToken", err)
	}
}

func TestVerify_RejectsRevokedToken(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)

	c, token, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: &tenantID, Label: "test", Scope: credential.ScopeOperate,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := credential.Revoke(context.Background(), pool, tenantID, c.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	_, err = credential.Verify(context.Background(), pool, token)
	if err != credential.ErrInvalidToken {
		t.Errorf("err = %v, want ErrInvalidToken for a revoked token", err)
	}
}

func TestRevoke_UnknownCredentialReturnsNotFound(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	err := credential.Revoke(context.Background(), pool, tenantID, uuid.New().String())
	if err != credential.ErrNotFound {
		t.Errorf("err = %v, want ErrNotFound", err)
	}
}

func TestList_ScopedToTenant(t *testing.T) {
	pool := testPool(t)
	tenantA := freshTenantID(t, pool)
	tenantB := freshTenantID(t, pool)

	if _, _, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: &tenantA, Label: "a-1", Scope: credential.ScopeOperate,
	}); err != nil {
		t.Fatalf("issue for tenant A: %v", err)
	}
	if _, _, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: &tenantB, Label: "b-1", Scope: credential.ScopeOperate,
	}); err != nil {
		t.Fatalf("issue for tenant B: %v", err)
	}

	listA, err := credential.List(context.Background(), pool, tenantA)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listA) != 1 || listA[0].Label != "a-1" {
		t.Errorf("tenant A's list = %+v, want exactly its own credential", listA)
	}
}

func TestIssue_PlatformAdminRejectsTenantID(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	_, _, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: &tenantID, Label: "bad", Scope: credential.ScopePlatformAdmin,
	})
	if err == nil {
		t.Fatal("expected an error binding platform-admin to a tenant")
	}
}

func TestIssue_OperateRequiresTenantID(t *testing.T) {
	pool := testPool(t)
	_, _, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		Label: "bad", Scope: credential.ScopeOperate,
	})
	if err == nil {
		t.Fatal("expected an error issuing an operate credential with no tenantId")
	}
}
