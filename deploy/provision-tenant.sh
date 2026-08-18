#!/usr/bin/env bash
# Onboard one tenant onto an already-installed platform (run install.sh
# first). Replaces the exact manual sequence documented in
# SERVICE_CREDENTIAL_MODEL.md: bootstrap a Ledger platform-admin credential
# (once, ever — the very first tenant on this deployment), create the
# tenant, bootstrap admin + operate credentials on each of Ledger/Payments/
# Compliance, publish a default compliance policy, and hand the resulting
# operate credentials to a product backend's .env.
#
# Deliberately uses each service's own bootstrap-key tool for *both* admin
# and operate credentials rather than the admin-token REST API
# (SERVICE_CREDENTIAL_MODEL.md documents both paths) — this is the exact
# sequence already live-verified by hand in this repo's history; the REST
# credentials-issuance endpoint isn't exercised by this script so it isn't
# claimed as verified here.
#
# Idempotent per --slug: state (tenant id + every issued token) is cached
# under $SECRETS_DIR/tenants/<slug>/ and reused on a rerun instead of
# re-bootstrapping — safe to run again to regenerate a product backend's
# env snippet without minting new credentials.
#
# Also provisions a synthetic sandbox twin for the tenant (see
# provision_sandbox_twin below) — a second, isolated tenant in Ledger/
# Payments/Compliance that the gateway's sandbox-tier keys resolve to
# instead of the real tenant's own data (services/gateway's
# SandboxTenant model, src/middleware/resolveEffectiveTenant.js).
#
# Usage:
#   ./provision-tenant.sh --slug trustpay --name "TrustPay" \
#     --license-type OTHER --base-currency NGN \
#     --product-backend-env /home/ubuntu/trust-bank/services/trustpay-backend/.env
#
# Payments' own Ledger credential (services/payments/src/services/
# ledgerClient.js) is now stored per-tenant via Payments' own
# POST /v1/tenants/:id/ledger-credential (store_payments_ledger_credential
# below), not written into Payments' .env — a single shared .env value
# could only ever work for one tenant, since the Ledger cross-checks
# X-Tenant-Id against the credential's own bound tenant. This is what
# makes provisioning a second tenant (the sandbox twin, or any real
# second tenant) safe on the same box.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

APP_ROOT="${APP_ROOT:-/home/ubuntu/trust-bank}"
SECRETS_DIR="${SECRETS_DIR:-$HOME/.trustbank}"
PG_SUPERUSER_PW_FILE="$SECRETS_DIR/postgres_superuser_password"
PLATFORM_ADMIN_TOKEN_FILE="$SECRETS_DIR/platform_admin.token"

LEDGER_URL="${LEDGER_SERVICE_URL:-http://127.0.0.1:8080}"
PAYMENTS_URL="${PAYMENTS_SERVICE_URL:-http://127.0.0.1:8081}"
COMPLIANCE_URL="${COMPLIANCE_SERVICE_URL:-http://127.0.0.1:8083}"
GATEWAY_URL="${GATEWAY_SERVICE_URL:-http://127.0.0.1:8084}"

SLUG="" NAME="" LICENSE_TYPE="OTHER" BASE_CURRENCY="NGN" PRODUCT_BACKEND_ENV="" OPS_ADMIN_EMAIL=""

usage() {
  cat <<EOF
Usage: $0 --slug SLUG --name NAME [options]
  --license-type TYPE       UNIT_MFB | STATE_MFB | NATIONAL_MFB | PSB | BAAS_RESELLER | OTHER (default: OTHER)
  --base-currency CUR       default: NGN
  --product-backend-env P   .env file to append TENANT_ID/*_API_KEY to (printed instead if omitted)
  --ops-admin-email EMAIL   bootstraps this tenant's first staff user (services/identity,
                            role=ops_admin) — skipped, with instructions printed instead, if omitted
EOF
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --license-type) LICENSE_TYPE="$2"; shift 2 ;;
    --base-currency) BASE_CURRENCY="$2"; shift 2 ;;
    --product-backend-env) PRODUCT_BACKEND_ENV="$2"; shift 2 ;;
    --ops-admin-email) OPS_ADMIN_EMAIL="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done
[ -n "$SLUG" ] && [ -n "$NAME" ] || usage

require_cmd jq "install it (apt-get install -y jq) — used to parse API responses"
require_cmd curl "should already be present"
require_cmd go "run install.sh first, or open a new shell if it just installed Go"
require_cmd node "run install.sh first, or open a new shell if it just installed Node via nvm"
[ -f "$PG_SUPERUSER_PW_FILE" ] || die "$PG_SUPERUSER_PW_FILE not found — run install.sh first"

TENANT_DIR="$SECRETS_DIR/tenants/$SLUG"
mkdir -p "$TENANT_DIR" && chmod 700 "$TENANT_DIR"

# ---------------------------------------------------------------------------
# 1. Ledger platform-admin — bootstrapped exactly once per deployment, not
#    per tenant. Every later tenant onboarded on this box reuses it.
# ---------------------------------------------------------------------------
bootstrap_platform_admin() {
  [ -f "$PLATFORM_ADMIN_TOKEN_FILE" ] && return
  log "Bootstrapping Ledger platform-admin credential (first tenant on this deployment)"
  local out token
  out="$(cd "$APP_ROOT/services/ledger" && MIGRATE_DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trust_bank_ledger?sslmode=disable" \
    go run ./cmd/bootstrap-key --scope platform-admin --label "provision-tenant-bootstrap")"
  token="$(extract_token "$out" lgr_live)"
  [ -n "$token" ] || die "could not parse a platform-admin token out of bootstrap-key's output"
  printf '%s' "$token" > "$PLATFORM_ADMIN_TOKEN_FILE"
  chmod 600 "$PLATFORM_ADMIN_TOKEN_FILE"
}

# ---------------------------------------------------------------------------
# 2. Create the tenant on the Ledger
# ---------------------------------------------------------------------------
create_tenant() {
  [ -f "$TENANT_DIR/tenant_id" ] && { TENANT_ID="$(cat "$TENANT_DIR/tenant_id")"; return; }
  log "Creating tenant '$SLUG' on the Ledger"
  local admin_token resp
  admin_token="$(cat "$PLATFORM_ADMIN_TOKEN_FILE")"
  resp="$(curl -sf -X POST "$LEDGER_URL/v1/tenants" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d "$(jq -n --arg slug "$SLUG" --arg name "$NAME" --arg lt "$LICENSE_TYPE" --arg cur "$BASE_CURRENCY" \
      '{slug:$slug,name:$name,licenseType:$lt,baseCurrency:$cur}')")" \
    || die "POST /v1/tenants failed"
  TENANT_ID="$(jq -r '.tenant.id' <<<"$resp")"
  [ -n "$TENANT_ID" ] && [ "$TENANT_ID" != "null" ] || die "tenant creation response had no tenant.id: $resp"
  printf '%s' "$TENANT_ID" > "$TENANT_DIR/tenant_id"
}

# ---------------------------------------------------------------------------
# 3. Ledger admin + operate credentials for this tenant
# ---------------------------------------------------------------------------
bootstrap_ledger_credentials() {
  local migrate_url="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trust_bank_ledger?sslmode=disable"

  if [ ! -f "$TENANT_DIR/ledger_admin.token" ]; then
    log "Bootstrapping Ledger admin credential for $SLUG"
    local out token
    out="$(cd "$APP_ROOT/services/ledger" && MIGRATE_DATABASE_URL="$migrate_url" \
      go run ./cmd/bootstrap-key --scope admin --tenant-id "$TENANT_ID" --label "$SLUG-admin")"
    token="$(extract_token "$out" lgr_live)"
    [ -n "$token" ] || die "could not parse Ledger admin token"
    printf '%s' "$token" > "$TENANT_DIR/ledger_admin.token"; chmod 600 "$TENANT_DIR/ledger_admin.token"
  fi

  if [ ! -f "$TENANT_DIR/ledger_operate.token" ]; then
    log "Bootstrapping Ledger operate credential for $SLUG's product backend"
    local out token
    out="$(cd "$APP_ROOT/services/ledger" && MIGRATE_DATABASE_URL="$migrate_url" \
      go run ./cmd/bootstrap-key --scope operate --tenant-id "$TENANT_ID" --label "$SLUG-product-backend")"
    token="$(extract_token "$out" lgr_live)"
    [ -n "$token" ] || die "could not parse Ledger operate token"
    printf '%s' "$token" > "$TENANT_DIR/ledger_operate.token"; chmod 600 "$TENANT_DIR/ledger_operate.token"
  fi

  # A second, distinct Ledger operate credential for Payments' own
  # settlement calls (services/payments/src/services/ledgerClient.js) —
  # SERVICE_CREDENTIAL_MODEL.md: "Payments needs one from the Ledger for
  # its own settlement calls", separate from the product backend's.
  if [ ! -f "$TENANT_DIR/ledger_operate_payments.token" ]; then
    log "Bootstrapping Ledger operate credential for $SLUG's Payments settlement calls"
    local out2 token2
    out2="$(cd "$APP_ROOT/services/ledger" && MIGRATE_DATABASE_URL="$migrate_url" \
      go run ./cmd/bootstrap-key --scope operate --tenant-id "$TENANT_ID" --label "$SLUG-payments")"
    token2="$(extract_token "$out2" lgr_live)"
    [ -n "$token2" ] || die "could not parse Ledger operate token for Payments"
    printf '%s' "$token2" > "$TENANT_DIR/ledger_operate_payments.token"; chmod 600 "$TENANT_DIR/ledger_operate_payments.token"
  fi
}

# ---------------------------------------------------------------------------
# 4. Payments / Compliance admin + operate credentials — shared shape
# ---------------------------------------------------------------------------
bootstrap_node_service_credentials() {
  local name="$1" prefix="$2" dbname="$3"
  local dir="$APP_ROOT/services/$name"
  local db_url="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/${dbname}?schema=public"

  if [ ! -f "$TENANT_DIR/${name}_admin.token" ]; then
    log "Bootstrapping $name admin credential for $SLUG"
    local out token
    out="$(cd "$dir" && DATABASE_URL="$db_url" \
      node scripts/bootstrapKey.js --tenant-id "$TENANT_ID" --scope admin --label "$SLUG-admin")"
    token="$(extract_token "$out" "$prefix")"
    [ -n "$token" ] || die "could not parse $name admin token"
    printf '%s' "$token" > "$TENANT_DIR/${name}_admin.token"; chmod 600 "$TENANT_DIR/${name}_admin.token"
  fi

  if [ ! -f "$TENANT_DIR/${name}_operate.token" ]; then
    log "Bootstrapping $name operate credential for $SLUG's product backend"
    local out token
    out="$(cd "$dir" && DATABASE_URL="$db_url" \
      node scripts/bootstrapKey.js --tenant-id "$TENANT_ID" --scope operate --label "$SLUG-product-backend")"
    token="$(extract_token "$out" "$prefix")"
    [ -n "$token" ] || die "could not parse $name operate token"
    printf '%s' "$token" > "$TENANT_DIR/${name}_operate.token"; chmod 600 "$TENANT_DIR/${name}_operate.token"
  fi
}

# ---------------------------------------------------------------------------
# 5. The gateway (services/gateway) — the public API for external bank/
#    developer integration, distinct from the product backend. It's
#    multi-tenant (one process, many bank tenants), so unlike the product
#    backend it needs its own Ledger/Payments/Compliance operate
#    credential *per tenant*, stored in its own database rather than a
#    single .env — see TenantBackendCredential's schema comment.
# ---------------------------------------------------------------------------
bootstrap_gateway_credentials() {
  local migrate_url="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trust_bank_ledger?sslmode=disable"

  if [ ! -f "$TENANT_DIR/ledger_operate_gateway.token" ]; then
    log "Bootstrapping Ledger operate credential for $SLUG's gateway"
    local out token
    out="$(cd "$APP_ROOT/services/ledger" && MIGRATE_DATABASE_URL="$migrate_url" \
      go run ./cmd/bootstrap-key --scope operate --tenant-id "$TENANT_ID" --label "$SLUG-gateway")"
    token="$(extract_token "$out" lgr_live)"
    [ -n "$token" ] || die "could not parse Ledger operate token for gateway"
    printf '%s' "$token" > "$TENANT_DIR/ledger_operate_gateway.token"; chmod 600 "$TENANT_DIR/ledger_operate_gateway.token"
  fi

  if [ ! -f "$TENANT_DIR/payments_operate_gateway.token" ]; then
    log "Bootstrapping Payments operate credential for $SLUG's gateway"
    local out token
    out="$(cd "$APP_ROOT/services/payments" && DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_payments?schema=public" \
      node scripts/bootstrapKey.js --tenant-id "$TENANT_ID" --scope operate --label "$SLUG-gateway")"
    token="$(extract_token "$out" pay_live)"
    [ -n "$token" ] || die "could not parse Payments operate token for gateway"
    printf '%s' "$token" > "$TENANT_DIR/payments_operate_gateway.token"; chmod 600 "$TENANT_DIR/payments_operate_gateway.token"
  fi

  if [ ! -f "$TENANT_DIR/compliance_operate_gateway.token" ]; then
    log "Bootstrapping Compliance operate credential for $SLUG's gateway"
    local out token
    out="$(cd "$APP_ROOT/services/compliance" && DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_compliance?schema=public" \
      node scripts/bootstrapKey.js --tenant-id "$TENANT_ID" --scope operate --label "$SLUG-gateway")"
    token="$(extract_token "$out" cmp_live)"
    [ -n "$token" ] || die "could not parse Compliance operate token for gateway"
    printf '%s' "$token" > "$TENANT_DIR/compliance_operate_gateway.token"; chmod 600 "$TENANT_DIR/compliance_operate_gateway.token"
  fi

  # The gateway's own admin-tier key for this tenant — bootstrapped
  # directly, same chicken-and-egg fix as every other service's first
  # credential. Used below to store the three tokens above, and to issue
  # a starter sandbox key; cached for any later rerun.
  if [ ! -f "$TENANT_DIR/gateway_admin.token" ]; then
    log "Bootstrapping gateway admin key for $SLUG"
    local out token
    out="$(cd "$APP_ROOT/services/gateway" && DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_gateway?schema=public" \
      node scripts/bootstrapKey.js --tenant-id "$TENANT_ID" --label "$SLUG-admin")"
    token="$(extract_token "$out" gw_live)"
    [ -n "$token" ] || die "could not parse gateway admin token"
    printf '%s' "$token" > "$TENANT_DIR/gateway_admin.token"; chmod 600 "$TENANT_DIR/gateway_admin.token"
  fi
}

store_gateway_backend_credentials() {
  [ -f "$TENANT_DIR/gateway_backend_credentials_stored" ] && return
  log "Storing $SLUG's Ledger/Payments/Compliance credentials in the gateway"
  local admin_token; admin_token="$(cat "$TENANT_DIR/gateway_admin.token")"

  curl -sf -X POST "$GATEWAY_URL/v1/tenants/$TENANT_ID/backend-credentials" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$(cat "$TENANT_DIR/ledger_operate_gateway.token")" '{service:"ledger",token:$t}')" >/dev/null \
    || die "storing the gateway's Ledger credential failed"

  curl -sf -X POST "$GATEWAY_URL/v1/tenants/$TENANT_ID/backend-credentials" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$(cat "$TENANT_DIR/payments_operate_gateway.token")" '{service:"payments",token:$t}')" >/dev/null \
    || die "storing the gateway's Payments credential failed"

  curl -sf -X POST "$GATEWAY_URL/v1/tenants/$TENANT_ID/backend-credentials" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$(cat "$TENANT_DIR/compliance_operate_gateway.token")" '{service:"compliance",token:$t}')" >/dev/null \
    || die "storing the gateway's Compliance credential failed"

  touch "$TENANT_DIR/gateway_backend_credentials_stored"
}

# ---------------------------------------------------------------------------
# Payments' own Ledger credential — per-tenant, not a shared .env value
# (see the note at the top of this file). Needs ledger_operate_payments.token
# (bootstrap_ledger_credentials) and payments_admin.token
# (bootstrap_node_service_credentials payments) to already exist.
# ---------------------------------------------------------------------------
store_payments_ledger_credential() {
  [ -f "$TENANT_DIR/payments_ledger_credential_stored" ] && return
  log "Storing $SLUG's Ledger credential in Payments (per-tenant, not .env)"
  local admin_token; admin_token="$(cat "$TENANT_DIR/payments_admin.token")"
  curl -sf -X POST "$PAYMENTS_URL/v1/tenants/$TENANT_ID/ledger-credential" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$(cat "$TENANT_DIR/ledger_operate_payments.token")" '{token:$t}')" >/dev/null \
    || die "storing Payments' Ledger credential failed"
  touch "$TENANT_DIR/payments_ledger_credential_stored"
}

issue_starter_sandbox_key() {
  [ -f "$TENANT_DIR/gateway_sandbox.token" ] && return
  log "Issuing a starter sandbox-tier API key for $SLUG"
  local admin_token resp token
  admin_token="$(cat "$TENANT_DIR/gateway_admin.token")"
  resp="$(curl -sf -X POST "$GATEWAY_URL/v1/tenants/$TENANT_ID/api-keys" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d '{"label":"starter-sandbox","tier":"sandbox"}')" \
    || die "issuing the starter sandbox API key failed"
  token="$(jq -r '.data.token' <<<"$resp")"
  [ -n "$token" ] && [ "$token" != "null" ] || die "starter sandbox key response had no token: $resp"
  printf '%s' "$token" > "$TENANT_DIR/gateway_sandbox.token"; chmod 600 "$TENANT_DIR/gateway_sandbox.token"
}

# ---------------------------------------------------------------------------
# 6. Default compliance policy — same numbers services/compliance/README.md
#    already documents (CBN Tier-1 daily/single-txn limit of NGN 30,000).
#    Skipped if already published for this tenant.
# ---------------------------------------------------------------------------
publish_default_policy() {
  [ -f "$TENANT_DIR/policy_published" ] && return
  log "Publishing default KYC-tier and device-binding policy for $SLUG"
  local admin_token; admin_token="$(cat "$TENANT_DIR/compliance_admin.token")"

  curl -sf -X POST "$COMPLIANCE_URL/v1/tenants/$TENANT_ID/compliance/kyc-policy" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d '{"tier":0,"requiredVerifications":[],"dailyLimitKobo":0,"singleTxnLimitKobo":0}' >/dev/null \
    || die "publishing the Tier-0 policy failed"

  curl -sf -X POST "$COMPLIANCE_URL/v1/tenants/$TENANT_ID/compliance/kyc-policy" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d '{"tier":1,"requiredVerifications":["bvn_or_nin"],"dailyLimitKobo":3000000,"singleTxnLimitKobo":3000000}' >/dev/null \
    || die "publishing the Tier-1 policy failed"

  curl -sf -X POST "$COMPLIANCE_URL/v1/tenants/$TENANT_ID/compliance/device-policy" \
    -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
    -d '{"newDeviceCooldownHours":24,"newDeviceLimitKobo":2000000}' >/dev/null \
    || die "publishing the device-binding policy failed"

  touch "$TENANT_DIR/policy_published"
}

# ---------------------------------------------------------------------------
# 7. Hand the operate credentials to a product backend
# ---------------------------------------------------------------------------
write_env_snippet() {
  local ledger_key payments_key compliance_key
  ledger_key="$(cat "$TENANT_DIR/ledger_operate.token")"
  payments_key="$(cat "$TENANT_DIR/payments_operate.token")"
  compliance_key="$(cat "$TENANT_DIR/compliance_operate.token")"

  if [ -n "$PRODUCT_BACKEND_ENV" ]; then
    [ -f "$PRODUCT_BACKEND_ENV" ] || die "$PRODUCT_BACKEND_ENV does not exist"
    log "Writing tenant credentials into $PRODUCT_BACKEND_ENV"
    env_file_set TENANT_ID "$TENANT_ID" "$PRODUCT_BACKEND_ENV"
    env_file_set LEDGER_API_KEY "$ledger_key" "$PRODUCT_BACKEND_ENV"
    env_file_set PAYMENTS_API_KEY "$payments_key" "$PRODUCT_BACKEND_ENV"
    env_file_set COMPLIANCE_API_KEY "$compliance_key" "$PRODUCT_BACKEND_ENV"
    log "Restart the product backend's service to pick these up: sudo systemctl restart <unit>"
  else
    cat <<EOF

Tenant '$SLUG' provisioned (id: $TENANT_ID). No --product-backend-env given — here's what a
product backend's .env needs:

TENANT_ID=$TENANT_ID
LEDGER_API_KEY=$ledger_key
PAYMENTS_API_KEY=$payments_key
COMPLIANCE_API_KEY=$compliance_key
EOF
  fi
}

# ---------------------------------------------------------------------------
# 8. Sandbox twin — a second, synthetic tenant so the gateway's
#    sandbox-tier key issued above resolves to genuinely isolated data
#    instead of just a lower rate limit (services/gateway's SandboxTenant
#    model, src/middleware/resolveEffectiveTenant.js). Provisioned via the
#    exact same primitives as the real tenant above — every function
#    above reads SLUG/NAME/TENANT_ID/TENANT_DIR as globals, so re-running
#    them against a second, temporarily-swapped set of globals provisions
#    a second, fully independent tenant with no separate code path.
# ---------------------------------------------------------------------------
provision_sandbox_twin() {
  local real_slug="$SLUG" real_name="$NAME" real_tenant_id="$TENANT_ID" real_tenant_dir="$TENANT_DIR"

  SLUG="${real_slug}-sandbox"
  NAME="${real_name} (Sandbox)"
  TENANT_DIR="$SECRETS_DIR/tenants/$SLUG"
  mkdir -p "$TENANT_DIR" && chmod 700 "$TENANT_DIR"

  log "Provisioning sandbox twin for $real_slug"
  create_tenant
  bootstrap_ledger_credentials
  bootstrap_node_service_credentials payments pay_live trustbank_payments
  bootstrap_node_service_credentials compliance cmp_live trustbank_compliance
  bootstrap_gateway_credentials
  store_gateway_backend_credentials
  store_payments_ledger_credential
  publish_default_policy
  local sandbox_tenant_id="$TENANT_ID"

  # Restore the real tenant's state before registering the mapping —
  # the registration call authenticates as the *real* tenant's gateway
  # admin key and targets the real tenant's own URL.
  SLUG="$real_slug"; NAME="$real_name"; TENANT_ID="$real_tenant_id"; TENANT_DIR="$real_tenant_dir"

  if [ ! -f "$TENANT_DIR/sandbox_registered" ]; then
    log "Registering $real_slug's sandbox twin with the gateway"
    local admin_token; admin_token="$(cat "$TENANT_DIR/gateway_admin.token")"
    curl -sf -X POST "$GATEWAY_URL/v1/tenants/$TENANT_ID/sandbox" \
      -H "Authorization: Bearer $admin_token" -H "Content-Type: application/json" \
      -d "$(jq -n --arg s "$sandbox_tenant_id" '{sandboxTenantId:$s}')" >/dev/null \
      || die "registering the sandbox twin with the gateway failed"
    touch "$TENANT_DIR/sandbox_registered"
  fi
  printf '%s' "$sandbox_tenant_id" > "$TENANT_DIR/sandbox_tenant_id"
}

# ---------------------------------------------------------------------------
# 9. Print the gateway's own credentials — nothing gets written into a
#    .env for these (the gateway stores per-tenant credentials in its own
#    database, not a shared file), so this is the only place they surface.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Identity's own Ledger + Compliance operate credentials — needed before
# it can actually execute an approved maker-checker action on this
# tenant's behalf. Same shape as bootstrap_gateway_credentials above,
# minus Payments (identity doesn't execute any Payments action today).
# ---------------------------------------------------------------------------
bootstrap_identity_backend_credentials() {
  local migrate_url="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trust_bank_ledger?sslmode=disable"

  if [ ! -f "$TENANT_DIR/ledger_operate_identity.token" ]; then
    log "Bootstrapping Ledger operate credential for $SLUG's identity service"
    local out token
    out="$(cd "$APP_ROOT/services/ledger" && MIGRATE_DATABASE_URL="$migrate_url" \
      go run ./cmd/bootstrap-key --scope operate --tenant-id "$TENANT_ID" --label "$SLUG-identity")"
    token="$(extract_token "$out" lgr_live)"
    [ -n "$token" ] || die "could not parse Ledger operate token for identity"
    printf '%s' "$token" > "$TENANT_DIR/ledger_operate_identity.token"; chmod 600 "$TENANT_DIR/ledger_operate_identity.token"
  fi

  if [ ! -f "$TENANT_DIR/compliance_operate_identity.token" ]; then
    log "Bootstrapping Compliance operate credential for $SLUG's identity service"
    local out token
    out="$(cd "$APP_ROOT/services/compliance" && DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_compliance?schema=public" \
      node scripts/bootstrapKey.js --tenant-id "$TENANT_ID" --scope operate --label "$SLUG-identity")"
    token="$(extract_token "$out" cmp_live)"
    [ -n "$token" ] || die "could not parse Compliance operate token for identity"
    printf '%s' "$token" > "$TENANT_DIR/compliance_operate_identity.token"; chmod 600 "$TENANT_DIR/compliance_operate_identity.token"
  fi
}

# Stored via a direct-DB script, not an HTTP admin route — identity's
# entire HTTP surface is staff-session-gated (a logged-in human); see
# scripts/storeTenantBackendCredential.js's own comment for why this
# can't be a POST route the way the gateway's equivalent is.
store_identity_backend_credentials() {
  [ -f "$TENANT_DIR/identity_backend_credentials_stored" ] && return
  log "Storing $SLUG's Ledger/Compliance credentials in identity"
  local db_url="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_identity?schema=public"
  # The script encrypts the token at rest (tenantBackendCredentialService.js
  # -> mfaSecrets.js), so it needs the same IDENTITY_ENCRYPTION_KEY the
  # running service already has — read it from identity's own .env
  # (generated by install.sh) rather than inventing a second copy here.
  local enc_key; enc_key="$(grep '^IDENTITY_ENCRYPTION_KEY=' "$APP_ROOT/services/identity/.env" | cut -d= -f2-)"
  [ -n "$enc_key" ] || die "IDENTITY_ENCRYPTION_KEY not found in $APP_ROOT/services/identity/.env — run install.sh first"

  (cd "$APP_ROOT/services/identity" && DATABASE_URL="$db_url" IDENTITY_ENCRYPTION_KEY="$enc_key" \
    node scripts/storeTenantBackendCredential.js --tenant-id "$TENANT_ID" --service ledger \
      --token "$(cat "$TENANT_DIR/ledger_operate_identity.token")") \
    || die "storing identity's Ledger credential failed"

  (cd "$APP_ROOT/services/identity" && DATABASE_URL="$db_url" IDENTITY_ENCRYPTION_KEY="$enc_key" \
    node scripts/storeTenantBackendCredential.js --tenant-id "$TENANT_ID" --service compliance \
      --token "$(cat "$TENANT_DIR/compliance_operate_identity.token")") \
    || die "storing identity's Compliance credential failed"

  touch "$TENANT_DIR/identity_backend_credentials_stored"
}

# ---------------------------------------------------------------------------
# Staff identity — bootstraps this tenant's first staff user (services/
# identity, Phase 2.5). Skipped, with instructions printed instead, if
# --ops-admin-email wasn't given — this needs a real email address the
# script can't invent, unlike every other credential above.
# ---------------------------------------------------------------------------
bootstrap_first_staff_user() {
  if [ -z "$OPS_ADMIN_EMAIL" ]; then
    cat <<EOF

No --ops-admin-email given — skipping staff bootstrap. Run this once a real
email is known:

  cd $APP_ROOT/services/identity && DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_identity?schema=public" \\
    node scripts/bootstrapStaffUser.js --tenant-id $TENANT_ID --email <email> --role ops_admin
EOF
    return
  fi

  [ -f "$TENANT_DIR/staff_ops_admin_bootstrapped" ] && return
  log "Bootstrapping $SLUG's first staff user ($OPS_ADMIN_EMAIL, ops_admin)"
  local out
  out="$(cd "$APP_ROOT/services/identity" && DATABASE_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")/trustbank_identity?schema=public" \
    node scripts/bootstrapStaffUser.js --tenant-id "$TENANT_ID" --email "$OPS_ADMIN_EMAIL" --role ops_admin)"
  printf '%s\n' "$out" > "$TENANT_DIR/staff_ops_admin_bootstrap_output.txt"
  chmod 600 "$TENANT_DIR/staff_ops_admin_bootstrap_output.txt"
  touch "$TENANT_DIR/staff_ops_admin_bootstrapped"
  log "Staff bootstrap output (temp password shown once) saved to $TENANT_DIR/staff_ops_admin_bootstrap_output.txt"
}

print_gateway_summary() {
  cat <<EOF

Gateway (services/gateway — the public API for external bank/developer
integration): admin key and a starter sandbox key for '$SLUG':

Admin key   (issue/revoke further keys, POST /v1/tenants/$TENANT_ID/api-keys):
  $(cat "$TENANT_DIR/gateway_admin.token")
Sandbox key (the actual proxied banking routes, rate-limited, resolves to
             the isolated sandbox tenant below — not $SLUG's real data):
  $(cat "$TENANT_DIR/gateway_sandbox.token")

Sandbox tenant (isolated Ledger/Payments/Compliance twin the sandbox key
above resolves to — see services/gateway's SandboxTenant model):
  $(cat "$TENANT_DIR/sandbox_tenant_id")

See services/gateway/README.md for the full route list and how to issue a
production-tier key once this tenant is ready to go live.
EOF
}

main() {
  bootstrap_platform_admin
  create_tenant
  bootstrap_ledger_credentials
  bootstrap_node_service_credentials payments pay_live trustbank_payments
  bootstrap_node_service_credentials compliance cmp_live trustbank_compliance
  bootstrap_gateway_credentials
  store_gateway_backend_credentials
  store_payments_ledger_credential
  issue_starter_sandbox_key
  publish_default_policy
  write_env_snippet
  provision_sandbox_twin
  bootstrap_identity_backend_credentials
  store_identity_backend_credentials
  bootstrap_first_staff_user
  print_gateway_summary
  log "Done. Per-tenant state cached under $TENANT_DIR for reruns."
}

main
