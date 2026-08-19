-- 0005_ledger_accounts_branch_id.sql
-- Phase 2.5, slice 3: branch/org-unit tagging on ledger accounts.
--
-- Plain nullable TEXT, no FK — same convention external_customer_id
-- already uses. Branch identity lives in services/identity's own
-- Postgres, not the Ledger's, same reasoning that already applies to
-- every other cross-service reference in this platform (a tenant's own
-- customer identity lives in the product backend, not here either).
-- Set once at account-open time, never updated afterward — no new
-- UPDATE grant needed on ledger_app beyond the existing INSERT grant
-- from 0003_app_role.sql.

BEGIN;

ALTER TABLE ledger_accounts ADD COLUMN branch_id TEXT;

CREATE INDEX idx_ledger_accounts_tenant_branch ON ledger_accounts (tenant_id, branch_id);

COMMIT;
