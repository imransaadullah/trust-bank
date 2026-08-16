# Compliance as an interface, and a segmented backlog for everything in `TRUSTPAY_MARKET_STRATEGY.md`

**Status:** design principle + backlog segmentation, no code yet
**Reads with:** `TRUSTPAY_MARKET_STRATEGY.md` (the gaps/edges this segments) and `CORE_BANKING_PLATFORM_ARCHITECTURE.md` (the phase language this corrects)

---

## 1. The principle: regulation is data, not code

Three CBN rules changed on us during a single build pass — tiered-KYC limits, device binding (went from nonexistent to mandatory on July 1, 2026), and AI/AML monitoring (roadmap due June 2026). Every one of them, as we currently have TrustPay scoped, would have been a hardcoded constant: `if (user.kycTier < 1) throw ...` in `wallet.js`, a tier scheme invented ad-hoc instead of matching CBN's actual three tiers. That's the exact failure mode to design out now, not patch later — a rule change should mean **updating data**, not **redeploying code across three services**.

This is the same shape of problem we already solved once: `services/payments`' provider interface exists so a rail change (Paystack → self-issued NUBAN) doesn't touch any caller. Compliance rules need the identical treatment — a contract, pluggable/versioned implementations behind it, and every caller talks to the contract, never to a hardcoded rule.

### The interface

A **`Compliance Policy`** is a versioned, tenant-and-jurisdiction-scoped data record — not a constant:

```
KYCTierPolicy    { tierId, requiredVerifications[], dailyLimit, singleTxnLimit, jurisdiction, effectiveFrom, version }
DeviceBindingPolicy { maxActiveDevices, newDeviceCooldownHours, newDeviceLimitAmount, jurisdiction, version }
VelocityPolicy   { ruleSet[], reviewSLA, jurisdiction, version }
```

And a **single decision API** every product backend calls instead of hardcoding a rule — same shape as the Payments provider contract:

```
evaluateKYCAction({ tenantId, userId, currentTier, proposedAction, amount })
  -> { allowed, reason?, limitApplied, policyVersion }

evaluateDeviceContext({ tenantId, userId, deviceId, isNewDevice })
  -> { allowed, transferCapForWindow, cooldownEndsAt, policyVersion }

screenTransaction({ tenantId, userId, amount, counterparty, recentActivity })
  -> { decision: 'allow'|'review'|'block', reasons[], policyVersion }
```

**Why `policyVersion` is in every response, not an afterthought:** it's the audit trail a regulator or an internal dispute review actually needs — "which rule was in effect when this was allowed" — and it's what makes "update the rule without touching product code" true in practice: a new policy version ships with an `effectiveFrom` date, old transactions still show which version applied, `services/ledger`, `services/payments`, and every product backend stay untouched.

**Why tenant *and* jurisdiction scoped, not just tenant:** a hardcoded Nigeria-only ruleset breaks the moment a second country or a tenant on a different regulatory timeline exists — exactly the mistake the current Tier 0/1 scheme already made once.

### Where this lives

Same reasoning we already walked through for Payments: **a standalone `services/compliance`, not a shared library.** A library only pays off if every tenant runs your source in their own infrastructure — wrong model for "trust-bank operates the infrastructure." A standalone service means a policy update ships once and every tenant's product backend picks it up immediately, and it's the one place policy data (and its audit trail) actually lives, rather than scattered across however many product backends exist later.

`services/compliance` calls no one — it's a pure decision service, data in, decision out. `services/payments` and any product backend (TrustPay's, or a future bank's own) call it before a regulated action, the same way they'd call `services/payments` before touching a provider.

### A related but distinct concept: feature enablement

TrustChat already has the right prior art for this, worth reusing directly rather than reinventing: per-user granular opt-ins (`optInAt`/`optOutAt`, boolean `is*Enabled` flags — see `CLAUDE.md`'s "Granular opt-in system per feature"). Compliance policy answers *"is this action allowed for this user, right now, under current regulation."* Feature enablement answers a different question — *"has this tenant/user turned this feature on"* (is savings even built for this tenant, is card issuing live for this tenant's rail) — a business/product toggle, not a regulatory one. They compose: a route should check both, but they're separate systems with separate owners (compliance = regulatory, mandatory; feature flags = product, our call). Worth designing the feature-enablement layer with the same tenant-scoped, data-driven shape once we're building product features that need it (§3 below) — not urgent today, flagged so it doesn't get bolted on as an afterthought either.

---

## 2. Segmented backlog

Every gap/edge from `TRUSTPAY_MARKET_STRATEGY.md`, given a home. "Home" means which service(s) it touches and which phase of the original rollout (`CORE_BANKING_PLATFORM_ARCHITECTURE.md` §13) it belongs to — including corrections where the market research changed the original phase assignment.

### Segment A — Compliance & Risk (cross-cutting, new `services/compliance`)

| Item | Touches | Phase | Note |
|---|---|---|---|
| Correct 3-tier KYC (₦30k/₦500k/unlimited) | `services/compliance` (new), `trustpay-backend` (consumes) | **Corrected to Phase 1** | Originally implicit in Phase 1's "wallet" scope but under-specified; the ad-hoc Tier 0/1 scheme was the actual bug. |
| Device binding + new-device transfer cap | `services/compliance` (new), `trustpay-backend` (device registry, JWT device claim) | **Corrected to Phase 1** | Live regulation since July 1, 2026 — was not in the original phase plan at all. |
| Transaction monitoring / AML | `services/compliance` | **Done** | Rules-based (velocity, distinct-counterparty, structuring, large-single-txn) via `screenTransaction` — never blocks, writes a `ComplianceCase` for review. Named "transaction monitoring," not "AI/ML," since that's what's actually built; the contract is meant to stay stable if a scored/ML implementation replaces the rule evaluation later. |
| Sanctions/watchlist screening | `services/compliance`, `trustpay-backend` | **Done, including a real feed** | `screenSanctions` blocks on a match (unlike monitoring). Watchlist now ingests real OFAC SDN + UN Consolidated List data daily (`sanctionsFeedService.js`), plus Nigeria's own Sanctions Committee list (HTML-scraped, honestly flagged as more fragile than the two purpose-built exports). Screens `User.verifiedFullName` (from BVN/NIN's `matchedName` at Tier-1) when set, `displayName` otherwise — the last open item from Segment A, closed. |

### Segment B — Reliability & Reconciliation (`services/payments`)

| Item | Touches | Phase | Note |
|---|---|---|---|
| Settlement reconciliation job | `services/payments` | **New — sits alongside Phase 1/2**, not previously scoped as its own item | Generalizes the old `core-banking/reconciliationService.js` pattern. Compares `SettlementAttempt` rows against provider settlement data on a schedule. |
| NIBSS-outage auto-refund SLA | `services/payments` (built on the reconciliation job above) | Same as above | The market-facing differentiator from the strategy doc's §4 — same build as reconciliation, framed as a product SLA. |

### Segment C — Consumer Parity: Money Movement (`services/payments` + `trustpay-backend`)

| Item | Touches | Phase | Note |
|---|---|---|---|
| Bills/airtime/data/electricity/cable | `services/payments` (new `billsProvider`/`billsRegistry`/`billsConfigService`/`billsService`/`billsReconciliationService`), new `/bills/*` routes in `trustpay-backend` | **Done, including reconciliation** | Was blocked on "un-defer Kuda or pick another aggregator" — resolved by rejecting that premise: a pluggable bills-provider abstraction, independent of the payment-rail choice, so no biller is hardcoded. Kuda implemented (ported from old `core-banking/routes/bills.js` + `providers/kudaProvider.js`, a real prior integration), VTpass stubbed to prove the contract generalizes. Building reconciliation surfaced a real correctness gap in the first pass: Kuda's purchase response was treated as final when its own docs say confirmation can follow later via a dedicated status-query call — fixed (purchases are now `'processing'` until confirmed) alongside adding the reconciliation job that resolves them. Verified live against a real Ledger: resolved/reversed/auto-refunded-past-SLA all confirmed with exact balance restoration. |

### Segment D — Consumer Parity: Savings & Credit (`services/ledger` + `trustpay-backend`)

| Item | Touches | Phase | Note |
|---|---|---|---|
| Interest-bearing savings (locked/fixed pockets) | `services/ledger` (new product type, interest accrual job), `trustpay-backend` (routes) | **Corrected — this is Phase 1 deposit-product depth**, not new scope; the original architecture doc named "term deposit" as a Phase 1 deposit product and the current build only shipped a plain wallet | Needs an accrual batch job in the Ledger (end-of-day interest posting, same idempotent-batch pattern already described in the architecture doc §9). |
| Instant micro-loans / salary-linked overdraft | `services/ledger` (loan product), new domain | Phase 3 (Loans & Credit), unchanged | Matches the original phasing exactly — correctly sequenced after deposits are solid. |

### Segment E — Consumer Parity: Cards

| Item | Touches | Phase | Note |
|---|---|---|---|
| Physical + virtual debit cards | New domain entirely | Phase 4 (Cards issuing/switching), unchanged | Matches original phasing — PCI scope isolation still applies exactly as originally designed. |

### Segment F — Reach: Alternative Channels

| Item | Touches | Phase | Note |
|---|---|---|---|
| USSD gateway + menu-driven flows | New channel layer in front of `trustpay-backend`'s existing `wallet`/`auth` APIs | **New segment, not in the original phase plan** | Not a rails or ledger concern — a new interface calling the same backend routes. Sequence after Segment C/D give the product something worth reaching a wider audience with. |

### Segment G — Platform/BaaS Positioning (GTM, not engineering)

| Item | Touches | Phase | Note |
|---|---|---|---|
| "Live consumer product proves the rails" narrative vs. API-only competitors (Anchor, Blusalt) | None — marketing/sales | N/A | Tracked here so it isn't lost, but it's not a backlog item anyone implements — it's a claim that becomes true once Segments A–D are live and TrustPay has real volume. |

### Segment I — Merchant Checkout (new domain, identified August 2026 — not started, deliberately deprioritized)

**Why this isn't being worked on:** the BaaS-reseller line of business itself is still pending
— TrustPay is trust-bank's only real tenant today, and TrustPay is a consumer product, not a
bank/MFB reseller customer. Merchant Checkout's entire value case is "something a tenant hands
*their* merchants" — there's no real tenant in that shape to build it for yet. Revisit once an
actual BaaS-reseller tenant (a bank/MFB buying trust-bank as infrastructure) exists, not before
— building this speculatively ahead of that customer would be the same mistake as building a
live sanctions feed or a full credit-scoring model before there's a reason to carry the
maintenance cost.

| Item | Touches | Phase | Note |
|---|---|---|---|
| Hosted checkout (Squad/Paystack-Checkout-style) for a tenant's own merchants | New "Merchant Checkout" bounded context (`CORE_BANKING_PLATFORM_ARCHITECTURE.md` §3) | **Not started, not scoped into any phase yet** | Real gap: never named in the original 16 bounded contexts, surfaced only while auditing what's missing before a real deploy. **Current status, plainly:** nothing built, no code exists. A narrower version — a 3-leg Ledger journal entry (customer → merchant → platform fee), reusing `PostJournalEntry` exactly like P2P/savings do, no new service — was scoped and ready to build, but implementation was deliberately paused in favor of the fuller product: hosted payment pages/links, merchant onboarding within a tenant, merchant-facing webhooks. That fuller shape is closer to `services/payments` than `services/ledger` — it owns product-shaped concerns (sessions, webhooks, merchant records) the way Payments owns provider integration, and would most likely call the Ledger's (still-unbuilt) checkout primitive over HTTP rather than post journal entries itself. **Whether it's a new standalone service or folded into an existing one is an open decision for whenever this segment starts**, not decided now. |
| Market positioning this unlocks | Segment G (BaaS positioning) | Tied to Segment G | Anchor/Blusalt are API-only — a bank integrates their API and builds its own payment UI on top. A hosted checkout page a tenant can hand its merchants directly (no UI to build) is a concrete product edge over that, not just "the same API but nicer" — worth stating explicitly once this ships, not before. |

### Segment H — Deliberately deferred (tracked so it isn't re-litigated)

| Item | Revisit after |
|---|---|
| Cashback/rewards program | Revenue exists to fund it — matching PalmPay's burn is wrong for a new entrant on a tight timeline. |
| Agent/POS cash-in-cash-out network | The April 2026 single-principal rule's dust settles; entering now means recruiting agents mid-forced-reshuffle against incumbents with millions of existing relationships. |
| Cross-border / dollar cards | Domestic parity (Segments C/D) ships — distinct regulatory and banking-partner problem, real demand, wrong sequencing to lead with. |

---

## 3. What this changes about the existing phase plan

Two corrections to `CORE_BANKING_PLATFORM_ARCHITECTURE.md`'s phasing, both because the market research surfaced deadlines/scope the original plan didn't have:

1. **Compliance moves from "Phase 5, later" to "Phase 1, now"** for the KYC-tier-correctness and device-binding pieces specifically — they're not regulatory automation nice-to-haves anymore, they're live law. AML/AI monitoring stays roughly where Phase 5 put it, but with a real June 2026 roadmap deadline attached instead of an open-ended "eventually."
2. **Reconciliation earns its own line item** instead of being an implicit part of "Phase 1, hardened" — it's both a compliance-adjacent requirement and the concrete edge from the market strategy doc's §4, worth building deliberately rather than assuming it falls out of other work.

Everything else (bills, savings/credit, cards, USSD) confirms rather than changes the original sequencing — the market research validated the phase order, it just filled in *why* each phase matters competitively, not just architecturally.

Say which segment to turn into an actual implementation plan next.
