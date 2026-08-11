# Payments

Owns account provisioning, inbound settlement resolution, and outbound
payouts — the one thing that changes between "TrustPay riding on
Paystack" and "a licensed MFB issuing its own NUBAN and settling via
NIBSS." Every rail implements the same contract (`src/providers/provider.js`);
callers (TrustPay's backend, or any future tenant's own backend) never
touch a provider SDK directly, only this service's API.

Multi-tenant from day one — own Postgres DB, tenant identity referenced
from (not duplicated from) the Ledger's `tenants` table, provider
credentials encrypted at rest (`src/crypto/tenantSecrets.js`, AES-256-GCM).

## What's real vs. what's a placeholder

**Real, and verified against a live Ledger + a real (though fake-keyed)
Paystack HTTP round trip:**
- The provider contract, proven against two structurally different rails —
  Paystack (implemented) and a self-issued-NUBAN stub (interface only,
  every method rejects "not implemented" — see `src/providers/selfIssuedNuban.js`).
- Webhook signature verification (HMAC-SHA512) and event parsing, unit-tested
  against fixture payloads.
- The full inbound settlement path, run end-to-end against a live Ledger:
  a correctly-signed webhook resolves the account, calls the Ledger's
  `deposit/confirm`, and the Ledger's own outbox delivered the resulting
  event — replaying the same webhook does not double-credit, and a bad
  signature is rejected with 401.
- The outbound path's failure handling: forced a real Paystack API call to
  fail (fake credentials — genuinely rejected by Paystack, not simulated)
  and confirmed the ledger debit gets reversed automatically.
- Tenant credential encryption round-trips and rejects tampered ciphertext
  (auth tag check).

**Not verified — needs live Paystack credentials this environment doesn't
have:** `provisionAccount` actually creating a Paystack DVA, `verifyIdentity`
against real BVN/NIN data, and a *successful* payout. The code path for
all three is the same one exercised (successfully) in the inbound test and
(via its failure branch) in the outbound test — only the "Paystack accepts
the request" half is unverified here.

**Explicit placeholders:**
- **Auth** (`src/middleware/auth.js`) — shared secret, same caveat as the
  Ledger's. Two real callers now (TrustPay's backend, and this service's
  own tenant-config bootstrap step) — worth tiering before a third shows up.
- **`selfIssuedNuban.js`** — interface only. NUBAN generation and a NIBSS
  switching-partner integration aren't built; nothing needs them yet.

## Setup

```bash
createdb trustbank_payments
cp .env.example .env   # then edit it — PAYMENTS_ENCRYPTION_KEY: openssl rand -hex 32

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustbank_payments
npx prisma migrate deploy

npm install
npm run dev   # :8081, requires the Ledger service already running
```

## API

```bash
# Register this tenant's rail — tenantId must already exist on the Ledger
# (POST /v1/tenants there first).
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/config \
  -H "Authorization: Bearer $PAYMENTS_SHARED_SECRET" \
  -d '{"tenantSlug":"trustpay","provider":"paystack","credentials":{"secretKey":"sk_live_...","webhookSecret":"whsec_..."}}'

# Provision a customer's account (DVA for Paystack)
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/accounts \
  -H "Authorization: Bearer $PAYMENTS_SHARED_SECRET" \
  -d '{"externalCustomerId":"user-123","firstName":"Ada","lastName":"Lovelace","phoneNumber":"+2348010000000"}'

# BVN/NIN check
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/identity/verify \
  -H "Authorization: Bearer $PAYMENTS_SHARED_SECRET" \
  -d '{"type":"bvn","number":"12345678901","firstName":"Ada","lastName":"Lovelace"}'

# Payout — call only after the caller has already debited the customer
# on the Ledger; pass that journal entry's id so a provider failure can
# be reversed automatically.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/payouts \
  -H "Authorization: Bearer $PAYMENTS_SHARED_SECRET" \
  -d '{"externalCustomerId":"user-123","amount":10000,"beneficiaryAccountNumber":"0123456789","beneficiaryBankCode":"058","reference":"WD-1","debitJournalEntryId":"<ledger-journal-entry-id>"}'

# Webhook (Paystack calls this — tenantSlug in the path since a webhook
# URL has no room for an authenticated lookup)
# POST /v1/webhooks/:tenantSlug/paystack
```

## Layout

```
prisma/               TenantProviderConfig, ProvisionedAccount, SettlementAttempt
src/providers/         the contract (provider.js) + paystack.js + selfIssuedNuban.js (stub)
src/crypto/            tenant credential encryption at rest
src/services/          tenantConfigService, accountProvisioningService, settlementService, ledgerClient
src/routes/            tenantConfig, accounts, identity, payouts, webhooks
```

## Testing

`tests/paystackProvider.test.js` and `tests/providerConformance.test.js`
need no live credentials or database — pure unit tests against fixtures.
`tests/tenantSecrets.test.js` covers the encryption round trip. The
inbound/outbound settlement flow was verified manually end-to-end against
a live Ledger during development (see the "what's real" section above) —
not yet captured as an automated integration test in this repo.
