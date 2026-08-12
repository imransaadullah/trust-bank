# Compliance

Regulation as data, not hardcoded product rules — see
`COMPLIANCE_DESIGN_AND_BACKLOG.md` at the repo root for the design
principle. Owns four decisions now: KYC-tier transaction limits
(CBN's real three tiers — Tier 1: BVN/NIN, ₦30k/day; Tier 2: gov ID +
address, ₦500k/day; Tier 3: beneficial ownership, unlimited),
device-binding limits (mandatory since July 1, 2026 — a new device is
capped for a cooldown window, even for a fully-verified account),
transaction monitoring (velocity/structuring/large-single-txn rules),
and sanctions/watchlist screening.

**"Transaction monitoring," never "AI/ML transaction monitoring,"
deliberately.** CBN's roadmap language calls this AI/ML; what's built is
rule-based (velocity thresholds, structuring detection, name matching) —
see `screeningService.js`'s header comment. The `screenTransaction`/
`screenSanctions` contract is meant to stay stable if a scored/ML
implementation replaces the rule evaluation later; that hasn't happened
yet, and the docs won't claim it has.

**Monitoring flags, sanctions blocks — deliberately different.** A
brand-new, untuned rules engine auto-blocking real transactions would
create false-positive friction with no track record to justify it, so
`screenTransaction` always lets the transaction proceed and writes a
`ComplianceCase` for human review instead. `screenSanctions` blocks — a
watchlist match is a hard legal requirement, not a judgment call.

Stateless by design: it computes decisions from facts the caller passes
in (today's spend so far, whether this device is new). It doesn't track
per-user history — that's product-backend-owned state (`trustpay-backend`'s
`Device` table, its own `Transaction` aggregate for daily spend).

Policy is **immutable and versioned** — publishing a new policy never
updates an existing row, it inserts one with a higher `version` and its
own `effectiveFrom`. "Current policy" is the highest version already in
effect. Every decision response carries the `policyVersion` applied —
that's the audit trail, and it's what makes "update the rule without
redeploying product code" literally true.

## What's real vs. what's a placeholder

**Real, verified against a live Postgres and the full Ledger/Payments/
trustpay-backend chain:**
- Binds `127.0.0.1` by default (`BIND_HOST`), never `0.0.0.0` — this
  service is never meant to be internet-facing in any deployment model.
  See `../../deploy/NETWORK_TOPOLOGY.md`.
- Policy versioning: publishing v2 with a future `effectiveFrom` doesn't
  affect current decisions until that date arrives; looking up "as of" a
  future date correctly picks it up.
- KYC-tier limit math: single-transaction cap, daily cumulative cap
  (today's spend + this amount), Tier 3's `null` limit correctly allowing
  any amount.
- Device-binding math: a brand-new device is capped at the policy limit;
  a device past its cooldown window is not capped regardless of amount;
  a device inside its cooldown is capped even if not explicitly flagged
  `isNewDevice`.
- End-to-end through `trustpay-backend`'s real `/wallet/transfer` and
  `/wallet/withdraw` routes: a Tier-1 user's transfer within ₦30,000/day
  succeeds, the next one that would exceed it is rejected with a specific
  reason (not a generic 500), and a new device's transfer above ₦20,000
  is rejected by the device check specifically — distinguishable from a
  KYC-tier rejection, confirmed by testing both independently.
- Transaction monitoring: fired 4 real P2P transfers against a policy
  capped at 3/24h through `trustpay-backend` — all four succeeded (never
  blocks), and the 4th wrote a `ComplianceCase` with `matchedRules:
  [{rule: 'velocity_count', count: 4, limit: 3}]`, confirmed via
  `GET .../cases`. Structuring, distinct-counterparty, and
  large-single-txn rules verified the same way in
  `tests/screeningService.test.js`.
- Sanctions screening: a real transfer attempt from a user whose
  `displayName` matched a seeded watchlist entry was rejected with
  `COMPLIANCE_DENIED`, wrote a `severity: 'blocking'` case, and — checked
  directly against the Ledger — left the sender's balance untouched
  (the block happens before `ledgerClient.transferP2P` is even called).
- `reviewCase` updates `status`/`reviewedBy`/`reviewNotes`/`reviewedAt`
  correctly; a review against an unknown case id returns
  `CASE_NOT_FOUND`.
- Scoped, revocable, tenant-bound credentials (`src/services/credentialService.js`)
  replace the old single shared secret — see `../../SERVICE_CREDENTIAL_MODEL.md`.
  Verified live as part of the full 4-service rebuild: policy-publish
  routes require `admin`, decision/screening routes accept `operate`,
  and a tenant-A credential is rejected with 403 when a request's
  `:tenantId` claims tenant B.

**Two honest limitations, not glossed over:**
- **The sanctions watchlist is seed data (`prisma/seed.js`), not a live
  feed.** There's no OFAC/UN/EU ingestion here — that's real, separate
  work (fetch, parse, diff, re-import on a schedule). What's real is the
  schema, the matching algorithm (exact + small-edit-distance against
  name and aliases), and the API contract. `listSource: "SEED_TEST_DATA"`
  on every seeded row says so plainly, same as `selfIssuedNuban.js` in
  `services/payments` is documented as a stub rather than a real bank.
- **Sanctions screening runs against unverified names.** Today that's
  `User.displayName` (self-reported) and, for a withdrawal, the request
  body's `beneficiaryName` (also unverified) — `services/payments`'
  BVN/NIN `verifyIdentity` call returns a `matchedName` but nothing
  persists it anywhere in this codebase, so there's no verified legal
  name to screen against yet. Worth fixing before this matters for real,
  not assumed away.

**Explicit placeholder:** no mTLS — see the Ledger's README and
`../../deploy/NETWORK_TOPOLOGY.md`. The `cases` review routes require an
`operate` credential like every other decision route — there's no
separate admin/back-office auth model anywhere in the platform yet, a
known gap, not a new one introduced here.

## Setup

```bash
createdb trustbank_compliance
cp .env.example .env

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustbank_compliance
npx prisma migrate deploy

npm install
npm test          # policy versioning + decision math + screening, needs DATABASE_URL
npm run prisma:seed   # loads synthetic sanctions-watchlist test entries — see prisma/seed.js

# Bootstrap the first (admin) credential for a tenant — see
# ../../SERVICE_CREDENTIAL_MODEL.md. tenantId must already exist on the Ledger.
node scripts/bootstrapKey.js --tenant-id $TENANT_ID --scope admin --label ops-bootstrap

npm run dev       # :8083
```

## API

```bash
# Publish a KYC-tier policy (a new version, never overwrites) — requires admin.
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/kyc-policy \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"tier":1,"requiredVerifications":["bvn_or_nin"],"dailyLimitKobo":3000000,"singleTxnLimitKobo":3000000}'

# Publish a device-binding policy — admin.
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/device-policy \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"newDeviceCooldownHours":24,"newDeviceLimitKobo":2000000}'

# Publish a transaction-monitoring policy — admin.
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/monitoring-policy \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"velocityWindowHours":24,"velocityMaxTransactionCount":10,"velocityMaxDistinctCounterparties":10,"structuringThresholdKobo":50000000,"structuringWindowCount":3,"largeSingleTxnThresholdKobo":500000000}'

# Issue an operate-scope credential for a real caller (e.g. trustpay-backend).
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/credentials \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"label":"trustpay-backend","scope":"operate"}'
# -> { id, label, scope, tokenPrefix, token } — token is shown once

# Everything below uses that operate token.
OPERATE_TOKEN=...

# Ask: is this transaction allowed under the caller's current KYC tier?
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/kyc-tier-check \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"userId":"user-123","tier":1,"amount":1000000,"amountTransactedTodayKobo":2500000}'
# -> { allowed, reason?, dailyLimitKobo, singleTxnLimitKobo, policyVersion }

# Ask: does this device need a cap right now?
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/device-check \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"userId":"user-123","isNewDevice":true,"amount":2500000}'
# -> { allowed, capAppliedKobo?, cooldownHours?, reason?, policyVersion }

# Screen a transaction — never blocks, flags into a ComplianceCase.
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/screen-transaction \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"userId":"user-123","amount":500000,"counterpartyId":"user-456","recentTransactions":[{"amount":500000,"counterpartyId":"user-456","createdAt":"2026-08-11T10:00:00Z"}]}'
# -> { flagged, riskLevel, matchedRules, policyVersion }

# Screen a name against the watchlist — a hit is meant to block the caller's transaction.
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/screen-sanctions \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"userId":"user-123","fullName":"Ada Lovelace"}'
# -> { hit, matchedEntries }

# Review queue.
curl localhost:8083/v1/tenants/$TENANT_ID/compliance/cases?status=open \
  -H "Authorization: Bearer $OPERATE_TOKEN"
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/cases/$CASE_ID/review \
  -H "Authorization: Bearer $OPERATE_TOKEN" \
  -d '{"status":"dismissed","reviewedBy":"ops@trustpay.example","reviewNotes":"False positive."}'
```

Amounts are kobo, matching the rest of the platform.

## Layout

```
prisma/               KYCTierPolicy, DeviceBindingPolicy, TransactionMonitoringPolicy —
                       immutable, versioned rows. SanctionsWatchlistEntry (not
                       tenant-scoped), ComplianceCase — the service's first persisted
                       state beyond policy, an audit trail, not per-user decision input.
prisma/seed.js         synthetic sanctions-watchlist test entries — not a live feed
scripts/bootstrapKey.js  issues the first admin credential for a fresh tenant
src/services/
  policyService.js             KYC-tier + device-binding: publish + "current effective" lookup
  monitoringPolicyService.js    same pattern, for TransactionMonitoringPolicy
  decisionService.js            pure policy math over caller-supplied facts (KYC-tier, device)
  screeningService.js           screenTransaction (flags), screenSanctions (blocks),
                                 listCases/reviewCase — rule-based, ML-ready contract
  credentialService.js          scoped/revocable API credentials — see ../../SERVICE_CREDENTIAL_MODEL.md
src/routes/
  policies.js            admin: publish a KYC-tier or device policy version
  decisions.js            operate: the two KYC-tier/device decision endpoints
  monitoring.js           admin: monitoring-policy publish. operate: screen-transaction,
                           screen-sanctions, cases list/review
  credentials.js          admin: issue/list/revoke this tenant's own credentials
```
