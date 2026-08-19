// Command backfill-loan-loss-accounts ensures every existing tenant has
// GL 1250/5200 and their SYS-LOAN-LOSS-RESERVE/SYS-LOAN-LOSS-PROVISION
// system accounts — the gap tenant.EnsureLoanLossAccounts only closes
// automatically for tenants created *after* this slice shipped.
// Idempotent (EnsureLoanLossAccounts is a no-op if the accounts already
// exist), so safe to rerun. Connects as the migration owner, same
// reasoning as cmd/bootstrap-key: this writes directly, not through the
// runtime HTTP API.
package main

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5"

	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/tenant"
)

func main() {
	dbURL := os.Getenv("MIGRATE_DATABASE_URL")
	if dbURL == "" {
		log.Fatal("MIGRATE_DATABASE_URL is required — this writes directly, bypassing the runtime API")
	}

	ctx := context.Background()
	pool, err := dbctx.NewPool(ctx, dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, `SELECT id, base_currency FROM tenants`)
	if err != nil {
		log.Fatalf("list tenants: %v", err)
	}
	type tenantRow struct{ id, baseCurrency string }
	var tenants []tenantRow
	for rows.Next() {
		var t tenantRow
		if err := rows.Scan(&t.id, &t.baseCurrency); err != nil {
			log.Fatalf("scan tenant: %v", err)
		}
		tenants = append(tenants, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Fatalf("list tenants: %v", err)
	}

	for _, t := range tenants {
		err := dbctx.WithTenant(ctx, pool, t.id, func(ctx context.Context, tx pgx.Tx) error {
			return tenant.EnsureLoanLossAccounts(ctx, tx, t.id, t.baseCurrency)
		})
		if err != nil {
			log.Printf("tenant %s: %v", t.id, err)
			continue
		}
		log.Printf("tenant %s: loan-loss accounts ensured", t.id)
	}
}
