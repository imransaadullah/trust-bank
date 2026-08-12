// Command bootstrap-key issues the first credential for a fresh
// deployment — the chicken-and-egg fix, since issuing a credential
// normally requires an admin credential you don't have yet. Run once per
// environment by a human; connects as the migration owner
// (MIGRATE_DATABASE_URL), not the runtime ledger_app role, since it's
// writing directly rather than going through the HTTP API.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"

	"trustbank/ledger/internal/credential"
	"trustbank/ledger/internal/dbctx"
)

func main() {
	scope := flag.String("scope", "", "platform-admin | admin | operate")
	tenantID := flag.String("tenant-id", "", "required for admin/operate; must be empty for platform-admin")
	label := flag.String("label", "bootstrap", "human-readable label for this credential")
	flag.Parse()

	dbURL := os.Getenv("MIGRATE_DATABASE_URL")
	if dbURL == "" {
		log.Fatal("MIGRATE_DATABASE_URL is required — this writes directly, bypassing the runtime API")
	}

	var in credential.IssueInput
	switch credential.Scope(*scope) {
	case credential.ScopePlatformAdmin:
		if *tenantID != "" {
			log.Fatal("platform-admin must not be tenant-bound — omit --tenant-id")
		}
		in = credential.IssueInput{Scope: credential.ScopePlatformAdmin, Label: *label}
	case credential.ScopeAdmin, credential.ScopeOperate:
		if *tenantID == "" {
			log.Fatalf("--tenant-id is required for scope %q", *scope)
		}
		tid := *tenantID
		in = credential.IssueInput{Scope: credential.Scope(*scope), TenantID: &tid, Label: *label}
	default:
		log.Fatalf("--scope must be platform-admin, admin, or operate (got %q)", *scope)
	}

	ctx := context.Background()
	pool, err := dbctx.NewPool(ctx, dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	c, token, err := credential.Issue(ctx, pool, in)
	if err != nil {
		log.Fatalf("issue: %v", err)
	}

	fmt.Printf("Issued credential %s (scope=%s, label=%q)\n", c.ID, c.Scope, c.Label)
	fmt.Printf("Token (shown once, store it now — it cannot be retrieved again):\n\n  %s\n\n", token)
}
