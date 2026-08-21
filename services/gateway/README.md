# Gateway

The public API for external bank/developer integration with trust-bank —
distinct from a tenant's own product backend (`services/trustpay-backend`
for TrustPay), which serves that tenant's *own* consumer app. This is
Phase 2's first slice (`CORE_BANKING_PLATFORM_ARCHITECTURE.md` §13 —
"public API, tiered keys, sandbox, developer portal"): a resilient,
authenticated, rate-limited front door in front of Ledger/Payments/
Compliance's (and, since Phase 4 slice 2, Cards') existing APIs. No new
business logic — proxying, tiered access, and resilience, built in from
the start rather than retrofitted.

Multi-tenant, unlike the product backend: one process serves every bank
tenant on the platform, each with its own API keys and its own stored
Ledger/Payments/Compliance/Cards credential (`TenantBackendCredential`,
encrypted at rest — see `prisma/schema.prisma`'s comment on why this
can't just be one shared `.env` credential the way trustpay-backend's
own backend calls work).

## What's real vs. what's a placeholder

**Real, and verified live** — a throwaway 4-service stack (Ledger,
Payments, Compliance, this service), a real tenant provisioned through
the actual `deploy/provision-tenant.sh` (not by hand):

- **Tiered API keys** (`admin` / `sandbox` / `production`) — same
  shown-once, SHA-256-hashed token pattern every other service in this
  platform uses (`SERVICE_CREDENTIAL_MODEL.md`), extended with a tier and
  a per-key rate limit. `admin` is this service's own bootstrap/ops
  credential (mirrors admin/operate elsewhere); `sandbox`/`production`
  are what a bank's own engineers actually hold.
- **Per-key rate limiting**, Postgres-backed (no Redis — see
  `RateLimitCounter`'s schema comment). Verified live: a 3-req/min key's
  4th request in the same window got a real 429 with the correct
  `Retry-After`, and `X-RateLimit-Remaining` decremented correctly on
  every request in between.
- **Per-backend circuit breaking** (`opossum`) — one breaker per backend
  service, so Ledger trouble can't trip Payments' or Compliance's.
  Verified live: stopped the Ledger mid-run, confirmed a few real
  connection failures (below `volumeThreshold`) followed by the breaker
  opening and every subsequent call failing in ~10ms instead of hanging
  for the timeout; restarted the Ledger, confirmed the breaker correctly
  went half-open after `resetTimeout` and closed again on the next
  successful call.
- **A real bug this caught**: opossum's own default `volumeThreshold` is
  0 — a single failing request (100% of a 1-request sample) already
  exceeds `errorThresholdPercentage` and opens the circuit for every
  caller. A lone connection blip tripped the breaker on the very first
  request during this service's own verification. Fixed by requiring a
  small minimum sample (`CIRCUIT_BREAKER_VOLUME_THRESHOLD`, default 5)
  before the breaker can open at all.
- **Backend error propagation**: a real, meaningful rejection from a
  backend (e.g. Payments' `"No provider configured for tenant X"`, a 404)
  used to collapse into an uninformative `"Internal server error"` 500.
  Caught live calling `/identity/verify` for a tenant with no configured
  Paystack/self-issued-NUBAN provider — fixed so the backend's own status
  code and message reach the caller unchanged
  (`src/middleware/errorHandler.js`).
- **Tenant isolation**: verified live in both directions — a tenant B key
  can't call tenant A's routes, and vice versa (403, same regression
  class already proven for the other three services' credential models).
- **A revoked key is rejected immediately** — verified live.
- **`GET /ready`** — pings each backend's own `/health` directly (not
  through the circuit breakers, so it reflects real-time state) and only
  reports ready if all three answer. Verified live: killing the Ledger
  flipped this to `503 not_ready` immediately; restarting it recovered.
  Nothing else in this platform has a readiness check, only liveness.
- **Real proxied banking calls** — account open, balance, P2P transfer,
  deposit confirm, and a Compliance KYC-tier check were all run for real
  through the gateway during verification, not mocked. See `openapi.yaml`
  for the exact shapes, captured from that run.

- **A genuinely isolated sandbox** (Phase 2 slice 2) — a sandbox-tier key
  now resolves to a real, separate tenant in Ledger/Payments/Compliance
  (`SandboxTenant`, `src/middleware/resolveEffectiveTenant.js`), not the
  same production data at a lower rate limit. The external contract stays
  the same URL (`/v1/tenants/{realTenantId}/...`) for both tiers — only
  which tenant the request actually reaches changes. Provisioned once per
  real tenant at onboarding time by `deploy/provision-tenant.sh`'s
  `provision_sandbox_twin`, not lazily at request time (creating a tenant
  means seeding a full chart of accounts in the Ledger and bootstrapping
  credentials on three services — not something to do mid-request).
  Verified live: opened an account with a sandbox key and a production
  key against the same tenant URL, then confirmed directly against the
  Ledger (bypassing the gateway) that each account is only visible under
  its own tenant's credential — a 404 in both directions, RLS-backed, not
  just gateway-level bookkeeping. A sandbox key used before its tenant's
  twin is registered gets a clean `424 SANDBOX_NOT_PROVISIONED`, verified
  live against a tenant with no twin.
- **A real, latent bug this slice's own precondition exposed**: Payments
  called the Ledger using one single global `LEDGER_API_KEY` from its own
  `.env` for every tenant's settlement calls — harmless with only one
  tenant ever provisioned (TrustPay), but the Ledger cross-checks
  `X-Tenant-Id` against the credential's own bound tenant, so a second
  tenant on the same box (which a sandbox twin necessarily is) would have
  had its deposit-confirm/reversal calls rejected outright. Fixed by
  giving Payments its own per-tenant encrypted credential store
  (`TenantLedgerCredential`, mirroring this service's own
  `TenantBackendCredential`) — verified live by confirming a deposit for
  both the real tenant and its sandbox twin succeed on the same box.
- **A developer portal** (Phase 2 slice 3) — `GET /docs` renders the
  gateway's own live `/openapi.yaml` via a self-hosted Redoc bundle
  (`public/redoc.standalone.js`, vendored once, no CDN at runtime — the
  one CDN reference Redoc's own bundle makes internally for a decorative
  logo asset fails gracefully and doesn't affect the page). Unauthenticated,
  same posture as `/health` — a prospective bank should be able to read
  the API before ever holding a key. Because it renders the actual
  checked-in spec file rather than a separately-hosted copy, the docs can
  never drift from what's shipped. Verified live in a real browser, not
  just curl: full route list renders, schemas expand, response samples
  display, and existing routes are unaffected. Caught one real bug in the
  process — see below.
- **A real bug this caught**: the portal's `Redoc.init()` call was
  originally inline in `index.html`; this service's own `helmet()`
  default CSP (`script-src 'self'`, no `unsafe-inline`) silently blocked
  it — the page loaded and the vendored bundle parsed fine, but the
  loading spinner never cleared and `/openapi.yaml` was never even
  fetched. Found by checking the browser's own network log during live
  verification, not by reading the code. Fixed by moving the init call
  into its own same-origin file (`public/init.js`), which needs no CSP
  relaxation at all — the more minimal fix over widening the CSP.
- **Cards proxying** (Phase 4 slice 2) — a fourth backend added to
  `backendProxy.js`'s `BACKENDS` map, `VALID_SERVICES`, and a new
  `routes/cards.js` mirroring `routes/compliance.js`'s exact shape. No
  new circuit-breaker code — the existing per-backend-breaker loop picks
  up the new entry automatically. Verified live through a real
  production-tier API key: issuance, list, freeze, and unfreeze all
  proxied correctly to a real Cards service, and an existing
  Ledger-proxied route (account open) was confirmed unaffected by the
  change in the same run.
- **Self-serve API key management** (Phase 6) — issue/list/revoke/rotate
  (`POST`/`GET /v1/tenants/:id/api-keys`, `.../:apiKeyId/revoke`,
  `.../:apiKeyId/rotate`) are all reachable with the tenant's own `admin`
  key — zero ops involvement. This was already true before this pass for
  issue/list/revoke; only `rotate` (revoke + reissue in one call) was
  actually new. The only credential ever handed out by
  `provision-tenant.sh` is the *first* `admin` key — the same
  root-credential pattern any serious API platform uses (an AWS root
  access key, Stripe's original secret key), not a missing login system.
- **Usage-transparency dashboard** (Phase 6) — `GET
  /v1/tenants/:id/usage?from=&to=` (`admin`-tier only) returns per-key
  daily request counts for a date range (default: last 30 days), merging
  `ApiKeyDailyUsage`'s rolled-up history with today's still-live
  `RateLimitCounter` rows so "today" is never a blind spot.
  `usageRollupRunner` (hourly by default,
  `USAGE_ROLLUP_POLL_INTERVAL_MINUTES`) aggregates each past day's raw
  per-minute counters into one row per `(apiKeyId, date)` and prunes the
  raw rows it just summed — `RateLimitCounter` had no retention at all
  before this, every window since the service started staying a live row
  forever; closed as a side effect of building the read model a usage
  dashboard needs. Deliberately usage counts only, no cost/quota/plan
  fields — Anchor (the closest direct BaaS competitor) runs negotiated
  subscription pricing, not self-serve metered billing, so this is
  transparency, not a billing engine. Live-verified: rolled-up daily
  totals matched hand-inserted backdated counters exactly, a second
  immediate rerun of the rollup was a true no-op (proving the
  single-transaction insert+prune can't double-count on a crash/restart),
  and the existing 429-after-limit rate-limiting behavior was confirmed
  unaffected by the new background job.

**Explicit placeholders:**
- **No jest test suite yet** — this pass's verification was entirely live
  integration testing (see above), not unit tests. Worth adding, not
  blocking for a first slice.
- **No real billing/metering engine** — cost computation, invoicing, and
  plan/quota enforcement are a real, separate initiative from the
  usage-transparency dashboard above, deliberately out of scope per the
  same Anchor-informed research: this market segment sells on negotiated
  pricing, not self-serve metered billing, so building one speculatively
  isn't a natural extension of what actually exists in the market today.
- **No status page** — `CORE_BANKING_PLATFORM_ARCHITECTURE.md` §10's
  fuller developer-portal vision; not started.
- **`TenantBackendCredential`'s single credential per (tenant, service)**
  — same shape as every other credential in this platform, but if a
  tenant's Ledger/Payments/Compliance operate credential is ever revoked
  independently of the gateway's own record, the gateway won't notice
  until a call actually fails. No proactive revocation-sync exists.

## Setup

```bash
createdb trustbank_gateway
cp .env.example .env   # then edit it — GATEWAY_ENCRYPTION_KEY, backend URLs

npm install
npx prisma migrate deploy
npm run dev   # :8084, requires Ledger/Payments/Compliance already running

# First tenant on a fresh deployment: use deploy/provision-tenant.sh, which
# bootstraps this service's admin key and stores the tenant's backend
# credentials automatically. Manually:
node scripts/bootstrapKey.js --tenant-id $TENANT_ID --label ops-bootstrap
```

## API

See `openapi.yaml` for the full reference. Quick tour:

```bash
# Admin-tier: issue a sandbox key for a bank's engineers to integrate with.
curl -X POST localhost:8084/v1/tenants/$TENANT_ID/api-keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"label":"integration-test","tier":"sandbox"}'
# -> { id, label, tier, tokenPrefix, rateLimitPerMinute, token } — token shown once

# Everything below uses that sandbox/production token.
curl -X POST localhost:8084/v1/tenants/$TENANT_ID/accounts \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"externalCustomerId":"customer-1"}'

curl localhost:8084/v1/tenants/$TENANT_ID/accounts/$LEDGER_ACCOUNT_ID/balance \
  -H "Authorization: Bearer $API_KEY"

curl -X POST localhost:8084/v1/tenants/$TENANT_ID/transfers/p2p \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"fromExternalCustomerId":"customer-1","toExternalCustomerId":"customer-2","amount":5000,"reference":"r1","idempotencyKey":"idem-1"}'

curl -X POST localhost:8084/v1/tenants/$TENANT_ID/compliance/kyc-tier-check \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"userId":"customer-1","tier":1,"amount":1000,"amountTransactedTodayKobo":0}'

# Cards (Phase 4 slice 2) — the tenant needs a TenantCardProviderConfig set
# on services/cards first (POST /v1/tenants/$TENANT_ID/cards-config there).
curl -X POST localhost:8084/v1/tenants/$TENANT_ID/cards \
  -H "Authorization: Bearer $API_KEY" \
  -d '{"externalCustomerId":"customer-1","dailySpendLimitKobo":500000,"singleTxnLimitKobo":200000}'

curl localhost:8084/v1/tenants/$TENANT_ID/customers/customer-1/cards \
  -H "Authorization: Bearer $API_KEY"
```

Amounts are kobo, matching the rest of the platform.

## Layout

```
public/                 the developer portal — index.html + init.js (same-origin, no inline
                        script — see the CSP bug above) + a vendored redoc.standalone.js,
                        served at GET /docs; GET /openapi.yaml serves the spec itself live
prisma/                ApiKey (tiered, rate-limited), RateLimitCounter (Postgres-backed,
                       fixed 1-minute windows), TenantBackendCredential (encrypted
                       per-tenant Ledger/Payments/Compliance/Cards credential), SandboxTenant
                       (real tenant -> its isolated sandbox twin)
scripts/bootstrapKey.js  issues the first admin-tier key for a tenant
src/crypto/tenantBackendCredentials.js  AES-256-GCM, same pattern as services/payments'
                                        tenantSecrets.js
src/middleware/resolveEffectiveTenant.js  swaps in a sandbox-tier key's isolated twin
                                          before any backend call — see src/services/
                                          sandboxTenantService.js
src/services/
  apiKeyService.js              issue/verify/revoke/list — mirrors credentialService.js
                                 across the other three services
  rateLimitService.js            atomic Postgres upsert-increment per request
  tenantBackendCredentialService.js  store/get a tenant's encrypted backend credential
  sandboxTenantService.js         resolve/register a tenant's sandbox twin
  backendProxy.js                 one opossum circuit breaker per backend, unifies
                                   Ledger's header-tenant/raw-response shape and
                                   Payments'/Compliance's path-tenant/wrapped-response
                                   shape so route handlers never see the difference
src/routes/
  sandbox.js                          admin-tier — register/check a tenant's sandbox twin
  apiKeys.js, backendCredentials.js   admin-tier only
  accounts.js                          Ledger: accounts, transfers
  identity.js                          Payments: identity verification, payouts
  compliance.js                        Compliance: kyc-tier-check, device-check
  cards.js                             Cards: issuance, list, freeze/unfreeze/close,
                                        authorize, settle (Phase 4 slice 2) — the
                                        automatic webhook-driven path lives on
                                        services/cards directly, not proxied here
  health.js                            /health (liveness), /ready (readiness)
```
