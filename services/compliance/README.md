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

**The sanctions watchlist is real now, from three independently-verified
sources — `src/services/sanctionsFeedService.js`:**
- **OFAC's SDN list** (`sanctionslistservice.ofac.treas.gov`, free, no
  auth) — 19,199 entries plus aliases, refreshed daily
  (`sanctionsFeedRunner.js`, `SANCTIONS_FEED_POLL_INTERVAL_HOURS`,
  default 24h).
- **The UN Security Council Consolidated List**
  (`scsanctions.un.org`, free, no auth) — 1,011 entries, including
  aliases and date of birth where the source has it.
- **Nigeria's own Sanctions Committee list** (`nigsac.gov.ng`) — 69
  entries (individuals + entities). No API or export exists for this
  one, only an HTML table — scraped with `cheerio`, and honestly more
  fragile than the two above: a government webpage can change markup
  with no warning, unlike a purpose-built CSV/XML export. Treat it
  accordingly, not as equally durable.

Each source replaces its own rows wholesale on every run (`listSource`
distinguishes `OFAC_SDN`/`UN_CONSOLIDATED`/`NG_SANCTIONS_COMMITTEE`) —
correctly drops delisted entries instead of letting them accumulate
forever. One source failing doesn't block the others. `scripts/
refreshSanctionsFeed.js` triggers a manual run — deliberately a
locally-run script, not an HTTP route: the watchlist has no `tenantId`
(sanctions apply platform-wide), so there's no tenant admin credential
that should gate a platform-wide refresh.

Verified live against the real sources during this feature's own
build — not a fixture: real entries landed with correct names/aliases/
dates, a second run replaced cleanly with no duplicates, and
`screenSanctions`'s existing fuzzy matcher correctly caught a real
1-character alias variant already present in OFAC's own data (an
unrelated-looking name match turned out to be a real documented alias,
not a bug — checked before assuming otherwise).

**Sanctions screening now runs against a verified name when one
exists.** `services/trustpay-backend`'s `User.verifiedFullName` is
populated from `services/payments`' BVN/NIN `verifyIdentity` call's
`matchedName` at Tier-1 verification — `complianceEnforcement.js`
prefers it over the self-reported `displayName`, falling back only for
a Tier-0 user who hasn't verified yet. Verified live: a user whose
verified name matched a real ingested sanctions entry was blocked even
though their (harmless) display name wasn't; a user with no verified
name correctly fell back to screening the self-reported one instead of
being exempted.

**A real bug this surfaced, fixed before it shipped:** `setInterval`
silently overflows past ~24.8 days (2^31-1 ms, a 32-bit signed int
internally) and fires almost immediately instead of waiting — not an
error, just wrong behavior. An intentionally-extreme test value for
`SANCTIONS_FEED_POLL_INTERVAL_HOURS` turned the runner into a tight
loop hammering OFAC/UN/Nigeria's real servers before this was caught
and stopped. `src/config/index.js` now clamps any hours-based polling
interval to a safe maximum (500h) — the same class of bug would have
hit a perfectly reasonable "check monthly" setting (~730h) in
production, not just an extreme test value.

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
prisma/seed.js         synthetic sanctions-watchlist test entries — a dev-time fallback;
                       sanctionsFeedService.js's real ingestion is what actually populates
                       this table outside local development
scripts/bootstrapKey.js  issues the first admin credential for a fresh tenant
scripts/refreshSanctionsFeed.js  manual on-demand sanctions-feed refresh — not an HTTP
                                  route, see sanctionsFeedService.js's own comment on why
src/services/
  policyService.js             KYC-tier + device-binding: publish + "current effective" lookup
  monitoringPolicyService.js    same pattern, for TransactionMonitoringPolicy
  decisionService.js            pure policy math over caller-supplied facts (KYC-tier, device)
  screeningService.js           screenTransaction (flags), screenSanctions (blocks),
                                 listCases/reviewCase — rule-based, ML-ready contract
  sanctionsFeedService.js       real OFAC/UN/Nigeria ingestion — see "sanctions watchlist" above
  sanctionsFeedRunner.js         daily background refresh, same shape as Payments' own runners
  credentialService.js          scoped/revocable API credentials — see ../../SERVICE_CREDENTIAL_MODEL.md
src/routes/
  policies.js            admin: publish a KYC-tier or device policy version
  decisions.js            operate: the two KYC-tier/device decision endpoints
  monitoring.js           admin: monitoring-policy publish. operate: screen-transaction,
                           screen-sanctions, cases list/review
  credentials.js          admin: issue/list/revoke this tenant's own credentials
```
