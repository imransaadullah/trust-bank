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
- Binds `127.0.0.1` by default (`BIND_HOST`), never `0.0.0.0` — this
  service is never meant to be internet-facing in any deployment model.
  See `../../deploy/NETWORK_TOPOLOGY.md` for how this holds across SaaS,
  on-prem, and hybrid.
- Scoped, revocable, tenant-bound credentials (`internal/credential`)
  replace the old single shared secret — see `../../SERVICE_CREDENTIAL_MODEL.md`.
  Verified live: a `platform-admin` credential provisions tenants; a
  tenant's `admin` credential issues/lists/revokes its own `operate`
  credentials and cannot touch another tenant's; a revoked credential is
  rejected on its very next call; and the actual bug this replaced the
  old auth for — a credential bound to tenant A being used with tenant
  B's id — is rejected with 403 on a real request, not just in a test.
- Locked savings pockets (`internal/wallet/savings.go`) with daily interest
  accrual (`internal/accrual`) — a second ledger-account product type per
  customer, opening/funding/withdrawal composed from the same generic
  journal-entry primitive P2P and deposits use, no new ledger concept
  needed. Verified live: opening debits the wallet and credits the new
  savings account exactly; an early withdrawal against a 30-day lock is
  rejected with the maturity date; a matured (`lockDays: 0`) withdrawal
  succeeds and returns funds to the wallet; the background accrual
  goroutine fired on its own during a live run and posted exactly the
  expected interest (1,000,000 kobo at 3650bps → 1,000 kobo/day), then
  correctly did nothing on a second same-day tick.

**Explicit placeholders, not production-ready:**
- **No mTLS** — credential scoping (above) and the loopback-only bind are
  defense-in-depth together, but a hybrid deployment that puts a caller
  on a genuinely different network still needs a real private tunnel
  (WireGuard) plus mTLS on top of the bearer token. See
  `../../deploy/NETWORK_TOPOLOGY.md` and `../../SERVICE_CREDENTIAL_MODEL.md`.
- **No KYC-tier transaction/daily limits** — `internal/wallet` and
  `internal/ledger` enforce ledger correctness (balance sufficiency,
  account status) but not policy limits by KYC tier. That's deliberately
  left to whatever backend owns KYC for a tenant (TrustPay's, once built).
- **Outbox retry has no backoff and no crash reaper** — a failed delivery
  goes back to `pending` and is retried on the next 5s poll rather than
  with exponential backoff, and a process crash mid-batch can leave rows
  stuck at `processing`. Documented in `internal/outbox`'s package comment.
  Fine at MVP volume; revisit before this carries real traffic.
- **No early savings withdrawal / penalty path** — a locked pocket is
  strictly locked this pass; breaking it early isn't supported, not a
  half-built feature.
- **No centralized savings product catalog** — the interest rate and lock
  period are set per-account at open time (in that account's own
  `metadata`), not drawn from a tenant-wide list of product tiers a
  customer picks from. Fine for one flat product; revisit if TrustPay
  wants multiple named savings products with fixed terms.

**A bug worth knowing about if you're extending this:** `account.GetByExternalCustomerID`
now takes a `productType` argument — a customer can have more than one
ledger account (a wallet, one or more savings pockets), and an unscoped
lookup would non-deterministically resolve to whichever one Postgres
returned first. Every existing caller in `internal/wallet/wallet.go` pins
this to `"wallet"`; if you add a third product type, don't reuse an
unscoped lookup for it.

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

make test   # runs the real integration suite

# Bootstrap the first credentials — see ../../SERVICE_CREDENTIAL_MODEL.md
export MIGRATE_DATABASE_URL=postgres://postgres@localhost:5432/trust_bank_ledger
go run ./cmd/bootstrap-key --scope platform-admin --label ops-bootstrap
# -> use that token to POST /v1/tenants (below), then:
go run ./cmd/bootstrap-key --scope admin --tenant-id $TENANT_ID --label ops-bootstrap

make run    # starts the HTTP service on :8080
```

## API

```bash
# Provision a tenant — creates the tenant row, a default chart of
# accounts, and system float/fee-income ledger accounts. webhookUrl is
# optional; set it to receive ledger events. Requires a platform-admin
# credential — the one bootstrapped above, or issued by another
# platform-admin credential; not tenant-bound, never embedded in a
# running service.
curl -X POST localhost:8080/v1/tenants \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" \
  -d '{"slug":"trustpay","name":"TrustPay","licenseType":"BAAS_RESELLER","baseCurrency":"NGN","webhookUrl":"https://trustpay.example/webhooks/ledger"}'

# Issue an operate-scope credential for a real caller (e.g. trustpay-backend),
# using the tenant's admin credential from the bootstrap step above.
curl -X POST localhost:8080/v1/credentials \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"label":"trustpay-backend","scope":"operate"}'
# -> { id, label, scope, tokenPrefix, token }  — token is shown once

# Everything below uses that operate token.
OPERATE_TOKEN=...

# Open a wallet account for a customer.
curl -X POST localhost:8080/v1/accounts \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","productType":"wallet","kycTier":0}'

# Look an account up by the customer ID the calling backend uses.
curl localhost:8080/v1/customers/user-123/account \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID"

# Record a deposit the backend already collected via a provider.
curl -X POST localhost:8080/v1/transfers/deposit/confirm \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","amount":150000,"providerRef":"paystack-ref-1","reference":"DEP-1","idempotencyKey":"idem-dep-1"}'

# P2P transfer between two TrustPay wallets.
curl -X POST localhost:8080/v1/transfers/p2p \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"fromExternalCustomerId":"user-123","toExternalCustomerId":"user-456","amount":5000,"reference":"P2P-1","idempotencyKey":"idem-p2p-1"}'

# Record a withdrawal the backend is paying out via a provider.
curl -X POST localhost:8080/v1/transfers/withdrawal \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","amount":10000,"reference":"WD-1","idempotencyKey":"idem-wd-1"}'

# Read a balance.
curl localhost:8080/v1/accounts/$ACCOUNT_ID/balance \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID"

# Open and fund a locked savings pocket (rate in basis points, e.g. 1200 = 12% APY).
curl -X POST localhost:8080/v1/savings/accounts \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","annualRateBps":1200,"lockDays":30,"principalKobo":1000000,"reference":"SAV-1","idempotencyKey":"idem-sav-1"}'

# Withdraw from a matured savings account — rejected with the maturity
# date if called before lockDays has elapsed.
curl -X POST localhost:8080/v1/savings/accounts/$SAVINGS_ACCOUNT_ID/withdraw \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"externalCustomerId":"user-123","amount":50000,"reference":"SAVWD-1","idempotencyKey":"idem-savwd-1"}'

curl localhost:8080/v1/customers/user-123/savings-accounts \
  -H "Authorization: Bearer $OPERATE_TOKEN" -H "X-Tenant-Id: $TENANT_ID"

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
internal/wallet/      product-level ops (open account, p2p, deposit/withdrawal, savings) over internal/ledger
internal/accrual/     daily interest posting for locked savings accounts
internal/outbox/      drains event_outbox to tenant webhooks
internal/tenant/      tenant provisioning
internal/credential/  scoped/revocable API credentials — see ../../SERVICE_CREDENTIAL_MODEL.md
internal/httpapi/     thin HTTP layer — no business logic
cmd/ledger/           entrypoint — starts the HTTP server, the outbox consumer, and the accrual consumer goroutines
cmd/bootstrap-key/    issues the first credential for a fresh deployment
```

## Testing

`internal/ledger/service_test.go`, `internal/wallet/wallet_test.go`,
`internal/wallet/savings_test.go`, and `internal/accrual/accrual_test.go`
are real integration suites (`DATABASE_URL` required, skip cleanly if
unset) covering: balanced posting, unbalanced rejection,
insufficient-balance rejection, idempotent replay, reversal +
double-reversal rejection, row-level security actually blocking a query
that omits `tenant_id` from its `WHERE` clause, account opening +
duplicate-customer rejection, P2P between two real accounts,
deposit/withdrawal recording, savings funding/lock-enforcement/maturity,
a customer with both a wallet and a savings account still resolving P2P/
deposit/withdrawal to the wallet (the regression case for the
`GetByExternalCustomerID` product-type fix), and interest accrual math +
same-day idempotency. `internal/credential/credential_test.go` and
`internal/httpapi/middleware_test.go` cover credential issuing/verification/
revocation and, specifically, the tenant-spoofing regression (a credential
bound to tenant A being rejected when a request claims tenant B).

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
