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
| **Merchant Checkout** *(gap — added August 2026, not in the original 16, not yet built — tracked in Phase 6)* | A hosted checkout surface a tenant can offer *their own* merchant customers — Squad/Paystack-Checkout-style: payment links/sessions, a hosted pay page, merchant-facing webhooks on completion, so a tenant's merchant doesn't have to build payment UI themselves. Distinct from Payments & Channels, which moves money once collected — this is the surface that collects it, and distinct from BaaS/API Platform, which is the API contract *tenants* integrate against, not their merchants'. See `COMPLIANCE_DESIGN_AND_BACKLOG.md`'s checkout segment for current status. | Checkout session/link state, tenant-scoped merchant records, payment-page lifecycle |
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
- **Phase 2 — BaaS/API platform layer on top of Phase 1.** Public API, tiered keys, sandbox, developer portal. Turns the internal core into a resellable product. **Remaining**: self-serve API key management and a usage/billing dashboard, the rest of section 12's developer-portal vision — tracked in Phase 6.
- **Phase 2.5 — Identity, RBAC & Back-Office** *(gap — added August 2026; both bounded contexts were named in section 3 and required by section 2's "segregation of duties is architectural" principle from the start, but never scheduled into a phase — a planning gap, not a deliberate deferral)*. **Shipped in full**, slices 1 through 3: staff identity (password + mandatory MFA, no bypass path; short, sliding-expiry sessions; a fixed RBAC role set); maker-checker (dual approval on Compliance's case-review route — previously a free-text, unverified `reviewedBy` — Compliance's KYC/device/monitoring policy-publish routes, and Ledger's manual-adjustment/reversal primitives; `requestedById != approvedById` enforced in code, not just by role; policy-publish actions require the stricter `ops_admin`-only approval tier, since a policy change affects every future decision tenant-wide, not one case); and branch/org-unit hierarchy, built in from the start rather than deferred until a multi-branch tenant asked for it — a `NATIONAL_MFB`'s branch structure is a basic expectation of the market segment, the same reframe already applied to BaaS/API and resilience posture — now threaded all the way through to a real `branch_id` tag on the Ledger's own `ledger_accounts`, set via a staff-initiated account-open route (`services/identity`'s `POST /v1/accounts`) that forces a teller/branch manager to their own branch and leaves the tenant's existing self-service consumer flow (`trustpay-backend`) untouched. Section 7's "the engineer who deploys code cannot approve a manual ledger adjustment" is now true for these actions. Sequenced before Loans deliberately: loan approval (officer originates, credit manager approves) is the canonical maker-checker workflow, and this foundation now exists for it to build on. **Remaining**: no staff-facing web UI; no password reset/change-password flow — both tracked in Phase 6.
- **Phase 3 — Loans & credit.** Highest-complexity domain (accrual, delinquency, provisioning, credit bureau integration) — sequence after the ledger and compliance plane are proven under real transaction volume, and after Phase 2.5's maker-checker foundation exists for loan approval to build on. **Slice 1 shipped** (August 2026): the core loan lifecycle — origination (deterministic, policy-based eligibility against a new versioned `LoanEligibilityPolicy` in Compliance; not maker-checker, no staff discretion exercised), disbursement (staff-discretionary release of funds — the canonical maker-checker workflow Phase 2.5 was sequenced to unblock: `loan_officer`/`credit_manager` originates and requests, a *different* `credit_manager` approves, self-approval and wrong-role approval both rejected), daily interest accrual (reversed direction from savings — debits the loan, credits a new `SYS-INTEREST-INCOME` system account against GL `4200`), and repayment (routine, customer-driven, not maker-checker, closes the loan on a zero balance). Built as a new `internal/loan` Ledger package following the "the Ledger never calls another service" rule already held by every existing flow — the credit-eligibility decision runs in `services/identity`'s own staff-initiated route, before it ever calls the Ledger. Two new RBAC roles (`loan_officer` branch-scoped, `credit_manager` tenant-wide) added matching this section's own "officer originates, credit manager approves" language. Live verification caught and fixed a real, previously-latent bug from Phase 2.5 slice 3: three account-reading functions in the Ledger (`ListByExternalCustomerIDAndProduct`, `GetByExternalCustomerID`, `ListByProductType`) never selected `branch_id`, silently returning `null` on every read regardless of the correctly-stored value. **Slice 2 shipped** (August 2026): delinquency detection and loan-loss provisioning — the two remaining gaps that are pure platform mechanics, no external party involved. The Ledger computes `daysPastDue`/a bucket (`current`/`1-30`/`31-60`/`61-90`/`90+`) for every loan from data it already had (`MaturityDate`, set at disbursement); a new pass on the same accrual goroutine trues up a per-loan loan-loss reserve against a fixed expected-credit-loss matrix (new GL `1250` Loan Loss Reserve, contra-asset, and `5200` Loan Loss Provision Expense — existing tenants backfilled via a new idempotent `cmd/backfill-loan-loss-accounts` binary, since unlike slice 1's GL codes these didn't exist for any tenant before this slice). `services/identity` gained a new background job (`delinquencyRunner.js`, same `setInterval` shape as `services/payments`' `reconciliationRunner.js`) that forwards overdue loans' `daysPastDue`/bucket to a new Compliance route — mechanical, caller-fed, not maker-checker — which opens/updates a `ComplianceCase` (`caseType: loan_delinquency`) reviewed through the already-shipped `COMPLIANCE_CASE_REVIEW` maker-checker flow, unmodified, zero new approval plumbing. Live verification caught a real bug in the provisioning pass's own idempotency key (date-based, matching every other key in the package) — the reserve's target can legitimately change more than once on the same calendar day, and the Ledger's existing dedup-by-key behavior silently returned the first entry under a stale key instead of erroring, permanently understating the reserve; fixed by keying idempotency off the target amount instead (safe since the reserve is monotonically non-decreasing by design). Reserve release on repayment/cure is a named, deliberate non-goal of this slice, not a bug. **Slice 3 shipped, Phase 3 complete** (August 2026): credit bureau reporting — but shape only, not a real integration, since no CRC Credit Bureau/FirstCentral commercial relationship exists. `services/identity` gained an abstract `CreditBureauProvider` contract (mirroring `services/payments`' own `PaymentsProvider` pattern — a real bureau is a new concrete provider, nothing else changes) and its only implementation, a no-op stub that logs what a real submission would send. A new `creditBureauRunner.js` background job (same shape as slice 2's `delinquencyRunner.js`) submits every tenant's `ACTIVE` loans daily — real bureau reporting is typically monthly, but a literal 30-day interval isn't safely expressible via `setInterval`'s ~24.8-day ceiling, and cadence doesn't matter yet since nothing real is sent. **A real, named gap surfaced rather than solved**: bureau submission needs verified customer identity (full name, BVN) alongside loan terms, and this platform has nowhere generic to source it — that data lives in each tenant's own bespoke product backend (e.g. `trustpay-backend`'s `User.verifiedFullName`), not in this tenant-agnostic core, and no generic customer-KYC-profile bounded context exists here. The submission payload's `customerIdentity` field is always `null`, documented, not silently faked or omitted — wiring a real product backend to supply it, or building that service, is separate future work. Phase 3's three originally-named gaps (delinquency, provisioning, credit bureau integration) are now all addressed to the extent this platform's current scope allows.
- **Phase 4 — Cards issuing/switching.** Deliberately last: the PCI-DSS scope and card-network integration have the longest external certification lead time, and benefit from a mature, already-audited ledger underneath them. **Slice 1 shipped** (August 2026): card issuance and lifecycle orchestration — shape only, no real PAN ever, matching section 7's own requirement that card data live in a separately network-segmented, PCI-DSS-scoped enclave a certified third party owns, and section 12's own "build vs. buy" call for this domain. New `services/cards` (Node, its own bounded context per section 3 — a card holds no balance of its own, so unlike loans it doesn't belong inside the Ledger) exposes an abstract `CardIssuingProvider` contract (mirrors `services/payments`' `PaymentsProvider` pattern) behind which the only implementation today is a no-op stub returning an obviously-synthetic tokenized reference, since no real card-issuing-as-a-service relationship exists. Issuance is gated by a new versioned `CardIssuancePolicy` in Compliance (min KYC tier, max cards per customer, spend limits), checked by `trustpay-backend` before it ever calls Cards — the same "the calling backend checks Compliance first" rule every domain in this platform holds; Cards never calls Compliance itself. `authorize` (a live balance/limit check) and `settle` (a real Ledger journal entry, new `card_settlement` entry type via `internal/wallet.RecordCardSettlement`) are called by Cards directly against its own stored per-tenant Ledger credential — not routed through the product backend — since a real deployment drives both from the card processor's own webhook, not the product backend's request lifecycle. Live-verified end to end: issuance gated on real KYC tier and real card-count limits, `authorize` correctly reading the Ledger's live balance (not cached) including a decline immediately after a real, separate withdrawal drained the wallet, `settle` posting real journal entries with daily-limit enforcement at the exact boundary, and freeze/unfreeze/close all correctly gating `authorize`. **Slice 2 shipped** (August 2026): Gateway proxying and a real multi-provider architecture. `services/cards` gained a `TenantCardProviderConfig` (mirroring Payments' own `TenantProviderConfig` exactly — per-tenant provider name, encrypted credentials, a `tenantSlug` for routing inbound webhooks pre-auth) and a `registry.js`, so every card operation resolves its provider per tenant per call rather than a hardcoded instance — adding a real provider (Sudo Africa, or any other card-issuing-as-a-service platform) is a new provider file plus one registry entry, zero other code changes, the same guarantee Payments already proved with two structurally different rails. On "even if it's direct Visa/Mastercard integration": no issuer talks raw ISO 8583 to a card network directly — that transport-level relationship belongs to a processor (Marqeta, Galileo, TSYS, i2c, Sudo Africa), so "direct" still means "a different, larger processor" exposing the same fundamental shape — REST issuance, real-time authorization webhooks — which is exactly what this slice's widened `CardIssuingProvider` contract (`verifyWebhookSignature`, `parseWebhookEvent`, `formatAuthorizationResponse`) already covers; nothing ISO-8583-specific was built, since that would be guesswork without a real processor's actual API docs in hand. A new `POST /v1/webhooks/{tenantSlug}/{provider}` route is the automatic path a real provider will eventually drive; slice 1's direct `authorize`/`settle` routes stay as the manual/ops equivalent. Cards is now proxied through the Gateway (`services/gateway`'s `backendProxy.js` gained a fourth `BACKENDS` entry — zero new circuit-breaker code, the existing per-backend-breaker loop picks it up automatically — and a new `routes/cards.js` mirroring `routes/compliance.js`'s exact shape), and `/ready` now checks Cards' own reachability alongside the other three backends. Live-verified end to end: issuance/list/freeze/unfreeze all proxied correctly through a real production-tier Gateway API key; a correctly-signed authorization webhook resolved the right card, ran the same limit/live-balance logic slice 1 proved, and returned a synchronous decision; a bad signature was rejected before any card logic ran and an unknown tenant slug was rejected before any provider was touched; a settlement webhook posted a real `card_settlement` journal entry moving the real wallet balance; and every one of slice 1's own direct routes, plus an existing Ledger-proxied Gateway route, were confirmed unaffected by the change. **Remaining within Phase 4**: physical cards, a real card-issuing-as-a-service integration (Sudo Africa or otherwise — the contract is ready, no concrete provider exists yet), hold/capture linkage, Apple Pay/Google Pay tokenization, chargebacks/disputes, and PIN/3-D Secure — named here, not silently dropped, same discipline as every other slice's placeholders.
- **Phase 5 — Deepen regulatory automation & treasury.** Full CBN/NDIC reporting automation, treasury/liquidity management — these matter most once you're carrying real institutional volume, and are easier to get right against a system that's already proven stable.
- **Phase 6 — Loose ends.** Not sequenced after Phase 5 the way 1 through 5 build on each other — a catch-all for real, already-named gaps that never justified a phase number of their own, collected here so nothing outstanding stays untracked. Pick items up opportunistically, not in order.
  - **Staff-facing web UI** (`services/identity`) — every Phase 2.5/3 flow (login, MFA, branches, approvals, loan origination, case review) is API-only today. Deliberately deferred: there's no real staff operating any of this day-to-day yet, only a founder verifying flows via `curl`. The trigger to build it is the first real branch/ops staff being assigned, not a fixed point on this roadmap.
  - **Password reset / change-password flow** (`services/identity`) — **shipped** (August 2026). Three flows: self-service forgot-password (`POST /v1/password-reset/request`/`/confirm`, no enumeration signal — identical response whether the email exists or not), change-password while logged in (revokes every *other* session, keeps the calling one alive), and an `ops_admin`-only admin-initiated reset for a staff member who's lost both password and email access. The first feature anywhere in this platform to reach a human outside an authenticated session, which made it the first that needed email at all — a new `EmailProvider` contract (mirrors `PaymentsProvider`'s swappable-provider pattern) backed by a `NoopEmailProvider` (this environment's own verification target) and a real `SmtpEmailProvider` (`nodemailer`, works with any SMTP-compatible provider — AWS SES, SendGrid, Mailgun, Postmark, a real Google Workspace account — the moment real credentials exist, unlike Cards/credit-bureau's stubs which need an actual commercial relationship first). No staff web page exists yet, so the reset email carries a raw token, not a link — submitted directly to the API, same as everything else in this service. `PasswordResetToken` deliberately reuses `StaffSession`'s shown-once/hashed/prefix-indexed shape rather than `mfaChallengeService.js`'s stateless pattern, since a reset token needs real single-use revocation across a full expiry window, not just one continuous login flow. Live-verified: a logged token confirmed successfully, rejected on reuse and when expired; no-enumeration confirmed identical for a real vs. fake email; change-password's session-scoping (kill others, keep the caller) and the admin route's temp-password issuance both confirmed working. **Named limitation**: no rate limiting on the request endpoint — identity has no existing rate-limit infrastructure (unlike the Gateway's own Postgres-backed one), out of scope for this item.
  - **Self-serve API key management and a usage/billing dashboard** (Phase 2's fuller developer-portal vision, section 12) — both need infrastructure this platform doesn't have yet (a bank-developer login system, metering/billing), not a natural extension of what Phase 2 already shipped.
  - **Merchant Checkout** (section 3's bounded-context table) — a hosted checkout surface a tenant could offer their own merchants. Identified and documented, never built — its value case needs a real BaaS-reseller tenant, and TrustPay isn't one.
  - **mTLS for internal service-to-service calls** in a real hybrid deployment (section 9) — **shipped** (August 2026). Scoped credentials (`SERVICE_CREDENTIAL_MODEL.md`) already made every caller revocable and tenant-bound; mTLS adds mutual, certificate-based caller identity on top — opt-in (`MTLS_ENABLED`, default `false`), since on the default loopback-only SaaS topology it defends against nothing and every prior live-verification pass in this platform's history already exercises the "off" path as a pure regression check. `deploy/generate-mtls-certs.sh` generates an internal self-signed CA (10-year) plus a leaf cert per service (1-year, idempotent — reruns skip anything that already exists). Ledger (Go) gained `internal/tlsconfig` — server-side only, since the Ledger never calls another service, the one house rule held throughout this platform. All six Node services gained a `src/tls/mtls.js` (duplicated per service, matching this repo's existing convention for `logger.js`/`errors.js` rather than a shared package) with `getServerOptions()` (inbound, requires and verifies a client cert once enabled) and `getHttpsAgent()` (outbound — presenting a client cert is independent of a service's own inbound requirement, so a caller can present one without requiring one back); every inter-service axios client (`ledgerClient.js` in Payments/Cards/trustpay-backend, `paymentsClient.js`/`complianceClient.js`/`cardsClient.js` in trustpay-backend, `backendExecutor.js` in Identity, `backendProxy.js` in the Gateway) now passes `httpsAgent: getHttpsAgent()`, a no-op `undefined` unless a client cert is configured. Live-verified: a full regression pass (`MTLS_ENABLED` unset) confirmed the Ledger, Compliance, and Identity all serve identically to before; an mTLS-enabled pass against both the Ledger and a Node service (Compliance) confirmed a plain/no-cert request is rejected at the connection level, a cert signed by a different CA is rejected (`unknown ca` / `SELF_SIGNED_CERT_IN_CHAIN`), and the correct client cert succeeds against a real endpoint — repeated on the outbound side too, exercising the exact `getHttpsAgent()` code path every inter-service client now calls. **Still open**: automated certificate rotation and revocation checking (CRL/OCSP) — same reasoning as before, real PKI lifecycle automation isn't worth the operational burden before there's live hybrid volume to justify it; rotate manually by deleting a service's leaf cert/key and rerunning the generation script.
  - **A live NIBSS/switching-partner relationship** for a real bank tenant's own self-issued NUBAN — the one item here that isn't code-buildable at all. Self-issued NUBAN check-digit generation shipped; what's left is a regulatory/commercial relationship under the bank's own name, not an engineering task.

Each phase should ship with its slice of sections 7–9 (security, HA, consistency) complete for the domains it introduces — not deferred to a later "hardening phase." Retrofitting isolation, HA, or compliance controls onto a live money-moving system is far more expensive than building them in per-phase.

---

## 14. Open decisions that need your input before implementation starts

- **Cloud provider / infra baseline** — affects specifics of sections 7–8 (which HA primitives, which KMS, which region pair for DR).
- **Team size and timeline** — determines how aggressively to parallelize the phases in section 13 versus running them strictly sequentially.
- **First real customer profile** — an MFB migrating an existing ledger looks very different (data migration, parallel-run reconciliation) from a BaaS reseller starting from zero. Worth knowing which comes first, since it changes what Phase 1 needs to support.
- **Build vs. buy for KYC/BVN verification and card issuing/switching** — these have mature third-party providers; decide per-module whether you're building the integration or the capability itself.
