# Compliance

Regulation as data, not hardcoded product rules — see
`COMPLIANCE_DESIGN_AND_BACKLOG.md` at the repo root for the design
principle. Owns two decisions right now: KYC-tier transaction limits
(CBN's real three tiers — Tier 1: BVN/NIN, ₦30k/day; Tier 2: gov ID +
address, ₦500k/day; Tier 3: beneficial ownership, unlimited) and
device-binding limits (mandatory since July 1, 2026 — a new device is
capped for a cooldown window, even for a fully-verified account).

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

**Not built this pass** (tracked in `COMPLIANCE_DESIGN_AND_BACKLOG.md`
Segment A, deliberately deferred rows): AML/velocity transaction
screening, sanctions/watchlist screening. The policy engine's shape
(versioned, tenant/jurisdiction-scoped, single decision API) is meant to
extend to both without a redesign — see the design doc.

**Explicit placeholder:** shared-secret auth, same caveat as the Ledger's
and Payments'.

## Setup

```bash
createdb trustbank_compliance
cp .env.example .env

export DATABASE_URL=postgresql://postgres:password@localhost:5432/trustbank_compliance
npx prisma migrate deploy

npm install
npm test   # policy versioning + decision math, needs DATABASE_URL
npm run dev   # :8083
```

## API

```bash
# Publish a KYC-tier policy (a new version, never overwrites).
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/kyc-policy \
  -H "Authorization: Bearer $COMPLIANCE_SHARED_SECRET" \
  -d '{"tier":1,"requiredVerifications":["bvn_or_nin"],"dailyLimitKobo":3000000,"singleTxnLimitKobo":3000000}'

# Publish a device-binding policy.
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/device-policy \
  -H "Authorization: Bearer $COMPLIANCE_SHARED_SECRET" \
  -d '{"newDeviceCooldownHours":24,"newDeviceLimitKobo":2000000}'

# Ask: is this transaction allowed under the caller's current KYC tier?
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/kyc-tier-check \
  -H "Authorization: Bearer $COMPLIANCE_SHARED_SECRET" \
  -d '{"userId":"user-123","tier":1,"amount":1000000,"amountTransactedTodayKobo":2500000}'
# -> { allowed, reason?, dailyLimitKobo, singleTxnLimitKobo, policyVersion }

# Ask: does this device need a cap right now?
curl -X POST localhost:8083/v1/tenants/$TENANT_ID/compliance/device-check \
  -H "Authorization: Bearer $COMPLIANCE_SHARED_SECRET" \
  -d '{"userId":"user-123","isNewDevice":true,"amount":2500000}'
# -> { allowed, capAppliedKobo?, cooldownHours?, reason?, policyVersion }
```

Amounts are kobo, matching the rest of the platform.

## Layout

```
prisma/               KYCTierPolicy, DeviceBindingPolicy — immutable, versioned rows
src/services/
  policyService.js      publish + "current effective" lookup
  decisionService.js     pure policy math over caller-supplied facts
src/routes/
  policies.js            admin: publish a new policy version
  decisions.js            the two decision endpoints
```
