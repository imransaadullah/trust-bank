-- 0003_app_role.sql
-- A least-privilege role for the running service to connect as.
--
-- This matters more than it looks: RLS policies (0002) are enforced for
-- every role EXCEPT superusers, who bypass RLS unconditionally regardless
-- of FORCE ROW LEVEL SECURITY. If the service connects as the migration
-- owner (commonly a superuser locally), the tenant-isolation policies
-- silently do nothing. Migrations run as the owner; the service must run
-- as ledger_app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN PASSWORD 'change-me-in-production';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ledger_app;

GRANT SELECT, INSERT ON tenants TO ledger_app;
GRANT UPDATE (status, settings, updated_at) ON tenants TO ledger_app;

GRANT SELECT, INSERT ON chart_of_accounts TO ledger_app;
GRANT UPDATE (status, updated_at) ON chart_of_accounts TO ledger_app;

GRANT SELECT, INSERT ON ledger_accounts TO ledger_app;
GRANT UPDATE (status, kyc_tier, metadata, updated_at) ON ledger_accounts TO ledger_app;

-- journal_entries and ledger_lines are INSERT + SELECT only — no UPDATE or
-- DELETE grant at all. The append-only triggers in 0002 are the primary
-- enforcement; this is defense in depth so a bug can't even attempt it.
GRANT SELECT, INSERT ON journal_entries TO ledger_app;
GRANT SELECT, INSERT ON ledger_lines TO ledger_app;

GRANT SELECT, INSERT, UPDATE ON event_outbox TO ledger_app;
GRANT SELECT, INSERT ON audit_log_entries TO ledger_app;
