# Service credential model

How Ledger, Payments, and Compliance authenticate their callers — replacing the single
static `*_SHARED_SECRET` every service launched with.

**Not the same thing as `AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md`.** That file lives in the
sibling `truechat` repo and is a proposal for AuthCore's own credential model (a
publishable, client-embeddable key vs. a server-only secret key, for AuthCore's phone-OTP
SDK). This repo's docs reference it as prior art — "API keys for the BaaS layer follow the
tiered-credential pattern you already designed for AuthCore" — but that's a claim about
*shape*, not a shared document. Every caller in trust-bank today is a backend calling
another backend; there's no client-embeddable use case yet, so this spec doesn't have a
publishable tier. That's real future BaaS-partner scope (a bank tenant's own app calling
trust-bank directly), not built speculatively here.

## The two tiers that matter today

| Scope | Who holds it | What it can do |
|---|---|---|
| `admin` | A human, or a deploy/bootstrap script — never a long-running service | Publish policy, configure provider credentials, issue/revoke/list credentials for its own tenant |
| `operate` | A running service (trustpay-backend, Payments' own Ledger caller) | Everything a service actually calls at runtime — accounts, transfers, savings, decisions, screening |

The Ledger has one more, used exactly once per tenant onboarding:

| Scope | Who holds it | What it can do |
|---|---|---|
| `platform-admin` | A human running the onboarding step, never embedded anywhere | `POST /v1/tenants` only — the one operation that doesn't have a tenant yet |

Every credential except `platform-admin` is bound to exactly one tenant — there is no "god
credential" that spans tenants, matching `CORE_BANKING_PLATFORM_ARCHITECTURE.md`'s identity
section. An `admin` credential can only issue new credentials for its *own* tenant.

## The bug this closes

Before this, `X-Tenant-Id` (Ledger) or `:tenantId` in the URL (Payments, Compliance) was
trusted completely independently of the one shared secret — any caller holding that secret
could act as *any* tenant just by changing the header/param. Row-level security is the
documented second line of defense against exactly this, but it only works if
`app.tenant_id` is set correctly in the first place; nothing verified that before. Now the
credential itself is the source of truth: a request whose claimed tenant doesn't match the
credential's own tenant is rejected with 403, regardless of what the header/param says.

## Token shape

One opaque bearer string per credential, prefixed per service so a leaked token is
identifiable at a glance (Stripe/GitHub's convention): `lgr_live_...` (Ledger),
`pay_live_...` (Payments), `cmp_live_...` (Compliance). Only the SHA-256 hash is ever
stored — high-entropy random tokens don't need slow/salted password hashing, same
reasoning Stripe/GitHub use. The plaintext token is shown exactly once, at issue time; it
cannot be retrieved again.

## Bootstrapping a new deployment

Issuing a credential normally requires an `admin` credential — so the very first one can't
come from the API. Each service has a bootstrap script that writes directly to the
database instead:

```bash
# Ledger (Go) — owner/superuser connection, like migrations
cd services/ledger
export MIGRATE_DATABASE_URL=postgres://postgres@localhost:5432/trust_bank_ledger
go run ./cmd/bootstrap-key --scope platform-admin --label ops-bootstrap
# -> use that token to POST /v1/tenants, then:
go run ./cmd/bootstrap-key --scope admin --tenant-id $TENANT_ID --label ops-bootstrap

# Payments / Compliance (Node) — same DATABASE_URL the service itself uses
cd services/payments   # or services/compliance
node scripts/bootstrapKey.js --tenant-id $TENANT_ID --scope admin --label ops-bootstrap
```

From there, use the `admin` credential to issue `operate` credentials for the services
that actually need to call in — trustpay-backend needs one from each of Ledger, Payments,
and Compliance; Payments needs one from the Ledger for its own settlement calls:

```bash
curl -X POST $BASE_URL/v1/credentials \  # Ledger — no :tenantId in the path, header-based
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -d '{"label":"trustpay-backend","scope":"operate"}'

curl -X POST $BASE_URL/v1/tenants/$TENANT_ID/credentials \  # Payments, Compliance
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"label":"trustpay-backend","scope":"operate"}'
```

Store the returned `token` in the calling service's `.env` (`LEDGER_API_KEY`,
`PAYMENTS_API_KEY`, `COMPLIANCE_API_KEY`) — it's shown once, in the response, and nowhere
else.

## What this doesn't solve

Network position (loopback binding, `deploy/NETWORK_TOPOLOGY.md`) and credential scoping
are both defense-in-depth layers, not a complete story on their own. mTLS for a hybrid
deployment — where a caller genuinely lives on a different, untrusted network — is built
and opt-in (`MTLS_ENABLED`); see `NETWORK_TOPOLOGY.md`'s mTLS section for how to turn it
on. What's still open is automated certificate rotation and revocation checking
(CRL/OCSP) — ongoing PKI operational burden not worth automating before there's live
hybrid volume to justify it; rotate manually by regenerating a service's leaf cert.
