# Cards

Card issuance and lifecycle orchestration (Phase 4, slice 1) — issuance,
freeze/unfreeze/close, and the two money-adjacent operations a real card
network eventually drives: authorize (a live balance/limit check against
the Ledger) and settle (a real journal entry against the customer's
wallet).

No real PAN, CVV, or PIN exists anywhere in this service, by design, not
by discipline alone — see `../../CORE_BANKING_PLATFORM_ARCHITECTURE.md`
section 7's own requirement that card data live in a separately
network-segmented, PCI-DSS-scoped enclave a certified third party owns.
Every provider call goes through `src/providers/cardIssuingProvider.js`'s
contract (mirrors `services/payments`' own `PaymentsProvider` pattern);
`src/providers/noopCardIssuingProvider.js` is the only implementation
that exists today, since no real card-issuing-as-a-service relationship
does. It returns an obviously-synthetic tokenized reference and a
clearly-fake `last4` — never anything that could be mistaken for real
card data.

A card holds no balance of its own — it's a spending credential that
references an existing wallet on the Ledger. Every real money movement
(`settle`) is a normal Ledger journal entry (`card_settlement`), same as
every other domain service in this platform; this service never becomes
a second source of truth for a balance.

Multi-tenant from day one — own Postgres DB, own scoped
admin/operate credentials (`src/services/credentialService.js`, same
model every other Node service uses), and its own stored per-tenant
Ledger operate credential (`src/services/tenantLedgerCredentialService.js`,
mirrors `services/payments`' `TenantLedgerCredential`) — this service
calls the Ledger directly for `authorize`/`settle` rather than routing
through the product backend, since in a real deployment those two calls
are driven by the card processor's own webhook, not by trustpay-backend's
request lifecycle.

## What's real vs. what's a placeholder

**Real, and verified live against a real Ledger, a real Compliance
policy, and trustpay-backend's own customer-facing routes:**
- Issuance (`POST /v1/tenants/:tenantId/cards`) — the eligibility
  decision (min KYC tier, max cards per customer) is made by the caller
  (trustpay-backend, via a new `CardIssuancePolicy` in
  `services/compliance`) before this service is ever called, same
  "the calling backend checks Compliance first" rule every domain in
  this platform holds. This service never calls Compliance itself.
  `dailySpendLimitKobo`/`singleTxnLimitKobo` are stamped onto the `Card`
  row from that decision at issuance time, not re-read from the policy on
  every `authorize` call.
- `authorize` — a decision object, not an exception, for every
  business-rule reject (same posture as `services/compliance`'s
  `decisionService`): rejects a non-`ACTIVE` card, an amount over
  `singleTxnLimitKobo`, an amount that would push today's settled total
  over `dailySpendLimitKobo` (summed from this service's own
  `CardSettlement` log, not the Ledger), and — the one check that reads
  live state — an amount the linked wallet's *real, current* Ledger
  balance can't cover. Verified live: an amount within every limit and
  the real balance approved; the same amount after the wallet was
  drained (via a real Ledger withdrawal, not a config change) correctly
  declined with "Insufficient wallet balance," proving this reads the
  Ledger live, not a cached figure.
- `settle` — re-runs `authorize`'s own checks rather than trusting a
  prior `authorize` call blindly (no hold/capture linkage exists in this
  slice — see below), then posts a real `card_settlement` journal entry
  (new `internal/wallet.RecordCardSettlement` in the Ledger, structurally
  identical to a withdrawal but its own `entryType` for real accounting
  distinction) and records it locally, idempotent on `idempotencyKey`.
  Verified live: three real settlements against a real wallet, each one
  correctly moving the real balance and correctly counting toward the
  daily limit — a fourth attempt that would cross `dailySpendLimitKobo`
  was declined at the exact boundary (spend-so-far + amount `>` limit,
  not `>=`), confirmed on both sides of that boundary.
- `freeze`/`unfreeze`/`close` — real status transitions
  (`ACTIVE`↔`FROZEN`→`CLOSED`), each calling the provider too (the noop
  stub, today). Verified live: a frozen card's `authorize` call rejects
  regardless of limits/balance; unfreezing restores it; a closed card
  rejects freeze, unfreeze, and authorize alike.
- `maxCardsPerCustomer` — verified live by issuing up to the configured
  limit (2) successfully and having a third rejected before this service
  was ever called, same proof pattern as the KYC-tier rejection.
- trustpay-backend's own `/cards` routes (`src/routes/cards.js` there) —
  issuance, listing, and freeze/unfreeze/close with an ownership check
  (a customer can only act on their own card, verified against their own
  card list — this service's own routes don't enforce that, any operate
  credential can act on any card in its tenant, since the only caller
  today is the trusted product backend).
- **A real multi-provider architecture** (Phase 4, slice 2) — every card
  operation resolves its provider *per tenant, per call*
  (`tenantCardProviderConfigService.getProviderForTenant`), not a
  module-level constant. A new `TenantCardProviderConfig` (mirrors
  `services/payments`' `TenantProviderConfig` exactly — a `provider`
  name, encrypted credentials, a `tenantSlug` for routing inbound
  webhooks pre-auth) means adding a real provider (Sudo Africa or
  otherwise, even "direct" Visa/Mastercard — in practice that still means
  a different processor, not raw ISO 8583; see the architecture doc's
  Phase 4 entry) is a new provider file plus one `registry.js` entry,
  zero other code changes — the exact guarantee Payments already proved
  with two structurally different rails.
- **The inbound half of the provider contract** — `verifyWebhookSignature`,
  `parseWebhookEvent`, `formatAuthorizationResponse` (new on
  `CardIssuingProvider`, mirroring `PaymentsProvider`'s own webhook
  methods, but taking the full headers object rather than one guessed
  header name — different processors use different header names, and the
  provider is the only thing that should have to know which one). New
  `POST /v1/webhooks/:tenantSlug/:provider` (`src/routes/cardWebhooks.js`,
  mounted with `express.raw()`) is the automatic path a real provider
  will eventually drive; slice 1's direct `authorize`/`settle` routes
  stay as the manual/ops equivalent and as how this route itself is
  tested, against the noop provider. Verified live: a correctly-signed
  `authorization` webhook resolved the right `Card` via `cardProviderRef`,
  ran the exact same `authorize` logic slice 1 already proved (limits,
  live balance), and returned the noop provider's own response shape
  synchronously; a bad signature was rejected (401) before any card logic
  ran; an unknown `tenantSlug` was rejected before any provider was
  touched; a `settlement` webhook posted a real `card_settlement` journal
  entry, moving the real wallet balance exactly like slice 1's direct
  `/settle` route does.
- **Gateway proxying** — Cards is now part of the public API a bank
  integrator calls (`services/gateway`'s `routes/cards.js`), reusing the
  existing generic `backendProxy.js`/`proxyRoute` plumbing entirely: one
  `BACKENDS` entry, one route file mirroring `routes/compliance.js`'s
  exact shape, zero new circuit-breaker code (the existing
  per-backend-breaker loop picks it up automatically). Verified live:
  issuance, list, freeze, and unfreeze all proxied correctly through a
  real production-tier Gateway API key, and an existing Ledger-proxied
  route (account open) was unaffected by the change.

**Not covered by this slice, named, not silently dropped:**
- Physical cards — fulfillment logistics are a different problem
  entirely. Still virtual-only.
- A real card-issuing-as-a-service integration — the no-op provider is
  the only one that exists; a concrete one (Sudo Africa or otherwise) is
  a future slice behind the now-generic `CardIssuingProvider` contract.
- Hold/capture linkage between `authorize` and `settle` — `settle`
  re-validates independently rather than consuming a specific prior
  `authorize`'s reservation. A real processor integration would need
  this; this slice doesn't reserve/hold anything on `authorize` alone.
- Tokenization for Apple Pay/Google Pay (EMV Token Service Provider
  integration), chargebacks/disputes, PIN management, 3-D Secure.
- Staff-initiated card actions (an ops/compliance "force freeze" during a
  fraud investigation) — no explicit need today; would live in
  `services/identity`'s routes when one exists, mirroring its
  `accounts.js`.

## Setup

```bash
createdb trustbank_cards
cp .env.example .env   # then edit it — CARDS_ENCRYPTION_KEY: openssl rand -hex 32

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustbank_cards
npx prisma migrate deploy

npm install

# Bootstrap the first (admin) credential for a tenant — see
# ../../SERVICE_CREDENTIAL_MODEL.md. tenantId must already exist on the
# Ledger (POST /v1/tenants there first).
node scripts/bootstrapKey.js --tenant-id $TENANT_ID --scope admin --label ops-bootstrap

# This service needs its own Ledger operate credential (separate from
# trustpay-backend's own) — bootstrap one on the Ledger, then store it here.
curl -X POST localhost:8086/v1/tenants/$TENANT_ID/ledger-credential \
  -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"token":"<ledger operate token>"}'

# Which card provider this tenant is on — 'noop' until a real one
# (Sudo Africa or otherwise) exists. tenantSlug routes inbound
# authorization webhooks before there's an authenticated tenant lookup.
curl -X POST localhost:8086/v1/tenants/$TENANT_ID/cards-config \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"tenantSlug":"my-tenant-slug","provider":"noop"}'

npm run dev   # :8086, requires the Ledger service already running
```

## API

```bash
# Issue an operate-scope credential for a real caller (trustpay-backend).
curl -X POST localhost:8086/v1/tenants/$TENANT_ID/credentials \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"label":"trustpay-backend","scope":"operate"}'
OPERATE_TOKEN=...

# Issuance — normally called by trustpay-backend after its own
# Compliance card-issuance-check, which supplies the limits below.
curl -X POST localhost:8086/v1/tenants/$TENANT_ID/cards \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"externalCustomerId":"user-123","dailySpendLimitKobo":500000,"singleTxnLimitKobo":200000}'

curl "localhost:8086/v1/tenants/$TENANT_ID/customers/user-123/cards" \
  -H "Authorization: Bearer $OPERATE_TOKEN"

curl -X POST "localhost:8086/v1/tenants/$TENANT_ID/cards/$CARD_ID/freeze" -H "Authorization: Bearer $OPERATE_TOKEN"
curl -X POST "localhost:8086/v1/tenants/$TENANT_ID/cards/$CARD_ID/unfreeze" -H "Authorization: Bearer $OPERATE_TOKEN"
curl -X POST "localhost:8086/v1/tenants/$TENANT_ID/cards/$CARD_ID/close" -H "Authorization: Bearer $OPERATE_TOKEN"

# Stand-ins for what a real card processor's own webhooks would trigger.
curl -X POST "localhost:8086/v1/tenants/$TENANT_ID/cards/$CARD_ID/authorize" \
  -H "Authorization: Bearer $OPERATE_TOKEN" -d '{"amountKobo":150000}'

curl -X POST "localhost:8086/v1/tenants/$TENANT_ID/cards/$CARD_ID/settle" \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"amountKobo":150000,"reference":"txn-1","idempotencyKey":"txn-1","description":"POS purchase"}'

# What a real provider's webhook eventually calls automatically — signed
# with that tenant's configured provider credentials, not an operate
# token. cardProviderRef is the Card.providerRef issuance returned.
curl -X POST localhost:8086/v1/webhooks/my-tenant-slug/noop \
  -H "Content-Type: application/json" -H "x-noop-signature: <hmac-sha256 of the body>" \
  -d '{"event":"authorization","cardProviderRef":"noop_card_...","amountKobo":150000,"reference":"wh-1"}'
```

Through `services/gateway` (the public API — requires a real bank's own
production or sandbox API key, not an operate credential):

```bash
curl -X POST "localhost:8084/v1/tenants/$TENANT_ID/cards" \
  -H "Authorization: Bearer $BANK_API_KEY" \
  -d '{"externalCustomerId":"user-123","dailySpendLimitKobo":500000,"singleTxnLimitKobo":200000}'
curl "localhost:8084/v1/tenants/$TENANT_ID/customers/user-123/cards" -H "Authorization: Bearer $BANK_API_KEY"
```

On `services/trustpay-backend` (the customer-facing side — requires the
customer's own JWT, not an operate credential):

```bash
curl -X POST localhost:8082/cards -H "Authorization: Bearer $USER_TOKEN"
curl localhost:8082/cards -H "Authorization: Bearer $USER_TOKEN"
curl -X POST "localhost:8082/cards/$CARD_ID/freeze" -H "Authorization: Bearer $USER_TOKEN"
```

## Layout

```
prisma/                 Card (status/limits/tokenized providerRef, no PAN),
                         CardSettlement (local settled-spend log, backs the
                         daily-limit check), TenantCardProviderConfig (which
                         provider + credentials a tenant is on, tenantSlug for
                         webhook routing), ApiCredential, TenantLedgerCredential
src/providers/
  cardIssuingProvider.js    abstract base — issueCard/freezeCard/unfreezeCard/
                             closeCard, plus verifyWebhookSignature/
                             parseWebhookEvent/formatAuthorizationResponse
                             (Phase 4 slice 2)
  noopCardIssuingProvider.js the only implementation today — logs, never calls
                             out; defines its own webhook shape (nothing real
                             to match yet)
  registry.js               name -> provider class, mirrors services/payments'
                             own registry.js verbatim (Phase 4 slice 2)
src/services/
  cardService.js          issue/freeze/unfreeze/close/authorize/settle/
                           getCardByProviderRef — resolves the provider per
                           tenant per call (tenantCardProviderConfigService),
                           not a module-level constant
  tenantCardProviderConfigService.js  which provider + credentials a tenant is
                                       on, mirrors services/payments'
                                       tenantConfigService.js (Phase 4 slice 2)
  ledgerClient.js          calls the Ledger directly (own stored credential),
                            mirrors services/payments' own
  credentialService.js     scoped admin/operate credentials, same model as
                            every other Node service
  tenantLedgerCredentialService.js  store/get this service's own per-tenant
                                     Ledger credential
scripts/bootstrapKey.js  chicken-and-egg fix — issues the first admin credential
src/routes/
  cards.js                issuance, list, freeze/unfreeze/close, authorize, settle
  cardsConfig.js           admin-scoped, sets a tenant's card provider config
                            (Phase 4 slice 2)
  cardWebhooks.js           POST /v1/webhooks/:tenantSlug/:provider — the
                             automatic path a real provider drives (Phase 4
                             slice 2); mounted with express.raw() in app.js
  credentials.js           admin-scoped credential management
  ledgerCredential.js       admin-scoped, stores this service's Ledger credential
```

## Testing

No automated test suite yet (matches this service's newness — every
other service's suite was added incrementally, not on day one). Verified
live per the "what's real" section above; see the plan history for the
exact sequence.
