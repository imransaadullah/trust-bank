// Package dbctx provides the one on-ramp every ledger write goes through:
// a Serializable transaction with the tenant pinned via set_config(), so
// row-level security (migrations/0002_rls_and_triggers.sql) enforces
// tenant isolation even if a query forgets a WHERE clause.
package dbctx

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const serializationFailureCode = "40001"

const maxRetries = 5

// NewPool opens a connection pool against databaseURL.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("dbctx: open pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("dbctx: ping: %w", err)
	}
	return pool, nil
}

// WithTenant runs fn inside a Serializable transaction scoped to tenantID.
// A SERIALIZABLE transaction can abort under concurrent contention
// (Postgres error 40001) even when nothing is wrong with the request —
// that's retried automatically, bounded, with jittered backoff. Any other
// error is returned to the caller as-is and the transaction is rolled back.
func WithTenant(ctx context.Context, pool *pgxpool.Pool, tenantID string, fn func(ctx context.Context, tx pgx.Tx) error) error {
	if _, err := uuid.Parse(tenantID); err != nil {
		return fmt.Errorf("dbctx: invalid tenant id %q: %w", tenantID, err)
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(attempt*attempt) * 10 * time.Millisecond
			backoff += time.Duration(rand.Intn(10)) * time.Millisecond
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return ctx.Err()
			}
		}

		err := runOnce(ctx, pool, tenantID, fn)
		if err == nil {
			return nil
		}
		if !isSerializationFailure(err) {
			return err
		}
		lastErr = err
	}
	return fmt.Errorf("dbctx: gave up after %d serialization failures: %w", maxRetries, lastErr)
}

func runOnce(ctx context.Context, pool *pgxpool.Pool, tenantID string, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("dbctx: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) // no-op if already committed

	if _, err := tx.Exec(ctx, `SELECT set_config('app.tenant_id', $1, true)`, tenantID); err != nil {
		return fmt.Errorf("dbctx: set tenant context: %w", err)
	}

	if err := fn(ctx, tx); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("dbctx: commit: %w", err)
	}
	return nil
}

func isSerializationFailure(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == serializationFailureCode
	}
	return false
}
