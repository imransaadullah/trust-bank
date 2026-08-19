# Identity

Staff login, MFA, sessions, RBAC, and branch/org-unit modeling — the first
*human* identity in trust-bank. Phase 2.5, slice 1
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
- **No `branch_id` on Ledger's own accounts** (slice 3) — `Branch` exists
  and staff can be assigned to one, but account-open/transaction flows
  don't thread it through to the Ledger yet.
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

# Maker-checker — actionType is 'COMPLIANCE_CASE_REVIEW' | 'LEDGER_ADJUSTMENT' |
# 'LEDGER_REVERSAL' | 'COMPLIANCE_KYC_POLICY_PUBLISH' | 'COMPLIANCE_DEVICE_POLICY_PUBLISH' |
# 'COMPLIANCE_MONITORING_POLICY_PUBLISH'; payload is the exact request body the target
# endpoint expects. See approvalService.js's PERMISSIONS for which role can request/approve each.
curl -X POST localhost:8085/v1/approvals -H "Authorization: Bearer $MAKER_SESSION" \
  -d '{"actionType":"COMPLIANCE_CASE_REVIEW","payload":{"caseId":"...","status":"dismissed","reviewNotes":"..."}}'

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
                                   requestRoles/approveRoles map, self-approval check
  backendExecutor.js              executes an approved action against the real Ledger/Compliance
                                   endpoint — mirrors the gateway's backendProxy.js calling-
                                   convention handling, no circuit breaker (low-volume, human-
                                   triggered, not a proxy absorbing arbitrary API load)
src/middleware/requireStaffSession.js  mirrors requireApiKey's shape, adds an optional role gate
src/routes/
  auth.js    /v1/login, /v1/login/mfa, /v1/mfa/enroll, /v1/mfa/enroll/confirm
  me.js      /v1/me — the one demonstrable endpoint beyond auth plumbing
  branches.js /v1/branches — create (ops_admin) / list (any role)
  approvals.js /v1/approvals — request/list/get/approve/reject/retry-execution, all
               staff-session-gated; role checks live in approvalService.js, not here
               (which role is allowed depends on actionType, not the route)
```
