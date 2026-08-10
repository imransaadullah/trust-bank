-- 0001_init.sql
-- Core ledger schema: tenants, chart of accounts, ledger accounts,
-- journal entries/lines, event outbox, audit log.
-- See trust-bank/CORE_BANKING_PLATFORM_ARCHITECTURE.md sections 3, 5, 6.

BEGIN;

CREATE TYPE license_type AS ENUM (
  'UNIT_MFB', 'STATE_MFB', 'NATIONAL_MFB', 'PSB', 'BAAS_RESELLER', 'OTHER'
);

CREATE TYPE deployment_mode AS ENUM (
  'SHARED', 'DEDICATED_SCHEMA', 'DEDICATED'
);

CREATE TYPE tenant_status AS ENUM (
  'ACTIVE', 'SUSPENDED', 'OFFBOARDING'
);

CREATE TYPE gl_account_type AS ENUM (
  'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'
);

CREATE TYPE entry_direction AS ENUM (
  'DEBIT', 'CREDIT'
);

CREATE TYPE ledger_account_status AS ENUM (
  'ACTIVE', 'FROZEN', 'CLOSED', 'PENDING'
);

-- ============================================
-- TENANTS
-- ============================================
CREATE TABLE tenants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  license_type       license_type NOT NULL,
  deployment_mode    deployment_mode NOT NULL DEFAULT 'SHARED',
  status             tenant_status NOT NULL DEFAULT 'ACTIVE',
  base_currency      TEXT NOT NULL DEFAULT 'NGN',
  settings           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- CHART OF ACCOUNTS
-- ============================================
CREATE TABLE chart_of_accounts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  type               gl_account_type NOT NULL,
  normal_balance     entry_direction NOT NULL,
  parent_id          UUID REFERENCES chart_of_accounts(id),
  is_system_account  BOOLEAN NOT NULL DEFAULT false,
  currency           TEXT NOT NULL DEFAULT 'NGN',
  status             ledger_account_status NOT NULL DEFAULT 'ACTIVE',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX idx_coa_tenant_type ON chart_of_accounts (tenant_id, type);
CREATE INDEX idx_coa_tenant_parent ON chart_of_accounts (tenant_id, parent_id);

-- ============================================
-- LEDGER ACCOUNTS (sub-ledger)
-- ============================================
CREATE TABLE ledger_accounts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id),
  gl_account_id          UUID NOT NULL REFERENCES chart_of_accounts(id),
  account_number         TEXT NOT NULL,
  external_customer_id   TEXT,
  product_type           TEXT NOT NULL,
  status                 ledger_account_status NOT NULL DEFAULT 'ACTIVE',
  currency               TEXT NOT NULL DEFAULT 'NGN',
  kyc_tier               INTEGER NOT NULL DEFAULT 0,
  is_system_account      BOOLEAN NOT NULL DEFAULT false,
  allow_negative_balance BOOLEAN NOT NULL DEFAULT false,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_number)
);

CREATE INDEX idx_ledger_accounts_tenant_customer ON ledger_accounts (tenant_id, external_customer_id);
CREATE INDEX idx_ledger_accounts_tenant_product ON ledger_accounts (tenant_id, product_type);
CREATE INDEX idx_ledger_accounts_tenant_status ON ledger_accounts (tenant_id, status);

-- ============================================
-- JOURNAL ENTRIES (immutable header)
-- ============================================
CREATE TABLE journal_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  reference        TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  entry_type       TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'NGN',
  description      TEXT,
  initiator_id     TEXT,
  initiator_type   TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  reversal_of_id   UUID UNIQUE REFERENCES journal_entries(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, reference)
);

CREATE INDEX idx_journal_entries_tenant_type ON journal_entries (tenant_id, entry_type);
CREATE INDEX idx_journal_entries_tenant_created ON journal_entries (tenant_id, created_at);

-- ============================================
-- LEDGER LINES (immutable, append-only legs)
-- ============================================
CREATE TABLE ledger_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  journal_entry_id   UUID NOT NULL REFERENCES journal_entries(id),
  ledger_account_id  UUID NOT NULL REFERENCES ledger_accounts(id),
  direction          entry_direction NOT NULL,
  amount             BIGINT NOT NULL CHECK (amount > 0),
  currency           TEXT NOT NULL DEFAULT 'NGN',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_lines_tenant_account_created ON ledger_lines (tenant_id, ledger_account_id, created_at);
CREATE INDEX idx_ledger_lines_journal_entry ON ledger_lines (journal_entry_id);

-- ============================================
-- EVENT OUTBOX
-- ============================================
CREATE TABLE event_outbox (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  retry_count   INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 15,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at  TIMESTAMPTZ
);

CREATE INDEX idx_event_outbox_tenant_status_created ON event_outbox (tenant_id, status, created_at);
CREATE INDEX idx_event_outbox_type ON event_outbox (event_type);

-- ============================================
-- AUDIT LOG
-- ============================================
CREATE TABLE audit_log_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  actor_id     TEXT,
  actor_type   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  before       JSONB,
  after        JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant_entity ON audit_log_entries (tenant_id, entity_type, entity_id);
CREATE INDEX idx_audit_log_tenant_created ON audit_log_entries (tenant_id, created_at);

COMMIT;
