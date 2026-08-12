// Package credential replaces the single static LEDGER_SHARED_SECRET with
// scoped, revocable, tenant-bound API credentials. See
// SERVICE_CREDENTIAL_MODEL.md (repo root) for the design.
package credential

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Scope string

const (
	ScopePlatformAdmin Scope = "platform-admin" // not tenant-bound — POST /v1/tenants only
	ScopeAdmin         Scope = "admin"
	ScopeOperate       Scope = "operate"
)

const tokenPrefixLabel = "lgr_live_"

var (
	ErrInvalidToken = errors.New("credential: invalid or revoked token")
	ErrNotFound     = errors.New("credential: not found")
)

type Credential struct {
	ID          string
	TenantID    *string
	Label       string
	TokenPrefix string
	Scope       Scope
	Status      string
	CreatedAt   time.Time
	RevokedAt   *time.Time
	LastUsedAt  *time.Time
}

type IssueInput struct {
	TenantID *string // nil only for ScopePlatformAdmin
	Label    string
	Scope    Scope
}

// Issue generates a new token, stores only its hash, and returns the
// plaintext token exactly once — same convention as Stripe/GitHub. There
// is no way to retrieve it again after this call returns.
func Issue(ctx context.Context, pool *pgxpool.Pool, in IssueInput) (*Credential, string, error) {
	if in.Scope == ScopePlatformAdmin && in.TenantID != nil {
		return nil, "", fmt.Errorf("credential: platform-admin must not be tenant-bound")
	}
	if in.Scope != ScopePlatformAdmin && in.TenantID == nil {
		return nil, "", fmt.Errorf("credential: %s scope requires a tenantId", in.Scope)
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, "", fmt.Errorf("credential: generate token: %w", err)
	}
	randomHex := hex.EncodeToString(raw)
	token := tokenPrefixLabel + randomHex
	prefix := tokenPrefixLabel + randomHex[:12]
	hashed := hashToken(token)

	c := &Credential{TenantID: in.TenantID, Label: in.Label, TokenPrefix: prefix, Scope: in.Scope, Status: "active"}
	row := pool.QueryRow(ctx, `
		INSERT INTO api_credentials (tenant_id, label, token_prefix, hashed_token, scope)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at
	`, in.TenantID, in.Label, prefix, hashed, in.Scope)
	if err := row.Scan(&c.ID, &c.CreatedAt); err != nil {
		return nil, "", fmt.Errorf("credential: issue: %w", err)
	}

	return c, token, nil
}

// Verify looks up the credential for a bearer token, confirms it's active,
// and records the call. It does not check scope or tenant binding — the
// HTTP middleware does that, since only it knows the request's required
// scope and claimed tenant.
func Verify(ctx context.Context, pool *pgxpool.Pool, token string) (*Credential, error) {
	if len(token) < len(tokenPrefixLabel)+12 {
		return nil, ErrInvalidToken
	}
	prefix := token[:len(tokenPrefixLabel)+12]

	c := &Credential{}
	row := pool.QueryRow(ctx, `
		SELECT id, tenant_id, label, token_prefix, hashed_token, scope, status, created_at, revoked_at, last_used_at
		FROM api_credentials WHERE token_prefix = $1
	`, prefix)
	var hashed string
	if err := row.Scan(&c.ID, &c.TenantID, &c.Label, &c.TokenPrefix, &hashed, &c.Scope, &c.Status, &c.CreatedAt, &c.RevokedAt, &c.LastUsedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidToken
		}
		return nil, fmt.Errorf("credential: verify: %w", err)
	}

	if subtle.ConstantTimeCompare([]byte(hashed), []byte(hashToken(token))) != 1 {
		return nil, ErrInvalidToken
	}
	if c.Status != "active" {
		return nil, ErrInvalidToken
	}

	// Best-effort — a failed usage-timestamp update shouldn't fail the
	// request it's auditing.
	_, _ = pool.Exec(ctx, `UPDATE api_credentials SET last_used_at = now() WHERE id = $1`, c.ID)

	return c, nil
}

func Revoke(ctx context.Context, pool *pgxpool.Pool, tenantID, credentialID string) error {
	tag, err := pool.Exec(ctx, `
		UPDATE api_credentials SET status = 'revoked', revoked_at = now()
		WHERE id = $1 AND tenant_id = $2 AND status = 'active'
	`, credentialID, tenantID)
	if err != nil {
		return fmt.Errorf("credential: revoke: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func List(ctx context.Context, pool *pgxpool.Pool, tenantID string) ([]*Credential, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, tenant_id, label, token_prefix, scope, status, created_at, revoked_at, last_used_at
		FROM api_credentials WHERE tenant_id = $1 ORDER BY created_at DESC
	`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("credential: list: %w", err)
	}
	defer rows.Close()

	var out []*Credential
	for rows.Next() {
		c := &Credential{}
		if err := rows.Scan(&c.ID, &c.TenantID, &c.Label, &c.TokenPrefix, &c.Scope, &c.Status, &c.CreatedAt, &c.RevokedAt, &c.LastUsedAt); err != nil {
			return nil, fmt.Errorf("credential: list scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
