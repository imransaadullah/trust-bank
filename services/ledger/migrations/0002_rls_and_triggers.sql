-- 0002_rls_and_triggers.sql
-- Second line of defense behind the application layer:
--   1. Row-level security keyed on app.tenant_id, so a query that forgot
--      a WHERE tenant_id = $1 still can't cross tenants.
--   2. A deferred constraint trigger that rejects an unbalanced journal
--      entry even if application code has a bug.
--   3. Triggers that make journal_entries and ledger_lines genuinely
--      append-only at the database level, not just by convention.
-- See CORE_BANKING_PLATFORM_ARCHITECTURE.md sections 5 ("tenant isolation
-- is real, not assumed") and 6 (append-only ledger).

BEGIN;

-- ---------- Row-level security ----------
-- The application sets app.tenant_id per-transaction via
-- SELECT set_config('app.tenant_id', $1, true) — see internal/dbctx.
-- FORCE ROW LEVEL SECURITY applies the policy even to the table owner,
-- which matters because the app typically connects as the owning role.

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON chart_of_accounts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ledger_accounts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON journal_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE ledger_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ledger_lines
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON event_outbox
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE audit_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- tenants itself has no tenant_id column (it IS the tenant); access to it
-- is gated at the application layer (platform-admin role) instead.

-- ---------- Balanced-entry constraint ----------
-- Fires once per row change on ledger_lines, deferred to transaction end,
-- and re-checks the full set of lines for that journal entry. Redundant
-- per-row but correct, and cheap at the line-count of a single entry.

CREATE OR REPLACE FUNCTION check_journal_entry_balanced() RETURNS TRIGGER AS $$
DECLARE
  jid UUID;
  debit_total BIGINT;
  credit_total BIGINT;
  line_count INTEGER;
BEGIN
  jid := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0),
    COUNT(*)
  INTO debit_total, credit_total, line_count
  FROM ledger_lines
  WHERE journal_entry_id = jid;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'journal entry % has fewer than 2 lines', jid
      USING ERRCODE = 'check_violation';
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'journal entry % is not balanced: debits=% credits=%',
      jid, debit_total, credit_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_ledger_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balanced();

-- ---------- Append-only enforcement ----------

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable — corrections must be a new, separate entry', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_lines_immutable
  BEFORE UPDATE OR DELETE ON ledger_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER trg_journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
