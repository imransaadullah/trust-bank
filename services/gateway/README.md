# Gateway

The public API for external bank/developer integration with trust-bank —
distinct from a tenant's own product backend (`services/trustpay-backend`
for TrustPay), which serves that tenant's *own* consumer app. This is
Phase 2's first slice (`CORE_BANKING_PLATFORM_ARCHITECTURE.md` §13 —
"public API, tiered keys, sandbox, developer portal"): a resilient,
authenticated, rate-limited front door in front of Ledger/Payments/
Compliance's existing APIs. No new business logic — proxying, tiered
access, and resilience, built in from the start rather than retrofitted.

Multi-tenant, unlike the product backend: one process serves every bank
tenant on the platform, each with its own API keys and its own stored
Ledger/Payments/Compliance credential (`TenantBackendCredential`,
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

**Explicit placeholders:**
- **No jest test suite yet** — this pass's verification was entirely live
  integration testing (see above), not unit tests. Worth adding, not
  blocking for a first slice.
- **Sandbox vs. production aren't actually different environments** —
  today `tier` only changes the rate limit; a sandbox key still hits the
  same Ledger/Payments/Compliance instances and real tenant data a
  production key does. A genuinely isolated sandbox (its own tenant, its
  own data, safe to break) is real, separate, later work — see
  `CORE_BANKING_PLATFORM_ARCHITECTURE.md` §13's "sandbox" as its own
  Phase 2 slice.
- **No developer portal** — also its own later slice. `openapi.yaml` is
  the API's documentation today; nothing renders it yet.
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
```

Amounts are kobo, matching the rest of the platform.

## Layout

```
prisma/                ApiKey (tiered, rate-limited), RateLimitCounter (Postgres-backed,
                       fixed 1-minute windows), TenantBackendCredential (encrypted
                       per-tenant Ledger/Payments/Compliance credential)
scripts/bootstrapKey.js  issues the first admin-tier key for a tenant
src/crypto/tenantBackendCredentials.js  AES-256-GCM, same pattern as services/payments'
                                        tenantSecrets.js
src/services/
  apiKeyService.js              issue/verify/revoke/list — mirrors credentialService.js
                                 across the other three services
  rateLimitService.js            atomic Postgres upsert-increment per request
  tenantBackendCredentialService.js  store/get a tenant's encrypted backend credential
  backendProxy.js                 one opossum circuit breaker per backend, unifies
                                   Ledger's header-tenant/raw-response shape and
                                   Payments'/Compliance's path-tenant/wrapped-response
                                   shape so route handlers never see the difference
src/routes/
  apiKeys.js, backendCredentials.js   admin-tier only
  accounts.js                          Ledger: accounts, transfers
  identity.js                          Payments: identity verification, payouts
  compliance.js                        Compliance: kyc-tier-check, device-check
  health.js                            /health (liveness), /ready (readiness)
```
