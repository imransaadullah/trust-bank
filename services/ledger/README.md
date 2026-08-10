# Core Ledger

Phase 1 of `CORE_BANKING_PLATFORM_ARCHITECTURE.md` (repo root): the one
service nothing else is allowed to bypass when money moves. Multi-tenant
double-entry ledger — tenants, chart of accounts, ledger accounts, and
balanced multi-leg journal entries — written in Go against raw SQL (`pgx`,
no ORM), on purpose: see the architecture doc's tech-stack section for why
this module specifically gets a stack exception from the rest of the
(Node) platform.

Deposits, Loans, Cards, and the BaaS API layer are later phases and will
call this service rather than write ledger rows themselves.

## What's real vs. what's a placeholder

**Real, and tested against a live Postgres:**
- Multi-leg, balanced journal entries (`internal/ledger`) — `SERIALIZABLE`
  isolation with bounded retry on serialization failure, insufficient-balance
  guard, idempotency-key replay, reversal (never mutation).
- Row-level security keyed on `tenant_id`, enforced at the database as a
  second line of defense behind the application layer.
- Append-only enforcement: `journal_entries` and `ledger_lines` reject
  `UPDATE`/`DELETE` at the trigger level, independent of application code.
- A deferred constraint trigger that rejects an unbalanced entry even if
  application-layer validation has a bug.

**Explicit placeholders, not production-ready:**
- **Auth** (`internal/httpapi/middleware.go`, `internal/config`) — a single
  shared secret plus a trusted `X-Tenant-Id` header. This is a stand-in for
  the tiered publishable/secret API-key model in
  `AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md`. Do not expose this past a trusted
  internal network as-is.
- **No ledger-account-opening route yet** — `internal/account.Open` exists
  and is used internally (system accounts on tenant creation), but there's
  no HTTP route for a caller to open a customer account. Deposits (phase 2)
  owns that product decision; this phase only proves the ledger primitive.
- **Event outbox is written, not drained** — `event_outbox` rows are
  inserted transactionally with every journal entry (the correct half of
  the outbox pattern), but there's no publisher yet reading and delivering
  them to a broker.

## Setup

Requires Go 1.22+ (path-pattern routing in `net/http`) and a Postgres
instance you control.

```bash
createdb trust_bank_ledger
cp .env.example .env   # then edit it

# Migrations run as the owner/superuser:
export MIGRATE_DATABASE_URL=postgres://postgres@localhost:5432/trust_bank_ledger
make migrate

# The service and tests run as the least-privilege ledger_app role that
# 0003_app_role.sql creates — this is not optional. Postgres superusers
# bypass row-level security unconditionally, FORCE ROW LEVEL SECURITY
# notwithstanding, so testing (or running) against a superuser connection
# silently defeats tenant isolation. Confirmed the hard way while building
# this: the RLS cross-tenant test passed for the wrong reason (superuser
# connection) until the connection was switched to ledger_app.
export DATABASE_URL=postgres://ledger_app:change-me-in-production@localhost:5432/trust_bank_ledger
export LEDGER_SHARED_SECRET=dev-secret

make test   # runs the real integration suite in internal/ledger
make run    # starts the HTTP service on :8080
```

## API (prototype surface)

```bash
# Provision a tenant — creates the tenant row, a default chart of
# accounts, and system float/fee-income ledger accounts.
curl -X POST localhost:8080/v1/tenants \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" \
  -d '{"slug":"demo-mfb","name":"Demo MFB","licenseType":"UNIT_MFB","baseCurrency":"NGN"}'

# Post a balanced, multi-leg journal entry.
curl -X POST localhost:8080/v1/journal-entries \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{
    "reference": "TX-1", "idempotencyKey": "idem-1", "entryType": "deposit", "currency": "NGN",
    "lines": [
      {"ledgerAccountId": "'"$FLOAT_ID"'", "direction": "DEBIT",  "amount": 150000},
      {"ledgerAccountId": "'"$CUST_ID"'",  "direction": "CREDIT", "amount": 150000}
    ]
  }'

# Reverse it.
curl -X POST localhost:8080/v1/journal-entries/$ENTRY_ID/reverse \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"reason": "customer dispute", "idempotencyKey": "idem-rev-1"}'

# Read a balance.
curl localhost:8080/v1/accounts/$CUST_ID/balance \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID"
```

Amounts are integers in minor units (kobo for NGN), matching the
architecture doc's convention.

## Layout

```
migrations/          hand-written SQL — no ORM, no migration tool
internal/domain/      shared types, kept close to the table shapes
internal/dbctx/       the one on-ramp for tenant-scoped writes (Serializable tx + RLS context)
internal/coa/         chart of accounts
internal/account/     ledger accounts + balance derivation
internal/ledger/      journal entries — post, reverse, the actual ledger
internal/tenant/      tenant provisioning
internal/httpapi/     thin HTTP layer — no business logic
cmd/ledger/           entrypoint
```

## Testing

`internal/ledger/service_test.go` is a real integration suite (`DATABASE_URL`
required, skips cleanly if unset) covering: balanced posting, unbalanced
rejection, insufficient-balance rejection, idempotent replay, reversal +
double-reversal rejection, and row-level security actually blocking a
query that omits `tenant_id` from its `WHERE` clause — the specific bug RLS
exists to catch.
