-- 0004_api_credentials.sql
-- Replaces the single static LEDGER_SHARED_SECRET with scoped, revocable,
-- tenant-bound credentials. See SERVICE_CREDENTIAL_MODEL.md (repo root).
--
-- Not RLS-scoped, same as tenants itself — this table is what establishes
-- which tenant a request is for, so it can't be gated by app.tenant_id
-- (that isn't set yet when this table is consulted). Access is bound by
-- application logic (requireApiKey) instead.

BEGIN;

CREATE TYPE credential_scope AS ENUM ('platform-admin', 'admin', 'operate');
CREATE TYPE credential_status AS ENUM ('active', 'revoked');

CREATE TABLE api_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES tenants(id),
  label         TEXT NOT NULL,
  token_prefix  TEXT NOT NULL UNIQUE,
  hashed_token  TEXT NOT NULL,
  scope         credential_scope NOT NULL,
  status        credential_status NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  -- platform-admin is the one credential type not bound to a tenant (it's
  -- what creates tenants in the first place) — everything else must be.
  CONSTRAINT chk_tenant_scope CHECK (
    (scope = 'platform-admin' AND tenant_id IS NULL)
    OR (scope <> 'platform-admin' AND tenant_id IS NOT NULL)
  )
);

CREATE INDEX idx_api_credentials_tenant ON api_credentials (tenant_id);
CREATE INDEX idx_api_credentials_status ON api_credentials (status);

-- ledger_app (0003) needs to verify credentials on every request (SELECT),
-- issue new ones via the admin-scoped credentials route (INSERT), and
-- record usage/revocation (UPDATE) — no DELETE, a revoked credential is a
-- status change, not a deletion, so the audit trail survives.
GRANT SELECT, INSERT ON api_credentials TO ledger_app;
GRANT UPDATE (status, revoked_at, last_used_at) ON api_credentials TO ledger_app;

COMMIT;
