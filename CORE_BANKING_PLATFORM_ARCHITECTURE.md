# Core Banking & BaaS Platform — Architecture Design

**Status:** Design proposal, no code depends on this yet
**Scope decided:** greenfield system (existing `core-banking/` is reference-only, not foundation); Nigeria-first regulatory scope; hybrid tenancy (multi-tenant SaaS core with a single-tenant/dedicated deployment path); full functional scope — deposits & wallets, loans & credit, card issuing/switching, and a BaaS/API platform layer.

This is a big system. The rest of this doc is organized so each section stands alone — skip to what you need rather than reading top to bottom.

---

## 1. What this system actually is

Not "TrustChat's wallet, hardened." A platform that:

- **Live banks and MFBs run their entire retail operation on** — accounts, ledger, loans, cards, statements, regulatory returns.
- **BaaS resellers build products on top of** — a fintech that wants "issue accounts + move money" without becoming a bank itself.
- **Multiple institutions can share** (multi-tenant) **or one institution can run in isolation** (single-tenant/dedicated) when their risk/compliance posture demands it.

That combination — core banking system *and* the API platform that resells it — is the entire design challenge. Everything below exists to serve one non-negotiable property: **the ledger is never wrong, even when everything else fails.**

---

## 2. Guiding principles

These are the tie-breakers when two design options both look reasonable. Refer back to these when making implementation decisions later — they resolve most "which way do we go" arguments without re-litigating from scratch.

1. **Correctness > availability > latency.** A core banking system that's fast and wrong is a lawsuit. One that's unavailable is a bad day. Ledger writes never sacrifice correctness for uptime; read paths (balances for display, statements) may serve slightly-stale data during degradation rather than fail.
2. **The ledger is boring technology, on purpose.** Double-entry bookkeeping, ACID transactions, `SERIALIZABLE` isolation where money moves. No eventual consistency on the ledger itself — save eventual consistency for read models, notifications, and analytics.
3. **Every state-changing action is idempotent and attributable.** Idempotency keys on every mutating call (already proven in the existing `core-banking/` ledger — keep the pattern). Every entry records *who* (user, service account, or system job) and *why* (entry type, originating request).
4. **Segregation of duties is architectural, not procedural.** The engineer who can deploy code cannot approve a manual ledger adjustment. The service that issues cards cannot also approve its own risk limits. Enforce this with separate credentials/roles and maker-checker workflows, not a wiki page saying "please don't."
5. **Compliance and fraud/risk are first-class modules, not bolted-on middleware.** KYC tier, AML screening, and transaction monitoring are consulted synchronously in the transaction path where required (can this account transact at all) and asynchronously where not (post-transaction SAR pattern matching).
6. **Tenant isolation is real, not assumed.** Every domain service treats `tenant_id` as a mandatory, non-optional dimension from day one — even single-tenant deployments run the same code path with one tenant row. Retrofitting isolation later is how you get a headline.
7. **Assume the network, a provider, or a data center will fail today.** Every external dependency (NIBSS, card networks, SMS gateway, a bank correspondent) has a defined degraded-mode behavior. "It just falls over" is not an acceptable failure mode for any module in the money path.

---

## 3. Domain decomposition (bounded contexts)

| Domain | Responsibility | Owns the source of truth for |
|---|---|---|
| **Identity & Tenant Mgmt** | Institutions (tenants), branch/org-unit hierarchy, staff identity, RBAC/ABAC, service accounts, API key issuance | Who can do what, on whose behalf, and at which branch |
| **Customer (CIF)** | Single customer view across every product; onboarding orchestration | Customer master record, KYC tier, relationship linkage |
| **KYC/AML/CFT** | BVN/NIN verification, watchlist/sanctions screening, tiered-KYC limits, transaction monitoring, SAR/STR generation | Customer risk rating, screening history |
| **Core Ledger / GL** | Double-entry accounting engine, chart of accounts, journal, period close | The money. All of it. |
| **Deposit Products** | Savings, current, fixed/term deposit, group savings (Ajo/esusu-style), escrow | Product terms, interest schedules, account lifecycle |
| **Loans & Credit** | Origination, disbursement, repayment schedules, accrual, delinquency, provisioning | Loan contracts, schedules, credit exposure |
| **Cards** | Issuance (virtual/physical), authorization switching, tokenization | Card records, PAN vault (PCI-scoped, isolated) |
| **Payments & Channels** | NIBSS NIP in/out, USSD, standing orders, bill payments, internal transfers | Payment instructions and their settlement state |
| **Merchant Checkout** *(gap — added August 2026, not in the original 16, not yet built)* | A hosted checkout surface a tenant can offer *their own* merchant customers — Squad/Paystack-Checkout-style: payment links/sessions, a hosted pay page, merchant-facing webhooks on completion, so a tenant's merchant doesn't have to build payment UI themselves. Distinct from Payments & Channels, which moves money once collected — this is the surface that collects it, and distinct from BaaS/API Platform, which is the API contract *tenants* integrate against, not their merchants'. See `COMPLIANCE_DESIGN_AND_BACKLOG.md`'s checkout segment for current status. | Checkout session/link state, tenant-scoped merchant records, payment-page lifecycle |
| **Treasury** | Nostro/vostro reconciliation, liquidity position, interbank settlement, float management | Bank's own position across correspondent accounts |
| **BaaS/API Platform** | Public API gateway, developer portal, sandbox, webhooks, per-tenant rate limits and key scoping | External-facing contract; nothing else talks to callers directly |
| **Regulatory Reporting** | CBN returns, NDIC deposit reporting, credit bureau submission (CRC/FirstCentral), NDPA data handling | Report generation, filing history, audit evidence |
| **Fraud & Risk** | Real-time transaction scoring, velocity rules, device/behavior signals | Risk decisions and their justification |
| **Reconciliation & Outbox** | Settlement-file reconciliation against providers/NIBSS; reliable event publishing | Reconciliation state, event delivery guarantees |
| **Notifications** | SMS/push/email/in-app, statement generation | Delivery state (not the money — never a source of truth for balances) |
| **Back-Office/Ops Console** | Support tooling, dispute handling, manual adjustment workflow (maker-checker) | Case/ticket state |
| **Audit & Observability** | Immutable audit trail, tracing, metrics, alerting | The record of everything that happened, independent of any domain's own logs |

**Why this shape:** each row is a bounded context with its own schema/service boundary — no other service reaches into the Ledger's tables directly, everyone calls its API or consumes its events. This is what makes "loans and cards can fail independently of deposits staying up" actually true rather than aspirational.

---

## 4. Macro-architecture

```
                              ┌─────────────────────────────┐
                              │   Channels (mobile, web,     │
                              │   USSD, agent/POS, partner)  │
                              └───────────────┬──────────────┘
                                              │
                              ┌───────────────▼──────────────┐
                              │  Edge: API Gateway + WAF      │
                              │  - TLS termination            │
                              │  - Tenant + key resolution     │
                              │  - Rate limiting (per-key tier)│
                              │  - Request signing verification│
                              └───────────────┬──────────────┘
                                              │  (internal mTLS only past here)
        ┌───────────────┬────────────────────┼────────────────────┬───────────────┐
        ▼               ▼                    ▼                    ▼               ▼
  ┌──────────┐   ┌──────────────┐    ┌──────────────┐     ┌──────────────┐  ┌──────────┐
  │ Identity │   │  Customer/    │    │  Deposit /    │     │  Loans &      │  │  Cards   │
  │ & Tenant │   │  KYC/AML      │    │  Payments     │     │  Credit       │  │          │
  └────┬─────┘   └───────┬──────┘    └───────┬───────┘     └───────┬───────┘  └────┬─────┘
       │                 │                    │                     │                │
       │                 │        ┌───────────▼─────────────────────▼────────────────▼──┐
       │                 │        │      Core Ledger / GL  (the only writer of balance)  │
       │                 │        │      SERIALIZABLE, double-entry, append-only         │
       │                 │        └───────────────────────────┬───────────────────────────┘
       │                 │                                    │
       │                 │              ┌─────────────────────▼─────────────────────┐
       │                 │              │   Event Backbone (outbox → broker)         │
       │                 │              │   - reconciliation, treasury, notifications │
       │                 │              │   - regulatory reporting, fraud scoring     │
       │                 │              │   - CQRS read models (statements, balances) │
       │                 │              └─────────────────────────────────────────────┘
       ▼                 ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │  Compliance & Risk plane (cross-cutting, consulted synchronously where required)   │
  │  KYC tier gate · sanctions/watchlist screening · fraud scoring · maker-checker      │
  └──────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │  External integrations: NIBSS (NIP/BVN), card networks, correspondent banks,       │
  │  SMS/push providers, credit bureaus — each behind an anti-corruption adapter        │
  └──────────────────────────────────────────────────────────────────────────────────┘
```

Three things worth calling out explicitly:

- **Nothing outside the ledger holds a balance.** Deposit, Loans, and Cards each own *product* state (terms, schedules, limits) but every balance-affecting action is a ledger journal entry. This is what prevents the classic bug class: "the app said ₦50,000 but the ledger says ₦48,000."
- **The Compliance & Risk plane sits in the request path for anything the regulator requires pre-transaction** (KYC tier limits, sanctions screening on new beneficiaries) and **out of the request path for everything else** (SAR pattern detection runs off the event stream, not synchronously on every transfer). Put too much in the synchronous path and every transaction inherits the latency and availability profile of your slowest compliance vendor.
- **External integrations are isolated behind adapters**, never called directly from domain services. When NIBSS has an outage (it will), the adapter's circuit breaker trips and the Payments domain degrades to "queue and retry" instead of every caller independently discovering the timeout.

---

## 5. Tenancy model

You asked for both — shared multi-tenant core *and* a single-tenant escape hatch. The way to get both without maintaining two codebases:

**Every table, every domain service, every event carries `tenant_id` as a non-nullable first-class column/field — no exceptions, including system/admin tables.** Row-level security (Postgres RLS) enforces it at the database layer as a second line of defense behind application-layer checks — so a bug in application code that forgets a `WHERE tenant_id = ?` clause still can't leak another tenant's data.

Deployment topology then becomes a *packaging* decision, not a *code* decision:

| Mode | Database | Compute | When to use |
|---|---|---|---|
| **Shared multi-tenant** | Shared Postgres cluster, RLS-enforced, tenant_id on every row | Shared K8s cluster, tenant resolved from API key at the gateway | Default for BaaS resellers and smaller MFBs — fast onboarding, lowest cost |
| **Dedicated schema** | Same cluster, tenant gets its own schema | Shared compute | Mid-tier institutions wanting stronger data separation without full infra duplication |
| **Fully dedicated (single-tenant)** | Separate database cluster, possibly separate cloud account/region | Separate namespace or fully separate deployment | Larger banks, institutions with regulatory/data-residency requirements, or anyone who contractually demands physical isolation |

The **ledger schema and application code are identical across all three modes** — only the deployment manifest and connection routing change. This is the same principle behind why the existing `core-banking/` provider abstraction (swap Kuda for Fincra with zero code changes elsewhere) worked well — apply it one layer up, to tenancy itself.

**Tenant onboarding is itself a workflow**, not a config file edit: provisioning a tenant creates its chart of accounts, default product catalog, API key pair, and compliance configuration (KYC tier limits, applicable regulatory reports) through the same maker-checker-gated admin flow used for everything else sensitive.

---

## 6. Data architecture

- **System of record:** the ledger is an append-only journal. Entries are never updated or deleted — corrections are new reversing/adjusting entries, full stop (the existing `ledgerService.reverseEntry` pattern is the right instinct; keep it, generalize it to the GL).
- **Chart of accounts:** hierarchical, tenant-scoped, supports the standard categories (asset/liability/equity/income/expense) plus a sub-ledger dimension per product (so "customer deposits" as a GL liability line reconciles against the sum of individual deposit account balances — this is the check that catches ledger bugs before an auditor does).
- **Multi-currency-ready even though scope is NGN-first:** amount stored as integer minor units (kobo) + currency code on every entry, as today. Don't hardcode NGN into the schema even if it's the only currency live at launch — a BaaS platform's next customer request is "can we hold USD."
- **Event backbone:** transactional outbox pattern (proven already in `eventOutboxService.js`) — the ledger write and the "publish this event" record commit in the same DB transaction, a separate publisher drains the outbox into a broker (Kafka/Redpanda for this scale — ordered per-account partitioning matters for correctness of downstream consumers like statement generation). This is what avoids the dual-write problem instead of hoping the message broker and the database never disagree.
- **CQRS for read-heavy paths:** balance lookups, statements, and admin dashboards read from denormalized projections built off the event stream, not by aggregating the journal live on every request (the current `getBalance()` sums ledger entries per call — fine at TrustChat's scale, becomes a hot-path liability at bank scale with millions of entries per account-year). The *authoritative* balance check inside a money-moving transaction still reads from the journal directly under `SERIALIZABLE` isolation; only *display* reads use the projection.
- **Audit log is a separate, append-only, write-once store** (or at minimum a separate table with no `UPDATE`/`DELETE` grants at the DB role level) — independent of application logs, capturing who/what/when/why for every sensitive action including reads of PII by staff.

---

## 7. Security architecture

Defense in depth, mapped to what actually gets attacked in a banking system:

**Network & perimeter**
- Core Ledger and data stores live in a private subnet with no direct internet route — only reachable from internal services over mTLS.
- API Gateway/WAF is the only internet-facing surface; everything past it is service-to-service mTLS with mutual cert auth (SPIFFE/SPIRE or your cloud's service-mesh identity is a reasonable default).
- Card PAN data (if physical/virtual card issuance is in scope) lives in a separately network-segmented, PCI-DSS-scoped enclave — tokenized references only, everywhere outside that enclave. Treat this as its own compliance boundary from day one; retrofitting PCI scope isolation after cards ship is materially harder than designing it in.

**Identity & access**
- Staff/admin access: RBAC with least privilege, mandatory MFA, session timeouts tuned for a banking back-office (short), and **maker-checker on every action that moves money or changes a limit** — manual ledger adjustments, KYC tier overrides, credit limit changes, refunds.
- API keys for the BaaS layer follow the **tiered-credential pattern** used elsewhere (the same shape AuthCore's own `AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md`, in the sibling `truechat` repo, proposes for its client SDK): scoped, revocable, tenant-bound credentials rather than one static secret. `SERVICE_CREDENTIAL_MODEL.md` (repo root) is trust-bank's own version of this — built for the caller type that actually exists today (backend-to-backend), with an `admin`/`operate` split rather than AuthCore's publishable/secret one. A client-embeddable, app/origin-bound tier (for a future BaaS partner's own app calling trust-bank directly) is real future scope, not built speculatively ahead of a real caller.
- Every credential (API key, service account, staff session) is scoped to a tenant — there is no "god credential" that spans tenants outside a small, separately-audited platform-admin role.

**Secrets & cryptography**
- KMS/HSM for signing keys and any cryptographic material (webhook signing secrets, card PIN block encryption if applicable) — never in application config or environment variables in plaintext.
- Encryption at rest (database, backups, object storage) and in transit (TLS 1.2+ everywhere, mTLS internally) as table stakes, not a differentiator.
- Secrets rotation is automated and time-boxed; a compromised key has a bounded blast-radius window by design, not by hoping someone notices.

**Application-layer**
- Idempotency keys mandatory on every mutating endpoint (existing pattern, keep it, enforce it as a framework-level requirement so a new endpoint can't ship without it).
- Input validation and rate limiting per tenant/per key, not just globally — one noisy tenant should never be able to degrade another tenant's service (this is the multi-tenant-specific failure mode to design against explicitly).
- Structured, immutable audit logging for every read/write touching customer PII or money — separate retention and access controls from operational logs.

**Program-level**
- Regular penetration testing and an ongoing vulnerability disclosure/bug bounty posture before onboarding real institutions — this is table stakes for anyone doing due diligence on a core banking vendor.
- Target ISO 27001 alignment and PCI-DSS certification (if cards ship) as concrete milestones, not vague aspirations — banks' procurement/compliance teams will ask for the certificate, not the intention.

---

## 8. High availability & disaster recovery

**Availability target:** core banking is conventionally held to 99.95%+ (≈4.4 hours/year downtime budget) for the transaction path; back-office/reporting can tolerate a lower bar.

- **Compute:** stateless domain services behind load balancers, horizontally scaled, deployed across at least 2 availability zones. No service holds in-memory state that would be lost on a pod restart.
- **Database:** Postgres in a primary + synchronous-replica HA configuration (Patroni or equivalent) within a region, with async cross-region replication for DR. The ledger's correctness requirement (no lost writes) argues for synchronous replication to at least one standby before acknowledging a money-moving write — accept the latency cost here; this is exactly where principle #1 (correctness over latency) applies.
- **Event broker:** replicated, durable (Kafka with `acks=all` equivalent) — an event that represents "money moved" is not allowed to be lost because a broker node restarted.
- **Multi-region DR:** primary region + a warm standby in a second region (for Nigeria: a second AZ/region combination with your cloud provider, or a second data center if on-prem). Define and rehearse actual RPO/RTO targets — "we have backups" is not a DR plan until you've timed a restore.
- **Graceful degradation, defined per dependency:** e.g., if NIBSS is down, inbound/outbound interbank transfers queue with clear customer-facing status rather than the whole platform failing; if the fraud-scoring service is degraded, define whether transactions proceed with a conservative default or hold for manual review — this is a product/risk decision that needs to be made explicitly, not discovered during an incident.
- **Circuit breakers and bulkheads** between domains so that Cards being unhealthy doesn't take down Deposits — this is the payoff of the bounded-context separation in section 3; it only works if the failure isolation is actually enforced (separate deploys, separate resource pools, no shared blocking connection pool).
- **Chaos/game-day testing** for the failure modes above, on a recurring cadence, before this carries real institutions' money.

---

## 9. Consistency & transaction processing

- **Within the ledger:** `SERIALIZABLE` isolation for balance-affecting writes (proven pattern already in place) — this is non-negotiable, it's what prevents the double-spend/overdraft-race class of bug.
- **Across domains (e.g., loan disbursement = create loan schedule + credit deposit account):** use the **saga pattern with compensating actions**, orchestrated through the event outbox — not distributed 2PC across service boundaries. Each step is itself a local ACID transaction with idempotency; a failure partway through triggers a compensating entry (this is the same reversal mechanism as section 6, applied to multi-step workflows).
- **End-of-day processing:** interest accrual, fee assessment, and period close run as scheduled, idempotent batch jobs — safe to re-run, produce ledger entries like any other transaction (no special "batch-only" write path that bypasses the normal invariants).
- **Reconciliation:** automated, continuous reconciliation against every external settlement source (NIBSS settlement files, card network settlement, correspondent bank statements) — building directly on the existing `reconciliationService.js` pattern, generalized across all payment rails, not just one provider. Discrepancies raise to a dedicated ops queue, never silently auto-correct the ledger.

---

## 10. API & BaaS platform layer

This is what makes it a *platform* and not just an internal core:

- **Public REST API**, OpenAPI-specified, versioned from day one (`/v1/...`) with a documented deprecation policy — partners build businesses on this contract; breaking it without notice breaks their business.
- **Tiered API keys** per the AuthCore-derived pattern above: publishable/scoped keys for anything client-embeddable, secret keys for server-side, both tenant-scoped, both independently rate-limited and revocable.
- **Webhooks** for async events (transaction settled, KYC decision, dispute opened) with signed payloads (HMAC) and a retry/backoff policy partners can rely on — plus a replay/history view so a partner debugging a missed webhook doesn't have to email support.
- **Sandbox environment** that mirrors production behavior including realistic failure injection (simulate NIBSS timeout, insufficient funds, KYC rejection) — a BaaS platform that can only be tested against a happy-path sandbox produces partners who ship untested error handling straight to production.
- **Developer portal**: API docs, key management, usage/billing dashboards, status page. This is a product surface, not an afterthought — for a BaaS business, the developer experience *is* the product.
- **Per-tenant rate limiting and quota** enforced at the gateway, independent of any one tenant's traffic pattern affecting another (multi-tenant noisy-neighbor protection, called out in section 7).

---

## 11. Regulatory & compliance mapping (Nigeria-first)

This section needs review from actual compliance/legal counsel before being treated as authoritative — treat it as the engineering-relevant checklist to design *for*, not a substitute for that review.

| Area | What it drives in the architecture |
|---|---|
| **CBN licensing tiers** (MFB: Unit/State/National; PSB; BaaS/API-based regulatory framework) | Tenant onboarding must capture license type, since it determines applicable limits, capital adequacy reporting, and which product modules a tenant is even permitted to enable |
| **BVN/NIN-based KYC, tiered KYC (CBN AML/CFT regs)** | KYC tier is a first-class attribute on Customer, enforced synchronously as a transaction gate (limits per tier), not just a compliance report generated after the fact |
| **NIBSS connectivity** (NIP, BVN verification service, industry watchlist) | Dedicated adapter in the Payments domain; NIBSS is a critical external dependency needing its own circuit breaker and degraded-mode design (section 8) |
| **CBN Open Banking Regulatory Framework** | Directly shapes the BaaS/API platform layer (section 10) — data-sharing categories and consent management should map to this framework rather than being invented ad hoc |
| **CBN cybersecurity/incident-reporting requirements** | Drives the audit logging and incident response design; regulators expect defined incident-reporting timelines, which means your observability stack needs to be able to answer "what happened, to whom, when" fast |
| **NDIC deposit insurance reporting** | Regulatory Reporting domain needs deposit-balance reporting as a defined, scheduled export, tenant-scoped |
| **Nigeria Data Protection Act (NDPA)** | Data residency, PII access audit trail (section 6), and data subject rights (access/erasure requests) need to be workflow-supported, not just a policy document |
| **Credit bureau reporting** (CRC Credit Bureau, FirstCentral) | Loans domain needs scheduled, tenant-scoped submission jobs as part of the loan lifecycle, not a manual export |
| **PCI-DSS** (if card issuing ships) | Drives the isolated card enclave in section 7; scope this in architecturally before card issuance is built, not after |

---

## 12. Technology stack — recommendation

Your team's existing strength is Node.js/Express/Prisma (both the TrustChat backend and the current `core-banking/` service). That's a reasonable choice to carry forward for most domain services — don't force a language change for its own sake. Two deliberate exceptions worth considering:

- **The Core Ledger service specifically** is the one place where a statically-typed, more rigorously concurrency-safe runtime (TypeScript with strict mode at minimum, or a JVM/Go language if the team is willing) earns its keep — this is the module where a subtle bug is a financial-statement bug, not a UX bug. If staying in Node, at minimum: TypeScript strict mode, exhaustive input validation, and no untyped `any` anywhere near a money amount.
- **Event broker:** Kafka or Redpanda (Redpanda if you want Kafka-compatible semantics with less operational overhead at this team size) over something lighter-weight — the durability and ordered-partition guarantees matter here in a way they didn't for TrustChat's chat/messaging use case.

Otherwise: Postgres (proven already, and its `SERIALIZABLE` isolation + RLS support directly serve sections 6/8 above), Prisma or a lower-level query layer for the ledger specifically (an ORM's convenience matters less than explicit control over isolation levels for the one service where that's load-bearing), Redis for caching/rate-limit counters, Kubernetes for orchestration if you're not already there.

---

## 13. Phased rollout

"Everything a bank does" is the right ambition and the wrong first milestone. Sequence it so each phase is independently valuable and de-risks the next:

- **Phase 1 — Multi-tenant deposits/wallets, hardened.** Take the proven patterns from the existing `core-banking/` service (ledger, idempotency, outbox, reconciliation) and rebuild them greenfield with tenancy, HA, and the security architecture above from the start. This alone, done well, is sellable to a BaaS reseller or a small MFB.
- **Phase 2 — BaaS/API platform layer on top of Phase 1.** Public API, tiered keys, sandbox, developer portal. Turns the internal core into a resellable product.
- **Phase 2.5 — Identity, RBAC & Back-Office** *(gap — added August 2026; both bounded contexts were named in section 3 and required by section 2's "segregation of duties is architectural" principle from the start, but never scheduled into a phase — a planning gap, not a deliberate deferral)*. Everything built through Phase 2 authenticates *machines* — service credentials, tenant-scoped API keys — never a human. There is no staff identity separate from a tenant's own customer auth, no roles/permission scopes, and no maker-checker anywhere, which means section 7's "the engineer who deploys code cannot approve a manual ledger adjustment" isn't true yet. Sequenced here, before Loans, deliberately: loan approval (officer originates, credit manager approves) is the canonical maker-checker workflow, and building Loans without this foundation first means either shipping it without real approval gates or bolting on a rushed permission model mid-build — the "retrofit under pressure" section 2 exists to prevent. Real, non-hypothetical surface area already exists to gate: KYC tier overrides (Compliance) and refunds (Payments' reconciliation) are both currently single-actor, unapproved actions. Scope: staff identity (separate login from a tenant's own AuthCore-based consumer auth), roles + RBAC permission scopes, maker-checker on money-moving/limit-changing actions, and **branch/org-unit hierarchy as a first-class scoping dimension from the start** — not deferred until a specific multi-branch tenant asks for it, the same way BaaS/API and resilience posture stopped being deferred once trust-bank was reframed as the product sold to banks rather than something built around TrustPay alone; a `NATIONAL_MFB`'s branch structure is a basic expectation of that market segment, not a speculative feature.
- **Phase 3 — Loans & credit.** Highest-complexity domain (accrual, delinquency, provisioning, credit bureau integration) — sequence after the ledger and compliance plane are proven under real transaction volume, and after Phase 2.5's maker-checker foundation exists for loan approval to build on.
- **Phase 4 — Cards issuing/switching.** Deliberately last: the PCI-DSS scope and card-network integration have the longest external certification lead time, and benefit from a mature, already-audited ledger underneath them.
- **Phase 5 — Deepen regulatory automation & treasury.** Full CBN/NDIC reporting automation, treasury/liquidity management — these matter most once you're carrying real institutional volume, and are easier to get right against a system that's already proven stable.

Each phase should ship with its slice of sections 7–9 (security, HA, consistency) complete for the domains it introduces — not deferred to a later "hardening phase." Retrofitting isolation, HA, or compliance controls onto a live money-moving system is far more expensive than building them in per-phase.

---

## 14. Open decisions that need your input before implementation starts

- **Cloud provider / infra baseline** — affects specifics of sections 7–8 (which HA primitives, which KMS, which region pair for DR).
- **Team size and timeline** — determines how aggressively to parallelize the phases in section 13 versus running them strictly sequentially.
- **First real customer profile** — an MFB migrating an existing ledger looks very different (data migration, parallel-run reconciliation) from a BaaS reseller starting from zero. Worth knowing which comes first, since it changes what Phase 1 needs to support.
- **Build vs. buy for KYC/BVN verification and card issuing/switching** — these have mature third-party providers; decide per-module whether you're building the integration or the capability itself.
