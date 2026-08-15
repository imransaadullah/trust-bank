# Deploying trust-bank

Before this existed, every environment in this repo's history — dozens of times, across every
service — was stood up by hand: ~20 manual commands (build, migrate, bootstrap a platform-admin
credential, create a tenant, bootstrap+issue admin/operate credentials on three separate
services, publish compliance policy, wire env vars, copy shown-once tokens before they scroll off
the terminal). `install.sh` and `provision-tenant.sh` replace that.

## What's here

```
install.sh              # fresh Ubuntu box -> all four services built, migrated, running
provision-tenant.sh     # onboard a tenant onto an already-installed box
lib/common.sh            # shared bash helpers, sourced by both scripts
templates/               # systemd unit templates, rendered by install.sh — not checked-in static units
Caddyfile.example        # reverse proxy config for the SaaS/single-VPS topology (see ../NETWORK_TOPOLOGY.md)
```

Two separate scripts on purpose: `install.sh` sets up the *platform* (the shared Ledger/Payments/
Compliance instances plus TrustPay's own product backend) once per box; `provision-tenant.sh`
onboards a *tenant* onto that platform, and gets run again for every new tenant afterward (or
rerun for the same tenant to regenerate a product backend's credential snippet without
re-minting anything).

## Fresh VPS to onboarded tenant

```bash
git clone https://github.com/imransaadullah/trust-bank.git
cd trust-bank/deploy
./install.sh

./provision-tenant.sh --slug trustpay --name "TrustPay" --license-type OTHER \
  --product-backend-env /home/ubuntu/trust-bank/services/trustpay-backend/.env \
  --payments-env /home/ubuntu/trust-bank/services/payments/.env
sudo systemctl restart trustbank-payments

# trustpay-backend still needs real AuthCore credentials before it stays up —
# edit services/trustpay-backend/.env: AUTHCORE_PROJECT_KEY, AUTHCORE_JWKS_URL, AUTHCORE_PROJECT_ID
sudo systemctl restart trustpay-backend
```

A second bank tenant on the same box, once it has its own product backend deployed alongside
`trustpay-backend`:

```bash
./provision-tenant.sh --slug some-bank --name "Some Bank" --license-type NATIONAL_MFB \
  --product-backend-env /home/ubuntu/trust-bank/services/some-bank-backend/.env
```

## What each script actually does

**`install.sh`** (idempotent — rerun to redeploy after a `git pull`):
1. Installs Postgres, Go, Node (via nvm), Caddy if missing.
2. Clones (or pulls) the repo to `/home/ubuntu/trust-bank`.
3. Per service: creates its Postgres DB, installs dependencies, runs migrations, generates
   `.env` from `.env.example` **only if `.env` doesn't already exist** — auto-filling secrets
   the example leaves blank (`TRUSTPAY_JWT_SECRET`, `PAYMENTS_ENCRYPTION_KEY`, the Ledger's
   `ledger_app` DB role password, and a Postgres superuser password used for the TCP
   connections `make migrate`/Prisma need) via `openssl rand -hex 32`. Never regenerates a
   secret on a rerun — that would break already-encrypted provider credentials or already-issued
   JWTs.
4. Renders each systemd unit from `templates/*.service.tmpl` (substituting the real Node binary
   path, the actual clone location, the deploy user) and installs/starts them.
5. Points Caddy at `trustpay-backend` (port 8082) if a site block isn't already configured.

**`provision-tenant.sh`** (idempotent per `--slug` — state is cached under
`~/.trustbank/tenants/<slug>/`):
1. Bootstraps a Ledger `platform-admin` credential — once per *deployment*, not per tenant;
   cached at `~/.trustbank/platform_admin.token` and reused for every later tenant.
2. Creates the tenant on the Ledger (`POST /v1/tenants`).
3. Bootstraps `admin` + `operate` credentials on Ledger, Payments, and Compliance for this
   tenant, via each service's own bootstrap tool (`cmd/bootstrap-key`, `scripts/bootstrapKey.js`)
   — the same tools `SERVICE_CREDENTIAL_MODEL.md` documents running by hand. This includes a
   *second*, separate Ledger operate credential specifically for Payments' own settlement calls
   (`services/payments/src/services/ledgerClient.js` — required for Payments to even boot), not
   just the product backend's. **Known limitation:** Payments holds this as a single global
   `LEDGER_API_KEY` in its own `.env`, so it's only correct for one tenant at a time — running
   `--payments-env` again for a second tenant would overwrite the first tenant's credential and
   break its settlement calls. That's a gap in Payments' credential model, not something this
   script papers over; omit `--payments-env` for any tenant after the first until it's addressed.
4. Publishes a default KYC-tier-0/tier-1 + device-binding compliance policy, using the same
   numbers already documented in `services/compliance/README.md`'s examples (CBN Tier-1: NGN
   30,000/day).
5. Writes `TENANT_ID`/`LEDGER_API_KEY`/`PAYMENTS_API_KEY`/`COMPLIANCE_API_KEY` straight into the
   target product backend's `.env` (or prints them if `--product-backend-env` is omitted) — this
   is the step that actually removes risk from the old process: today the only way these
   shown-once tokens get captured is a human copy-pasting from a terminal wall of text across
   three separate services; the script captures each one programmatically instead.

A Paystack/self-issued-NUBAN provider config for the tenant on Payments isn't part of either
script — that's real vendor credentials (a Paystack secret key, or eventually a licensed bank's
own NUBAN/NIBSS setup) with no sensible default to generate. See `services/payments/README.md`
for `POST /v1/tenants/:id/config`.

## What's verified, and what isn't

**Live-verified** against a real throwaway Postgres stack, the same way every other pass in this
repo's history has been: the entire app-layer sequence in both scripts — build, migrate,
credential bootstrap (platform-admin → tenant → admin → operate, on all three services, including
the separate Ledger credential for Payments), tenant creation, policy publish, env-snippet
generation — and that a rerun of either script is safe (no secret regenerated, no already-applied
migration re-run, no duplicate credential minted). Then closed the loop: booted Ledger, Payments,
Compliance, and trustpay-backend using nothing but the scripts' own output and ran the full
signup → wallet-open → device-binding → JWT-mint sequence through it.

That last step surfaced two real bugs, both the same falsy-zero mistake (`if (!tier)` treating
`tier: 0` — a real, documented Tier-0/unverified user — as missing) in two different places:
`services/compliance/src/routes/policies.js` (publishing a Tier-0 policy) and
`src/routes/decisions.js` (evaluating one). The first was found and fixed before this pass even
started; the second was only caught by actually calling the decision endpoint for a Tier-0 user
after publishing its policy, not by reading the code — exactly the case for closing the loop
instead of stopping at "the scripts ran without error."

**Not verified, and said so plainly rather than claimed otherwise:** the `apt-get`
system-dependency installation and the actual `systemctl`/Caddy steps in `install.sh`. This repo
was built on a macOS dev machine with no systemd and no Docker available — there is no way to
execute those specific code paths in this environment. They're correct as written against each
tool's own documented usage (Go's official tarball install, nvm's standard installer, Caddy's
official apt repo), and the systemd *templating* itself is verified (rendered output checked
against the corrected, generically-named units). Treat the first real run on an actual VPS as the
actual test of the system-dependency and systemd-install steps specifically.
