# Identity

Staff login, MFA, sessions, RBAC, branch/org-unit modeling, and
maker-checker — the first *human* identity in trust-bank, and the
staff-facing side of Phase 3's loan origination
(`CORE_BANKING_PLATFORM_ARCHITECTURE.md` §13). Every other credential in
this platform (Ledger's admin/operate/platform-admin, Payments/Compliance's
admin/operate, the gateway's tiered API keys) is a machine credential —
long-lived, shown-once, bearer-token-shaped, meant for one service to
authenticate to another. A staff member logs in with a password and MFA
and holds a role instead.

Internal back-office tooling — loopback-only like Ledger/Payments/
Compliance, never a public entry point the way the gateway or a product
backend is (see `deploy/NETWORK_TOPOLOGY.md`). Multi-tenant, same shape as
Payments/Compliance/Gateway: one process, tenant-scoped rows, not a
per-tenant deployment like `trustpay-backend`.

## What's real vs. what's a placeholder

**Real, and verified live** — a throwaway 5-service stack (Ledger,
Payments, Compliance, Gateway, this service), a real tenant provisioned
through the actual `deploy/provision-tenant.sh` (including its new
`--ops-admin-email` step, not by hand):

- **Password + mandatory MFA, no exceptions** — there is no path from a
  bare password to a real session, enrolled or not. A not-yet-enrolled
  login gets an MFA *challenge* token and `mfaEnrolled: false`, and has to
  complete `/v1/mfa/enroll` + `/v1/mfa/enroll/confirm` — a real TOTP
  round-trip, not a stub — before it ever gets a session. Verified live
  with `otplib`'s own code-generation function to prove the returned
  `otpauth://` URI is correct, not just that a string comes back.
- **Argon2id password hashing** — the first password hashing anywhere in
  this platform; every other credential is a high-entropy random token
  that doesn't need it (`SERVICE_CREDENTIAL_MODEL.md`).
- **Short-lived, sliding-expiry sessions** — same shown-once/hashed/
  indexed-prefix shape as every other credential in this platform, but a
  30-minute idle timeout instead of a long life (architecture doc §7:
  "session timeouts tuned for a banking back-office — short"). Verified
  live: force-expiring a session directly in Postgres gets an immediate
  `401 SESSION_INVALID` on the next request.
- **RBAC, role-gated routes** — a fixed role set (`teller`,
  `branch_manager`, `compliance_officer`, `ops_admin`), not a generic
  permission-string system yet (ABAC is real future scope, not built
  speculatively — same posture `SERVICE_CREDENTIAL_MODEL.md` takes on its
  own future tiers). Verified live: a `teller` session gets a real `403`
  attempting an `ops_admin`-only route.
- **Branch/org-unit modeling, built in from the start** — `Branch` is a
  real, tenant-scoped entity; `StaffUser.branchId` assigns staff to one.
  Not deferred until a specific multi-branch tenant asks for it — a
  `NATIONAL_MFB`'s branch structure is a basic expectation of the market
  segment trust-bank targets, not a speculative feature. Ledger's own
  `ledger_accounts` don't carry a `branch_id` tag yet — that's slice 3,
  not built here.
- **Tenant isolation** — verified live: tenant B's session can't see
  tenant A's branches, same regression class already proven for every
  other credential model in this platform.
- **MFA secrets encrypted at rest** — AES-256-GCM, same pattern as
  `services/payments`' `tenantSecrets.js` / `services/gateway`'s
  `tenantBackendCredentials.js`.
- **No public self-signup route** — the only way a staff user gets
  created is `scripts/bootstrapStaffUser.js`, run with direct DB access
  by a human or `provision-tenant.sh`. Verified live: every guessed
  signup-shaped route (`/v1/signup`, `/v1/staff`, `/v1/register`) 404s.

- **Maker-checker** (slice 2, shipped) — dual approval on
  `COMPLIANCE_CASE_REVIEW`, `LEDGER_ADJUSTMENT`, and `LEDGER_REVERSAL`.
  A maker requests an action; a *different* staff member with the right
  role approves it; only on approval does this service call the real
  endpoint, using its own stored, encrypted, per-tenant Ledger/Compliance
  operate credential (mirrors the gateway's own `TenantBackendCredential`
  pattern exactly). `requestedById !== approvedById` is enforced in code,
  not just by role — the actual mechanical guarantee, since two people
  with the same role can still check each other but the same person
  never can. The payload is the exact request body the target endpoint
  already expects — this service doesn't re-validate business meaning,
  it only gates who can approve what and forwards the payload unchanged.
  Verified live: a compliance officer requested a real case review, a
  different ops_admin approved it, and the real `ComplianceCase` row's
  `reviewedBy` field now shows the checker's real, session-verified email
  — not the free-text string the route used to accept from anyone.
  Also verified: self-approval rejected (403) even when the role would
  otherwise allow it; a `teller` attempting to approve a `LEDGER_ADJUSTMENT`
  rejected (403, wrong role — approveRoles is `ops_admin`-only for money
  movement); a real balanced journal entry posted and the account balance
  actually moved on approval; a rejected request executes nothing; and a
  failed execution (Ledger stopped mid-approval) is captured as `status:
  'failed'` with the real error, then a `retry-execution` call after
  restarting the Ledger succeeds using the same maker-supplied
  `idempotencyKey`.
- **Maker-checker on policy publishing** (slice 2b, shipped) —
  `COMPLIANCE_KYC_POLICY_PUBLISH`, `COMPLIANCE_DEVICE_POLICY_PUBLISH`, and
  `COMPLIANCE_MONITORING_POLICY_PUBLISH` now covered too. These needed
  `admin` scope, one tier above what covered case review alone
  (`operate`) — Compliance's own scope hierarchy means `admin` satisfies
  `operate`-gated routes too, so this service's stored Compliance
  credential was upgraded in place rather than holding two. `approveRoles`
  is `ops_admin`-only for all three (stricter than case review's
  peer-reviewable set) — a policy change affects every future decision
  tenant-wide, not one case. Verified live: a `compliance_officer`
  (allowed to *request* a policy publish) gets a `403` trying to
  *approve* their own request — a plain role rejection, not even reaching
  the self-approval check — proving `approveRoles` is genuinely
  per-actionType and not a blanket capability once a role can touch an
  action at all. An `ops_admin` approval published a real KYC-tier
  policy, confirmed by a live `kyc-tier-check` call that started
  enforcing the new limit immediately; device-policy and
  monitoring-policy publishing verified the same way. A regression check
  confirmed `COMPLIANCE_CASE_REVIEW`'s own `compliance_officer`
  peer-approval still works unchanged (fails on self-approval, not on
  role, when a maker tries to approve their own case review).
- **Staff-initiated account opening, with real branch tagging** (slice 3,
  shipped) — `POST /v1/accounts` lets a `teller`/`branch_manager`/
  `ops_admin` open a Ledger account through this service, which now tags
  it with a real `branch_id` (`services/ledger`'s `ledger_accounts`, a
  plain nullable column, same no-FK convention `external_customer_id`
  already uses). Not maker-checker-gated — opening a wallet account isn't
  money-moving or limit-changing, so this calls `backendExecutor`
  directly rather than going through `approvalService`'s request/approve
  flow. `teller`/`branch_manager` are forced to their own branch
  regardless of what's in the request body — the one real access-control
  point in an otherwise pure-tagging slice; `ops_admin` (tenant-wide, no
  default branch) can specify any real branch or none at all. This gives
  the branch tag an actual caller instead of shipping unused plumbing —
  `trustpay-backend`'s own self-service consumer wallet-open flow is
  untouched and still opens unbranched accounts exactly as before.
  Verified live: a teller's account opened with no `branchId` in the
  request landed tagged with their own branch (confirmed by querying the
  Ledger directly, not just trusting the echoed response); the same
  teller attempting to claim a *different* branch still got their own,
  proving the override is enforced, not just the default; an `ops_admin`
  with an explicit valid branch got it honored, a bogus branch got a
  clean `404`, and no branch at all opened a real, unbranched account;
  and a simulated direct call in `trustpay-backend`'s own shape (no
  `branchId` field) succeeded unchanged.
- **Loan origination, with a real credit decision and dual approval on
  disbursement** (Phase 3, slice 1) — `POST /v1/loans` lets a
  `loan_officer`/`credit_manager` originate a loan for a customer,
  branch-tagged the same way account-open already is. Before the Ledger
  ever creates the (`PENDING`) loan account, this route calls Compliance's
  new `loan-eligibility-check` — a real, versioned, tenant-configurable
  policy (`LoanEligibilityPolicy`: min KYC tier, max amount, max tenor, a
  fixed rate — deliberately simple for a first pass, not income-based
  underwriting or a live credit-bureau score, neither of which exist
  anywhere in this platform yet), and checks the Ledger's own loan list
  for the customer to enforce one active/pending loan at a time. Keeps
  the Ledger itself dumb — it never calls another service; the credit
  decision happens here, first, matching the platform's existing
  "Compliance is consulted before the Ledger writes" rule. Origination
  itself is **not** maker-checker (a deterministic, policy-based check,
  no staff discretion) — **disbursement is**: `LOAN_DISBURSEMENT`
  requires a *different* `credit_manager` to approve, matching the
  architecture doc's own "officer originates, credit manager approves"
  language, which is also why `loan_officer`/`credit_manager` are new
  roles here rather than overloading `branch_manager`/`compliance_officer`.
  `COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH` was added to maker-checker
  the same way the other three Compliance policy-publish actions were.
  Verified live: eligibility rejections for below-minimum KYC tier, over
  the amount cap, and an existing active loan all fired for real before
  any Ledger write happened; a `loan_officer` couldn't approve their own
  disbursement request (wrong role) and a `credit_manager` couldn't
  approve their own either (self-approval, independent of role); a
  different, uninvolved `credit_manager`'s approval moved real money —
  the loan balance and the customer's wallet balance both changed by the
  disbursed amount, confirmed against the Ledger directly; a rejected
  disbursement executed nothing; daily interest accrual posted a real
  entry at the exact expected rate (confirmed against both the loan and
  the tenant's `SYS-INTEREST-INCOME` account); and repayment — partial,
  then full — correctly reduced the balance and closed the loan at zero,
  with the Ledger's own insufficient-balance guard correctly blocking an
  over-repayment attempt against the wallet.
- **A real bug this caught**: `ListByExternalCustomerIDAndProduct` (used
  by this route's loan lookup, and by `ListSavingsAccounts`) never
  selected `branch_id` from the database — the column was written
  correctly at origination, but read back as `null` every time,
  regardless of what was actually stored. Found by comparing a loan's own
  origination response (which had the real branch) against what the
  customer's loan list returned moments later (`null`) — a live
  discrepancy, not something a unit test in isolation would have caught.
  Fixed there and in two structurally identical read functions
  (`GetByExternalCustomerID`, `ListByProductType`) that had the same gap
  but weren't yet exercised by anything checking `branchId` specifically.
- **Delinquency detection and loan-loss provisioning** (Phase 3, slice 2) —
  the two of slice 1's three named gaps that are pure platform mechanics,
  no external party involved. The Ledger computes `daysPastDue`/a bucket
  (`current`/`1-30`/`31-60`/`61-90`/`90+`) for every loan from data it
  already had (`MaturityDate`, set at disbursement) — no new tracking
  needed to detect lateness. A new periodic pass on the same accrual
  goroutine trues up a per-loan loan-loss reserve against a fixed
  expected-credit-loss matrix (new GL `1250`/`5200`, contra-asset/expense).
  Here in identity, a new `delinquencyRunner.js` (same `setInterval`
  background-job shape as `services/payments`' `reconciliationRunner.js`)
  polls the Ledger's new tenant-wide `GET /v1/loans` for every tenant this
  service holds both a Ledger and a Compliance credential for, and
  forwards any overdue loan's `daysPastDue`/`bucket` to a new Compliance
  route (`loan-delinquency-flag`) — mechanical, caller-fed, not
  maker-checker, same tier as `loan-eligibility-check`. What Compliance
  does with that fact **is** the already-shipped `COMPLIANCE_CASE_REVIEW`
  maker-checker flow, unmodified — a `loan_delinquency` case is reviewed,
  dismissed, or escalated exactly like a `transaction_monitoring` or
  `sanctions_hit` case, zero new approval plumbing. Verified live: a real
  provisioning journal entry posted at the correct bucket rate; a
  dismissed case correctly re-opened on the next tick because the
  underlying loan was still overdue (dismissing a case doesn't suppress
  re-flagging); and a full repayment stopped both interest accrual and
  provisioning for the now-`CLOSED` loan without touching the reserve
  already accumulated (release-on-repayment is a named limitation, not
  built in this slice).
- **A real bug this caught**: the first version of the provisioning pass
  keyed its idempotency off `{accountId}:{date}` — matching every other
  idempotency key in `internal/accrual` — but provisioning's target can
  legitimately change more than once on the same calendar day (a
  shorter-than-24h poll interval during this slice's own verification
  advanced the bucket twice in one day). The Ledger's existing
  dedup-by-key behavior silently returned the *first* entry under that
  key without erroring, while the code still advanced
  `meta.ProvisionedKobo` to the new target — permanently understating the
  real reserve on the books relative to what the metadata claimed. Fixed
  by keying idempotency off the target amount instead of the date (safe
  because this slice's reserve is monotonically non-decreasing by
  design), caught only by watching the actual posted entries during live
  verification, not by the idempotency key's own logic looking wrong on
  a read.
- **Not covered by Phase 3**: credit bureau reporting (CRC Credit Bureau,
  FirstCentral) — a real commercial/certification relationship with an
  external party this platform doesn't have yet, deliberately deferred to
  its own slice rather than folded in alongside the two mechanics above.
  No code exists for it anywhere in the platform yet.
- **No staff-facing web UI** — backend/API only, matching how the
  gateway's own build was API-first with its developer portal as a later,
  separate slice.
- **No password reset / change-password flow** — a staff member keeps
  whatever password `bootstrapStaffUser.js` generated (or whatever an
  `ops_admin`-only staff-management route sets, once one exists) until
  that's built.
- **No jest test suite yet** — this pass's verification was entirely live
  integration testing, not unit tests.

## Setup

```bash
createdb trustbank_identity
cp .env.example .env   # then edit it — IDENTITY_ENCRYPTION_KEY, session timeouts

npm install
npx prisma migrate deploy
npm run dev   # :8085, loopback only

# First tenant on a fresh deployment: use deploy/provision-tenant.sh
# --ops-admin-email <email>, which bootstraps this tenant's first staff
# user automatically. Manually:
node scripts/bootstrapStaffUser.js --tenant-id $TENANT_ID --email ops@bank.example --role ops_admin
```

## API

```bash
# 1. Login — always returns an MFA challenge, never a session directly.
curl -X POST localhost:8085/v1/login \
  -d '{"tenantId":"'$TENANT_ID'","email":"ops@bank.example","password":"<temp password>"}'
# -> { mfaChallengeToken, mfaEnrolled: false }

# 2. Not yet enrolled: start enrollment, get an otpauth:// URI (scan it
#    with any TOTP authenticator app — Google Authenticator, 1Password, etc).
curl -X POST localhost:8085/v1/mfa/enroll -d '{"mfaChallengeToken":"..."}'
# -> { otpauthUri }

# 3. Confirm with a real code from the app — this is what activates MFA
#    and issues the first real session.
curl -X POST localhost:8085/v1/mfa/enroll/confirm \
  -d '{"mfaChallengeToken":"...","code":"123456"}'
# -> { sessionToken, expiresAt } — shown once

# Already enrolled: step 1's response has mfaEnrolled: true, so skip
# straight to a code instead of enrolling:
curl -X POST localhost:8085/v1/login/mfa -d '{"mfaChallengeToken":"...","code":"123456"}'

# Everything below uses that session token.
curl localhost:8085/v1/me -H "Authorization: Bearer $SESSION_TOKEN"

curl -X POST localhost:8085/v1/branches -H "Authorization: Bearer $SESSION_TOKEN" \
  -d '{"code":"LAG-01","name":"Lagos Main Branch"}'   # ops_admin only

curl localhost:8085/v1/branches -H "Authorization: Bearer $SESSION_TOKEN"   # any role

# Staff-initiated account opening — teller: not maker-checker-gated, opened
# with the caller's own branch regardless of any branchId in the body.
curl -X POST localhost:8085/v1/accounts -H "Authorization: Bearer $TELLER_SESSION" \
  -d '{"externalCustomerId":"walk-in-customer-1","productType":"wallet"}'

# Loan origination — loan_officer: forced to their own branch; credit_manager:
# tenant-wide, may pass any real branchId or none. Deterministic, policy-based
# eligibility check against Compliance; NOT maker-checker (see routes/loans.js's
# own comment on why). 422 with code LOAN_NOT_ELIGIBLE if the policy rejects it.
curl -X POST localhost:8085/v1/loans -H "Authorization: Bearer $LOAN_OFFICER_SESSION" \
  -d '{"externalCustomerId":"cust-1","principalKobo":1000000,"tenorDays":30}'

# Maker-checker — actionType is 'COMPLIANCE_CASE_REVIEW' | 'LEDGER_ADJUSTMENT' |
# 'LEDGER_REVERSAL' | 'COMPLIANCE_KYC_POLICY_PUBLISH' | 'COMPLIANCE_DEVICE_POLICY_PUBLISH' |
# 'COMPLIANCE_MONITORING_POLICY_PUBLISH' | 'LOAN_DISBURSEMENT' |
# 'COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH'; payload is the exact request body the
# target endpoint expects. See approvalService.js's PERMISSIONS for which role can
# request/approve each.
curl -X POST localhost:8085/v1/approvals -H "Authorization: Bearer $MAKER_SESSION" \
  -d '{"actionType":"COMPLIANCE_CASE_REVIEW","payload":{"caseId":"...","status":"dismissed","reviewNotes":"..."}}'

# Loan disbursement request — a loan_officer or credit_manager requests it (maker),
# a *different* credit_manager approves (checker) via the same generic approve route
# above. Self-approval and wrong-role approval are both rejected.
curl -X POST localhost:8085/v1/approvals -H "Authorization: Bearer $LOAN_OFFICER_SESSION" \
  -d '{"actionType":"LOAN_DISBURSEMENT","payload":{"loanAccountId":"..."}}'

curl localhost:8085/v1/approvals?status=pending -H "Authorization: Bearer $SESSION_TOKEN"

# A *different* staff member, with a role in that actionType's approveRoles —
# self-approval is rejected (403) even if the role would otherwise allow it.
curl -X POST localhost:8085/v1/approvals/$APPROVAL_ID/approve -H "Authorization: Bearer $CHECKER_SESSION"
curl -X POST localhost:8085/v1/approvals/$APPROVAL_ID/reject -H "Authorization: Bearer $CHECKER_SESSION" \
  -d '{"reason":"..."}'

# If execution failed (e.g. the target backend was down), retry without a fresh approval:
curl -X POST localhost:8085/v1/approvals/$APPROVAL_ID/retry-execution -H "Authorization: Bearer $CHECKER_SESSION"
```

## Layout

```
prisma/                Branch (tenant org-unit), StaffUser (password + role + branch + MFA),
                       StaffSession (short-lived, sliding-expiry, shown-once/hashed),
                       TenantBackendCredential (this service's own Ledger/Compliance operate
                       credential per tenant), ApprovalRequest (maker-checker)
scripts/bootstrapStaffUser.js  creates the first staff user for a tenant — same
                                chicken-and-egg fix as every other service's bootstrap script
scripts/storeTenantBackendCredential.js  stores this tenant's Ledger/Compliance credential —
                                          a script, not an HTTP route, since this service's
                                          entire HTTP surface is staff-session-gated
src/crypto/mfaSecrets.js        AES-256-GCM, same pattern as services/payments' tenantSecrets.js —
                                 also encrypts TenantBackendCredential, one key per service, not
                                 duplicated per secret type
src/services/
  staffUserService.js            password verify (argon2id), MFA enroll/verify (otplib) —
                                  mfaSecrets required lazily so scripts/bootstrapStaffUser.js
                                  (which never touches MFA) doesn't need IDENTITY_ENCRYPTION_KEY
  staffSessionService.js         shown-once/hashed session issuance, sliding idle-timeout verify
  branchService.js                create/list a tenant's branches
  mfaChallengeService.js          stateless, signed short-lived token bridging password ->
                                   MFA-code verification — deliberately not a DB row
  tenantBackendCredentialService.js  store/get this service's own Ledger/Compliance credential —
                                      mirrors the gateway's identically-named service exactly
  approvalService.js              request/approve/reject/retryExecution, the per-actionType
                                   requestRoles/approveRoles map, self-approval check — gained
                                   LOAN_DISBURSEMENT and COMPLIANCE_LOAN_ELIGIBILITY_POLICY_PUBLISH
                                   in Phase 3 slice 1
  backendExecutor.js              executes a real Ledger/Compliance call — mirrors the gateway's
                                   backendProxy.js calling-convention handling, no circuit
                                   breaker (low-volume, human-triggered, not a proxy absorbing
                                   arbitrary API load). Called both by approvalService.js (after
                                   approval) and directly by routes/accounts.js and routes/loans.js
                                   (account-open and loan origination aren't maker-checker actions),
                                   and by delinquencyRunner.js (LOAN_LIST_ACTIVE/
                                   LOAN_DELINQUENCY_FLAG, added Phase 3 slice 2)
  delinquencyRunner.js            process-internal periodic job (setInterval, same shape as
                                   services/payments' reconciliationRunner.js) — Phase 3 slice 2.
                                   For every tenant this service holds both a Ledger and a
                                   Compliance credential for, lists overdue ACTIVE loans and
                                   forwards daysPastDue/bucket to Compliance's case-tracking
src/middleware/requireStaffSession.js  mirrors requireApiKey's shape, adds an optional role gate
src/routes/
  auth.js    /v1/login, /v1/login/mfa, /v1/mfa/enroll, /v1/mfa/enroll/confirm
  me.js      /v1/me — the one demonstrable endpoint beyond auth plumbing
  branches.js /v1/branches — create (ops_admin) / list (any role)
  accounts.js /v1/accounts — staff-initiated open (teller/branch_manager/ops_admin), tags the
              real Ledger account with a branch_id; not maker-checker-gated
  approvals.js /v1/approvals — request/list/get/approve/reject/retry-execution, all
               staff-session-gated; role checks live in approvalService.js, not here
               (which role is allowed depends on actionType, not the route)
  loans.js    /v1/loans — staff-initiated origination (loan_officer/credit_manager);
              checks existing-loan + Compliance eligibility before the Ledger ever
              writes a PENDING loan account; not maker-checker (disbursement is,
              via the generic /v1/approvals routes above, not a route here)
```
