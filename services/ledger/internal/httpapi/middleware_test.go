package httpapi_test

// Integration tests against a real Postgres and the actual HTTP server —
// see internal/ledger's service_test.go for the general pattern.
// DATABASE_URL must point at a database with migrations/0001-0004
// applied; tests skip cleanly if unset. This file specifically covers the
// bug SERVICE_CREDENTIAL_MODEL.md was written to fix: the old
// requireSecret+requireTenant pair never cross-checked each other, so any
// caller holding the one shared secret could claim any X-Tenant-Id.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/credential"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/httpapi"
	"trustbank/ledger/internal/tenant"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set — skipping httpapi integration tests")
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
		Slug: "mw-test-" + suffix, Name: "MW Test " + suffix,
		LicenseType: domain.UnitMFB, BaseCurrency: "NGN",
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	return tn.ID
}

func issueToken(t *testing.T, pool *pgxpool.Pool, tenantID string, scope credential.Scope) string {
	t.Helper()
	var tid *string
	if tenantID != "" {
		tid = &tenantID
	}
	_, token, err := credential.Issue(context.Background(), pool, credential.IssueInput{
		TenantID: tid, Label: "test", Scope: scope,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	return token
}

func TestRequireApiKey_ValidOperateTokenAccepted(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	token := issueToken(t, pool, tenantID, credential.ScopeOperate)

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/v1/customers/nobody/account", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Tenant-Id", tenantID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	// 404 (account not found) proves auth passed and the handler ran —
	// 401/403 would mean auth itself rejected the request.
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		t.Errorf("status = %d, want auth to succeed (got an auth rejection)", resp.StatusCode)
	}
}

func TestRequireApiKey_InvalidTokenRejected(t *testing.T) {
	pool := testPool(t)
	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/v1/customers/nobody/account", nil)
	req.Header.Set("Authorization", "Bearer garbage")
	req.Header.Set("X-Tenant-Id", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestRequireApiKey_RevokedTokenRejected(t *testing.T) {
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

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/v1/customers/nobody/account", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Tenant-Id", tenantID)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 for a revoked token", resp.StatusCode)
	}
}

func TestRequireApiKey_OperateScopeRejectedOnAdminRoute(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	token := issueToken(t, pool, tenantID, credential.ScopeOperate)

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/v1/credentials", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403 (operate scope calling an admin route)", resp.StatusCode)
	}
}

func TestRequireApiKey_AdminScopeCanIssueAndListItsOwnTenantsCredentials(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	token := issueToken(t, pool, tenantID, credential.ScopeAdmin)

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/v1/credentials", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200 (admin scope listing its own tenant's credentials)", resp.StatusCode)
	}
}

// This is the actual regression test for the bug this whole pass exists
// to fix: the old requireSecret+requireTenant pair never cross-checked
// each other, so a valid credential for tenant A could act as tenant B by
// just setting a different X-Tenant-Id header.
func TestRequireApiKey_RejectsTenantIdHeaderMismatch(t *testing.T) {
	pool := testPool(t)
	tenantA := freshTenantID(t, pool)
	tenantB := freshTenantID(t, pool)
	tokenForA := issueToken(t, pool, tenantA, credential.ScopeOperate)

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/v1/customers/nobody/account", nil)
	req.Header.Set("Authorization", "Bearer "+tokenForA)
	req.Header.Set("X-Tenant-Id", tenantB) // spoofed — this credential belongs to tenant A
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403 — a tenant-A credential must not be able to claim tenant B", resp.StatusCode)
	}
}

func TestRequireApiKey_PlatformAdminCanCreateTenant(t *testing.T) {
	pool := testPool(t)
	token := issueToken(t, pool, "", credential.ScopePlatformAdmin)

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	suffix := uuid.New().String()[:8]
	req, _ := http.NewRequest("POST", srv.URL+"/v1/tenants", strings.NewReader(
		`{"slug":"pa-test-`+suffix+`","name":"PA Test","licenseType":"UNIT_MFB","baseCurrency":"NGN"}`,
	))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Errorf("status = %d, want 201", resp.StatusCode)
	}
}

func TestRequireApiKey_OperateScopeCannotCreateTenant(t *testing.T) {
	pool := testPool(t)
	tenantID := freshTenantID(t, pool)
	token := issueToken(t, pool, tenantID, credential.ScopeOperate)

	srv := httptest.NewServer(httpapi.NewServer(pool))
	defer srv.Close()

	req, _ := http.NewRequest("POST", srv.URL+"/v1/tenants", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403 — only platform-admin may create tenants", resp.StatusCode)
	}
}
