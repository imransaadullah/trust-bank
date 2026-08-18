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

**Explicit placeholders — this is slice 1 of a 3-slice phase:**
- **No maker-checker** (slice 2) — this slice ships *who someone is*, not
  *dual approval for what they can do*. Nothing in Ledger/Payments/
  Compliance is gated by an approval workflow yet; see
  `CORE_BANKING_PLATFORM_ARCHITECTURE.md` §13's Phase 2.5 for the concrete
  actions already identified to gate (Compliance's policy-publish routes
  and its `POST .../cases/:caseId/review`, which today accepts a
  free-text `reviewedBy` not tied to any real identity — the sharpest
  existing example of the gap this phase exists to close).
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
```

## Layout

```
prisma/                Branch (tenant org-unit), StaffUser (password + role + branch + MFA),
                       StaffSession (short-lived, sliding-expiry, shown-once/hashed)
scripts/bootstrapStaffUser.js  creates the first staff user for a tenant — same
                                chicken-and-egg fix as every other service's bootstrap script
src/crypto/mfaSecrets.js        AES-256-GCM, same pattern as services/payments' tenantSecrets.js
src/services/
  staffUserService.js            password verify (argon2id), MFA enroll/verify (otplib) —
                                  mfaSecrets required lazily so scripts/bootstrapStaffUser.js
                                  (which never touches MFA) doesn't need IDENTITY_ENCRYPTION_KEY
  staffSessionService.js         shown-once/hashed session issuance, sliding idle-timeout verify
  branchService.js                create/list a tenant's branches
  mfaChallengeService.js          stateless, signed short-lived token bridging password ->
                                   MFA-code verification — deliberately not a DB row
src/middleware/requireStaffSession.js  mirrors requireApiKey's shape, adds an optional role gate
src/routes/
  auth.js    /v1/login, /v1/login/mfa, /v1/mfa/enroll, /v1/mfa/enroll/confirm
  me.js      /v1/me — the one demonstrable endpoint beyond auth plumbing
  branches.js /v1/branches — create (ops_admin) / list (any role)
```
