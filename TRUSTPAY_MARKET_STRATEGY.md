# Market gap analysis: parity and edge for TrustPay / trust-bank

**Status:** strategy doc, grounded in August 2026 market research — not aspirational guesswork
**Scope:** what OPay/PalmPay/Moniepoint/Kuda/Anchor already have that we don't (parity), what the market is visibly failing at right now that we can exploit (edge), and what CBN has made *mandatory* since our last build pass (compliance, not optional)

---

## 1. The headline finding

Three things changed the calculus since we last scoped TrustPay:

1. **CBN's tiered-KYC, device-binding, and AI/AML rules are not what we built against.** Our current scheme (Tier 0 = phone-only, Tier 1 = BVN/NIN) doesn't match CBN's actual three tiers, and we have zero device-binding — which went from optional to *mandatory, live since July 1, 2026*. This is the section to read first: it's not "would be nice," it's "non-compliant right now."
2. **The market's own infrastructure is visibly breaking in ways our architecture already defends against.** NIBSS had two double-digit-hour outages in 2026 alone (April 16: 9h26m; May 26, Eid eve: 10h, debiting senders without crediting recipients). Synapse's collapse a year prior was a reconciliation/ledger-integrity failure, not a product failure. Both are exactly the failure modes our double-entry, RLS-isolated, append-only ledger and reconciliation discipline exist to prevent — that's a real, current, ownable pitch, not generic "we're secure" marketing.
3. **Every consumer competitor (OPay, PalmPay, Moniepoint, Kuda) already has savings yield, instant credit, bills, and cards.** We have none of the four. This is where "parity" actually means parity — none of it is differentiating anymore, it's the price of entry.

---

## 2. Regulatory gaps — fix these regardless of competitive strategy

These aren't features to prioritize against market appeal; they're compliance deadlines already in force or imminent.

| Requirement | What CBN mandates | What we have | Gap |
|---|---|---|---|
| **Tiered KYC** | Tier 1: BVN/NIN, ₦30k/day. Tier 2: verified gov ID + address, ₦500k/day. Tier 3: full beneficial-ownership verification, no limit. | Our own ad-hoc "Tier 0" (phone-only) / "Tier 1" (BVN/NIN) scheme | Doesn't map to CBN's tiers at all — a real bank/MFB customer running on trust-bank would fail an audit against this today. Rename/restructure to CBN's actual 3 tiers, with Tier 1 allowing *some* transacting (₦30k/day) rather than our current "Tier 0 can't deposit or withdraw at all." |
| **Device binding** (live since **July 1, 2026**) | One device at a time per user; switching devices triggers re-auth, a 24h cooldown, and a ₦20,000 cap during that window — applies even to Tier 3 accounts. | Nothing — `trustpay-backend`'s JWT has no device claim, no device registry, no reduced-limit window | This is the single biggest compliance hole. Needs a `Device` table, device fingerprint/registration at login, and limit enforcement keyed off "is this a new device in the last 24h," not just KYC tier. |
| **AI/ML in AML** (roadmap due **June 10, 2026**; DMBs get 18 months, others 24 months to comply) | Real-time transaction monitoring, customer risk profiling, sanctions screening, independently-audited annual AI review | None of our three services do any transaction monitoring — Payments records settlement, the Ledger records entries, nobody scores anything | This is exactly the "Fraud & Risk" domain flagged as out-of-scope in the original architecture doc's phasing. The deadline math says it can't stay deferred indefinitely — worth scoping as its own phase now that there's a hard date attached. |
| **Agent exclusivity** (live **April 1, 2026**) | An agent can only represent one principal institution | N/A — no agent network yet | Not urgent (we have no agents), but shapes any future cash-in/cash-out strategy: agents will have to choose us exclusively, which is a harder sell than the old multi-bank-agent model competitors built their networks under. |

**Sources:** [CBN KYC/AML 2026 requirements](https://youverify.co/en/blogs/cbn-kyc-aml-requirements-2026) · [Device binding rule](https://technext24.com/2026/03/18/cbn-device-binding-rule-nigeria-fintech/) · [₦20,000 new-device limit](https://bankibusiness.com/cbn-sets-n20000-limit-new-mobile-banking-device/) · [CBN AI/AML mandate](https://techcabal.com/2026/03/12/cbn-wants-ai-to-fight-money-laundering/) · [Agent exclusivity rule](https://techpoint.africa/news/cbn-agent-banking-guidelines/)

---

## 3. Consumer feature parity — what OPay/PalmPay/Moniepoint/Kuda have that we don't

| Feature | OPay | PalmPay | Moniepoint | Kuda | **Us** |
|---|---|---|---|---|---|
| Interest-bearing savings (OWealth/Fixed Pocket-style) | Yes (OWealth, daily returns) | — | Business savings plans | Yes, up to **16%** APY on Fixed Pocket | **No** |
| Instant micro-loans / overdraft | Yes (3rd-party) | — | Working capital loans | Yes, up to ₦150k instant, salary-linked overdraft | **No** |
| Bills, airtime, data, electricity, cable | Yes | Yes, with cashback | Yes | — | **No** (deliberately deferred — see §5) |
| Physical + virtual debit cards | Yes | Yes | Yes (expense cards) | Yes | **No** |
| Cashback/rewards | Some | **Core differentiator** — up to 5% | — | — | **No** |
| Agent/POS cash-in-cash-out network | **2M+ points** | 500k+ agents | **Category leader**, 99.9% transfer success claimed | — | **No** |
| Business banking tools (expense cards, accounting) | — | — | Moniebook accounting, POS terminals in 48h | — | **No** |
| USSD channel | Yes | Yes | Yes | — | **No** |

**Read this table as a priority queue, not a checklist.** Savings yield and bills payment are the two with the best cost-to-build vs. market-expectation ratio — a customer who opens a wallet and finds no way to earn on idle balance or pay a DSTV bill will bounce to an incumbent within the first session. Cards and agent networks are capital- and partnership-intensive; sequence them later.

**Sources:** [OPay 2026 review](https://westafricatradehub.org/reviews/opay/) · [PalmPay cashback](https://westafricatradehub.com/reviews/palmpay/) · [Moniepoint business banking](https://moniepoint.com/ng/business) · [Kuda overdraft](https://kuda.com/en-ng/overdrafts/) · [Kuda savings](https://www.kuda.com/savings/)

---

## 4. The market's own reliability crisis — an ownable edge, not a hypothetical one

- **NIBSS outages, 2026:** April 16 (9h26m, all outward transfers/direct debits/Pay-with-Transfer/virtual accounts down), May 13, May 20, and May 26 — the last one on the eve of Eid al-Adha, with senders **debited and recipients never credited**, and no official restoration timeline at time of reporting.
- **Root cause pattern:** rushed upgrades, third-party integration issues, peak-load congestion on a switch processing ~11 billion transactions/year and growing.
- **Synapse's 2024 collapse:** $85M shortfall from reconciling customer funds across multiple partner banks without proper recordkeeping — an operational/ledger-integrity failure, not a technology failure. The FDIC's resulting "Synapse rule" (Oct 2024) now requires custodial recordkeeping precisely because middleware providers didn't have it.

**Why this is our edge, concretely, not just "we're careful":**
- Our Ledger's `SERIALIZABLE` double-entry + append-only + RLS design is architecturally the opposite of what failed at Synapse — this is genuinely defensible as a pitch to a prospective bank/MFB customer evaluating BaaS vendors post-Synapse.
- Our reconciliation discipline (proven in the old `core-banking/` service, not yet rebuilt in the new `Payments` service — see gap below) is exactly the tool that turns a NIBSS "debited but not credited" incident from a support nightmare into an auto-detected, auto-resolved non-event. **Nobody in the Nigerian market is visibly winning on this right now** — the search results show users stuck waiting with no timeline, across multiple platforms, multiple times in 2026 alone.
- Concretely buildable: a reconciliation job in `services/payments` that compares `SettlementAttempt` rows against provider settlement reports/webhooks on a schedule, flags anything stuck past an SLA, and either auto-resolves (credit arrived late) or auto-refunds (confirmed failure) — turning "NIBSS is down, wait" into "your transfer will be refunded automatically within 30 minutes if it doesn't complete," a concrete, marketable SLA competitors aren't making right now.

**Sources:** [NIBSS April 2026 outage](https://businesspost.ng/banking/nibss-suffers-downtime-affects-interbank-transfers/) · [Eid eve outage, debited-not-credited](https://fij.ng/article/nibss-downtime-ruins-nigerians-money-transfer-experience-ahead-of-eid-al-adha/) · [Synapse collapse lessons](https://www.bankingdive.com/news/5-lessons-learned-from-synapses-collapse/731543/) · [Synapse $85M shortfall](https://fintechlab.nus.edu.sg/is-your-money-safe-synapses-collapse-and-the-future-of-digital-banking/)

---

## 5. BaaS competitive landscape — where trust-bank-as-a-platform actually sits

- **Anchor** (YC S22) is the clearest direct competitor for the "sell trust-bank to other institutions" ambition: API-first accounts, fund transfers, savings, card issuance, loans, bulk disbursement, cross-border, developer webhooks/audit logs. Processed $2.5B+, 3 years in, licensed. This is a mature, funded, API-only BaaS player.
- **Blusalt** is a second Lagos-based embedded-finance API platform (payments/fintech/e-commerce/insurance verticals).
- Global BaaS market: **~$29B in 2026, projected $65B by 2031**, 250+ providers across 17 categories.

**Where we're structurally different from Anchor/Blusalt, and why that's an advantage worth stating explicitly:** they are API-only — a bank integrates their API and builds their own consumer product on top. **We are building both** — TrustPay is a real, live consumer product running on our own rails. That's a materially stronger pitch to a prospective MFB/bank customer than "trust our API," because we can point at TrustPay's own production volume, incident history, and reconciliation record as proof the platform works under real load — something an API-only vendor can't demonstrate as concretely. This should be an explicit part of the sales narrative once TrustPay has real usage: *"the same ledger and rails powering our own consumer app, not a vendor's untested API."*

**Sources:** [Anchor at 3 years](https://techcabal.com/2025/09/01/anchor-at-3-building-africas-fintech-infrastructure-powering-builders-touching-lives/) · [Anchor overview](https://www.ycombinator.com/companies/anchor) · [Blusalt](https://www.crunchbase.com/organization/blusalt-financial-service) · [Embedded finance market size](https://sdk.finance/blog/embedded-finance-companies/)

---

## 6. USSD — the reach gap, not just a feature gap

220M+ Nigerian mobile lines, a large share on feature phones or in low-data areas, **₦6 trillion/year in USSD-initiated banking value**, and it's the channel that survives when apps and even NIBSS itself are down (competitors use USSD for exactly this resilience property — Carbon/FairMoney disburse and recover loans via USSD in 30-second sessions). Every consumer competitor in our table above has it. We have zero provision for it across all three services.

This isn't just a checkbox feature — it's an addressable-market gap. A smartphone-app-only wallet caps itself out of a meaningfully large, underserved segment that incumbents already captured at scale but aren't necessarily optimizing hard for at the margin. Worth scoping as its own channel (a USSD gateway integration + a stripped-down menu-driven flow calling the same `wallet`/`ledger` APIs) once core parity features exist — building USSD before savings/bills would be optimizing reach before the product itself is competitive.

**Sources:** [USSD financial inclusion](https://www.itnewsafrica.com/2023/11/unlocking-financial-inclusion-ussd-technology-in-african-mobile-money/) · [Nigeria USSD banking backbone 2026](https://weetracker.com/2026/02/23/nigeria-ussd-debt-resolution-banks-telecoms/)

---

## 7. What NOT to chase

- **PalmPay's cashback-burn strategy.** It's their core differentiator and it's expensive — a cash-subsidized acquisition strategy makes sense for a well-funded incumbent defending share, not for a new entrant with a tight timeline and no war chest. Compete on reliability and product depth instead; a rewards program can follow once there's revenue to fund it.
- **Building our own agent network before the exclusivity rule's dust settles.** The April 2026 single-principal rule just reshuffled how every existing agent network operates — entering that fight now means competing for agents who are actively being forced to pick one partner, against incumbents with millions of existing relationships. Not a good first fight.
- **Cross-border/dollar cards as a launch feature.** Real differentiator, real demand (LemFi processes $1B+/month), but it's a distinct regulatory and banking-partner problem from domestic wallet/payments. Sequence after domestic parity, not before.

---

## 8. Sequencing recommendation

Given the timeline pressure already established for TrustPay, in order:

1. **Compliance fixes first, not last** — correct 3-tier KYC mapping, device binding + new-device transfer cap. These aren't competitive features, they're the difference between "operating" and "not operating" as of the dates already in force.
2. **Reconciliation service in `services/payments`** — rebuilds what the old `core-banking/` service already proved out, now generalized. This is both the compliance-adjacent AML/monitoring foundation *and* the NIBSS-outage-resilience differentiator from §4 — one build, two wins.
3. **Savings yield + bills payment** — the two consumer parity gaps with the best build-cost-to-expectation ratio (§3).
4. **AI/ML transaction monitoring** — has a real deadline (roadmap due June 2026, full compliance 18-24 months out); start before it's urgent, not after.
5. **Cards, USSD, agent network, cross-border** — real gaps, correctly sequenced after the product is competitive on the fundamentals, not before.

Happy to turn any one of these into the same kind of implementation plan the Ledger/Payments/TrustPay-backend builds went through — say which one and we'll scope it properly before writing code.
