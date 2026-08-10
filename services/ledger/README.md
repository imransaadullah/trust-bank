# Core Ledger

Phase 1 of `CORE_BANKING_PLATFORM_ARCHITECTURE.md` (repo root): the one
service nothing else is allowed to bypass when money moves. Multi-tenant
double-entry ledger — tenants, chart of accounts, ledger accounts, and
balanced multi-leg journal entries — written in Go against raw SQL (`pgx`,
no ORM), on purpose: see the architecture doc's tech-stack section for why
this module specifically gets a stack exception from the rest of the
(Node) platform.

**TrustPay is the first tenant.** A new, standalone Node backend for
TrustPay (owning Paystack/Kuda, BVN/NIN KYC, bills — none of which live
here) will call this service for everything ledger-of-record: opening
accounts, P2P, and recording deposits/withdrawals it already collected or
paid out through a provider. That backend, the provider integration, and
the TrustPay app are a separate, later effort — not part of this service.
TrustChat's existing wallet (the old Node `core-banking/`) is untouched
and keeps running as-is.

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
- Product-level wallet operations (`internal/wallet`): open an account for
  a customer, P2P transfer, deposit-confirm, withdrawal — each resolving
  external customer IDs to ledger accounts before calling `internal/ledger`.
- An outbox consumer (`internal/outbox`) that drains `event_outbox` and
  `POST`s each event to the owning tenant's webhook URL, with retry up to
  `max_retries`.

**Explicit placeholders, not production-ready:**
- **Auth** (`internal/httpapi/middleware.go`, `internal/config`) — a single
  shared secret plus a trusted `X-Tenant-Id` header. This is a stand-in for
  the tiered publishable/secret API-key model in
  `AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md`. Fine for now — there's one real
  caller (the future TrustPay backend) — but replace before a second real
  caller shows up, and don't expose this past a trusted internal network
  as-is.
- **No KYC-tier transaction/daily limits** — `internal/wallet` and
  `internal/ledger` enforce ledger correctness (balance sufficiency,
  account status) but not policy limits by KYC tier. That's deliberately
  left to whatever backend owns KYC for a tenant (TrustPay's, once built).
- **Outbox retry has no backoff and no crash reaper** — a failed delivery
  goes back to `pending` and is retried on the next 5s poll rather than
  with exponential backoff, and a process crash mid-batch can leave rows
  stuck at `processing`. Documented in `internal/outbox`'s package comment.
  Fine at MVP volume; revisit before this carries real traffic.

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

make test   # runs the real integration suite
make run    # starts the HTTP service on :8080
```

## API

```bash
# Provision a tenant — creates the tenant row, a default chart of
# accounts, and system float/fee-income ledger accounts. webhookUrl is
# optional; set it to receive ledger events.
curl -X POST localhost:8080/v1/tenants \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" \
  -d '{"slug":"trustpay","name":"TrustPay","licenseType":"BAAS_RESELLER","baseCurrency":"NGN","webhookUrl":"https://trustpay.example/webhooks/ledger"}'

# Open a wallet account for a customer.
curl -X POST localhost:8080/v1/accounts \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","productType":"wallet","kycTier":0}'

# Look an account up by the customer ID the calling backend uses.
curl localhost:8080/v1/customers/user-123/account \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID"

# Record a deposit the backend already collected via a provider.
curl -X POST localhost:8080/v1/transfers/deposit/confirm \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","amount":150000,"providerRef":"paystack-ref-1","reference":"DEP-1","idempotencyKey":"idem-dep-1"}'

# P2P transfer between two TrustPay wallets.
curl -X POST localhost:8080/v1/transfers/p2p \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"fromExternalCustomerId":"user-123","toExternalCustomerId":"user-456","amount":5000,"reference":"P2P-1","idempotencyKey":"idem-p2p-1"}'

# Record a withdrawal the backend is paying out via a provider.
curl -X POST localhost:8080/v1/transfers/withdrawal \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","amount":10000,"reference":"WD-1","idempotencyKey":"idem-wd-1"}'

# Read a balance.
curl localhost:8080/v1/accounts/$ACCOUNT_ID/balance \
  -H "Authorization: Bearer $LEDGER_SHARED_SECRET" -H "X-Tenant-Id: $TENANT_ID"

# Generic multi-leg entry and reversal are still available directly for
# anything the convenience routes above don't cover:
curl -X POST localhost:8080/v1/journal-entries ...
curl -X POST localhost:8080/v1/journal-entries/$ENTRY_ID/reverse ...
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
internal/ledger/      journal entries — post, reverse, the generic primitive
internal/wallet/      product-level ops (open account, p2p, deposit/withdrawal) over internal/ledger
internal/outbox/      drains event_outbox to tenant webhooks
internal/tenant/      tenant provisioning
internal/httpapi/     thin HTTP layer — no business logic
cmd/ledger/           entrypoint — starts the HTTP server and the outbox consumer goroutine
```

## Testing

`internal/ledger/service_test.go` and `internal/wallet/wallet_test.go` are
real integration suites (`DATABASE_URL` required, skip cleanly if unset)
covering: balanced posting, unbalanced rejection, insufficient-balance
rejection, idempotent replay, reversal + double-reversal rejection,
row-level security actually blocking a query that omits `tenant_id` from
its `WHERE` clause, account opening + duplicate-customer rejection, P2P
between two real accounts, and deposit/withdrawal recording.

## Deployment (VPS / systemd)

Single static binary, no runtime to install:

```bash
make build                                 # -> bin/ledger
scp bin/ledger user@vps:/home/ubuntu/apps/trustpay-ledger/bin/ledger
scp .env user@vps:/home/ubuntu/apps/trustpay-ledger/.env   # DATABASE_URL must point at ledger_app, not the migration owner
scp ../../deploy/trustpay-ledger.service user@vps:/etc/systemd/system/
ssh user@vps 'sudo systemctl daemon-reload && sudo systemctl enable --now trustpay-ledger'
```

Run migrations once against the target database before first start (same
`make migrate` as above, `MIGRATE_DATABASE_URL` pointed at the VPS's
Postgres). `deploy/trustpay-ledger.service` at the repo root mirrors the
existing `trustchat-banking.service` pattern used for the old core-banking
service — same `Restart=always`, `NoNewPrivileges`, journal logging.
