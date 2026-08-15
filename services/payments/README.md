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

Also owns bills (airtime/data/electricity/cable) behind its own
independent provider abstraction (`src/providers/billsProvider.js`) —
Kuda implemented (ported from `truechat/core-banking`'s working
integration), a VTpass stub proving the contract generalizes. A tenant's
choice of bills aggregator and its choice of payment rail are
independent — TrustPay might configure Kuda for bills; a different
tenant might configure something else, or nothing. No biller is
hardcoded anywhere outside `billsRegistry.js`.

## What's real vs. what's a placeholder

**Real, and verified against a live Ledger + a real (though fake-keyed)
Paystack HTTP round trip:**
- Binds `127.0.0.1` by default (`BIND_HOST`), never `0.0.0.0` — this
  service is never meant to be internet-facing in any deployment model.
  See `../../deploy/NETWORK_TOPOLOGY.md`.
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
  (auth tag check) — including catching a real cross-process key mismatch
  during development (a decrypt attempt against a row encrypted with a
  different process's key failed loudly, exactly as it should).
- **Reconciliation** (`reconciliationService.js`): a stale outbound
  `SettlementAttempt` (webhook never arrived — the NIBSS-outage case) gets
  polled via `provider.getTransferStatus` and resolved or reversed
  accordingly; one still reported "processing" past the auto-refund SLA
  gets refunded automatically regardless. Verified live: a 2-hour-old
  stale attempt was auto-refunded and the customer's real Ledger balance
  was restored exactly, while a 5-minute-old attempt (not yet stale) was
  correctly left untouched in the same run. The existing webhook-driven
  resolution path (`handleOutboundOutcome`) was re-verified unchanged
  after being refactored to share logic with the new poll path.
- Scoped, revocable, tenant-bound credentials (`src/services/credentialService.js`)
  replace the old single shared secret — see `../../SERVICE_CREDENTIAL_MODEL.md`.
  Verified live end to end, rebuilding the whole 4-service stack from
  scratch with no shared secret anywhere: an `admin` credential
  configures a tenant's rail and issues `operate` credentials; a
  tenant-A credential is rejected with 403 when a request's `:tenantId`
  claims tenant B; a revoked credential is rejected on its very next call.
- **Bills** (`src/services/billsService.js`): the same debit-then-call-
  provider-then-reverse-on-failure pattern as payouts, verified live
  against a real Kuda token-endpoint rejection (fake credentials,
  genuinely rejected with a real 401 — not simulated). A `BillPaymentAttempt`
  row was created `pending`, correctly transitioned to `failed` with the
  real failure reason, the Ledger debit was reversed, and the customer's
  balance was confirmed restored exactly. Deliberately a separate audit
  table from `SettlementAttempt`/payouts — see `BillPaymentAttempt`'s
  comment in `schema.prisma` for why reusing it would have forced any
  bills-only tenant to also configure a payment rail. Also verified: a
  tenant with *only* a bills config (no `TenantProviderConfig` row at
  all) works fine — the whole point of keeping the two tables separate.
  **A correctness fix from the pass that added bills reconciliation:**
  `KudaBillsProvider.purchaseBill` no longer treats Kuda's HTTP acceptance
  as `'completed'` — Kuda's own docs note tokens/PINs "are not always
  returned in the purchase response depending on the bill type," with
  confirmation following via a dedicated `BILL_TSQ` status-query call "a
  few seconds" later. Acceptance now returns `'processing'`; only
  `checkPurchaseStatus` (via `BILL_TSQ`) can confirm `'completed'`. The
  original code made the same synchronous assumption the old
  `truechat/core-banking` system did — grepping that old codebase found
  it never actually resolved a `BILL_PAYMENT_SUCCESS`/`BILL_PAYMENT_FAILED`
  webhook (both fell into an `unknown event` no-op branch), so its
  behavior was "never caught wrong," not "verified correct."
- **Bills reconciliation** (`src/services/billsReconciliationService.js`),
  mirroring the settlement-reconciliation pattern exactly but against
  `BillPaymentAttempt`/`TenantBillsProviderConfig`: a stale `'pending'`
  purchase gets polled via `checkPurchaseStatus` and resolved or reversed;
  one still `'processing'` past the auto-refund SLA gets refunded
  regardless. Verified live against a real Ledger with three real debit
  journal entries: a `completed` result resolved without touching the
  Ledger, a `failed` result reversed the debit, and a 90-minute-old
  `processing` attempt past a 60-minute SLA was auto-refunded — the
  customer's real balance was confirmed exactly right after all three
  (only the resolved one stayed debited). The original request-level
  failure path (bad credentials, rejected before any "processing" state
  is reached) was re-verified unchanged.

**Not verified — needs live Paystack credentials this environment doesn't
have:** `provisionAccount` actually creating a Paystack DVA, `verifyIdentity`
against real BVN/NIN data, and a *successful* payout or a genuine
`getTransferStatus` response (its "processing" branch was verified with a
monkey-patched provider response, not a live call). The code path for all
of these is the same one exercised (successfully) elsewhere — only the
"Paystack actually responds" half is unverified here.

**Scoped out of reconciliation, deliberately:** inbound (a deposit that
never arrives) has no comparable "ask the provider what happened" recovery
path — if money never reached Paystack there's nothing to poll for. This
pass covers outbound (withdrawal payouts) and bill purchases only.

**Explicit placeholders:**
- **No mTLS** — see the Ledger's README and `../../deploy/NETWORK_TOPOLOGY.md`;
  credential scoping is done, mTLS for a real hybrid deployment isn't.
- **`selfIssuedNuban.js`** — interface only. NUBAN generation and a NIBSS
  switching-partner integration aren't built; nothing needs them yet.
- **`vtpassBillsProvider.js`** — interface only, same role as
  `selfIssuedNuban.js`: proves the bills contract isn't secretly
  Kuda-shaped, nothing more.
- **A *successful* bill purchase isn't verified** — this environment has
  no live Kuda credentials. The request shape reaching Kuda's real API
  and getting a real (auth) rejection is verified; whether a correctly-
  authenticated purchase actually succeeds isn't, matching every other
  provider integration's documented limitation in this repo.

## Setup

```bash
createdb trustbank_payments
cp .env.example .env   # then edit it — PAYMENTS_ENCRYPTION_KEY: openssl rand -hex 32

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustbank_payments
npx prisma migrate deploy

npm install

# Bootstrap the first (admin) credential for a tenant — see
# ../../SERVICE_CREDENTIAL_MODEL.md. tenantId must already exist on the
# Ledger (POST /v1/tenants there first).
node scripts/bootstrapKey.js --tenant-id $TENANT_ID --scope admin --label ops-bootstrap

npm run dev   # :8081, requires the Ledger service already running
```

## API

```bash
# Register this tenant's rail, using the admin credential from bootstrap.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/config \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"tenantSlug":"trustpay","provider":"paystack","credentials":{"secretKey":"sk_live_...","webhookSecret":"whsec_..."}}'

# Issue an operate-scope credential for a real caller (e.g. trustpay-backend).
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/credentials \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"label":"trustpay-backend","scope":"operate"}'
# -> { id, label, scope, tokenPrefix, token } — token is shown once

# Everything below uses that operate token.
OPERATE_TOKEN=...

# Provision a customer's account (DVA for Paystack)
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/accounts \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"externalCustomerId":"user-123","firstName":"Ada","lastName":"Lovelace","phoneNumber":"+2348010000000"}'

# BVN/NIN check
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/identity/verify \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"type":"bvn","number":"12345678901","firstName":"Ada","lastName":"Lovelace"}'

# Payout — call only after the caller has already debited the customer
# on the Ledger; pass that journal entry's id so a provider failure can
# be reversed automatically.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/payouts \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"externalCustomerId":"user-123","amount":10000,"beneficiaryAccountNumber":"0123456789","beneficiaryBankCode":"058","reference":"WD-1","debitJournalEntryId":"<ledger-journal-entry-id>"}'

# Webhook (Paystack calls this — tenantSlug in the path since a webhook
# URL has no room for an authenticated lookup, and it's authenticated by
# the provider's own signature instead)
# POST /v1/webhooks/:tenantSlug/paystack

# On-demand reconciliation — the background runner does this automatically
# every RECONCILIATION_POLL_INTERVAL_MINUTES, this is for ops/testing.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/reconcile \
  -H "Authorization: Bearer $OPERATE_TOKEN" -d '{}'

# Bills — an entirely independent config from the payment rail above.
# A tenant can configure this, the rail above, both, or neither.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/bills-config \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"provider":"kuda","credentials":{"email":"ops@example.com","apiKey":"...","baseUrl":"https://kuda-openapi.kuda.com/v2"}}'

curl "localhost:8081/v1/tenants/$TENANT_ID/bills/billers?type=airtime" \
  -H "Authorization: Bearer $OPERATE_TOKEN"

curl -X POST localhost:8081/v1/tenants/$TENANT_ID/bills/verify \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"billerCode":"biller-1","customerId":"08010000000"}'

# Same debit-first-on-the-Ledger-then-call pattern as payouts —
# debitJournalEntryId lets a provider failure reverse automatically.
# Returns 'pending' on acceptance, not an immediate final result — see
# the "what's real" section on why purchaseBill doesn't assume completion.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/bills/purchase \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"externalCustomerId":"user-123","billerCode":"biller-1","customerId":"08010000000","amount":50000,"reference":"BILL-1","debitJournalEntryId":"<ledger-journal-entry-id>"}'

# On-demand bills reconciliation — the background runner does this
# automatically every BILLS_RECONCILIATION_POLL_INTERVAL_MINUTES.
curl -X POST localhost:8081/v1/tenants/$TENANT_ID/bills-reconcile \
  -H "Authorization: Bearer $OPERATE_TOKEN" -d '{}'
```

## Layout

```
prisma/               TenantProviderConfig, ProvisionedAccount, SettlementAttempt, ApiCredential,
                       TenantBillsProviderConfig, BillPaymentAttempt
scripts/bootstrapKey.js  issues the first admin credential for a fresh tenant
src/providers/         payment rails: provider.js (contract) + paystack.js + selfIssuedNuban.js (stub)
                       bills: billsProvider.js (contract) + kudaBillsProvider.js + vtpassBillsProvider.js (stub)
                       billsRegistry.js — bills-specific, separate from registry.js
src/crypto/            tenant credential encryption at rest — shared by both config services
src/services/          tenantConfigService, accountProvisioningService, settlementService,
                       reconciliationService, reconciliationRunner, ledgerClient, credentialService,
                       billsConfigService, billsService, billsReconciliationService,
                       billsReconciliationRunner
src/routes/            tenantConfig, accounts, identity, payouts, webhooks, reconciliation,
                       credentials, billsConfig, bills, billsReconciliation
```

## Testing

`tests/paystackProvider.test.js`, `tests/providerConformance.test.js`,
`tests/kudaBillsProvider.test.js`, and `tests/billsProviderConformance.test.js`
need no live credentials or database — pure unit tests against fixtures/
mocked axios calls. `tests/tenantSecrets.test.js` covers the encryption
round trip. `tests/reconciliation.test.js` covers `reconcileOutboundAttempt`'s
four branches (resolved / reversed / still-pending / provider-call-failed)
and `autoRefundStaleAttempt`, against a real Postgres with the provider's
network call faked via `jest.spyOn` — same "real DB, faked external
network" style as the rest of this repo's tests. `tests/credentialService.test.js`
and `tests/authMiddleware.test.js` cover credential issuing/verification/
revocation and, specifically, the tenant-spoofing regression (a
credential bound to tenant A being rejected when a request's `:tenantId`
claims tenant B). `tests/billsConfigService.test.js` covers bills config
set/get and, specifically, that a bills-only tenant (no payment-rail
config row) works. `tests/billsReconciliation.test.js` covers
`reconcileBillAttempt`'s four branches and `autoRefundStaleBillAttempt`,
plus `reconcileTenantBills`'s auto-refund-past-SLA behavior and the
bills-only-tenant case, against a real Postgres with
`KudaBillsProvider.prototype.checkPurchaseStatus` mocked. The inbound
settlement flow, reconciliation's age-threshold branching, and the bills
debit/reverse-on-failure flow (a genuine Kuda 401) were verified manually
end-to-end against a live Ledger during development (see the "what's
real" section above) — not yet captured as automated integration tests
in this repo.
