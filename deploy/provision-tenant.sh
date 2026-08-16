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
# Usage:
#   ./provision-tenant.sh --slug trustpay --name "TrustPay" \
#     --license-type OTHER --base-currency NGN \
#     --product-backend-env /home/ubuntu/trust-bank/services/trustpay-backend/.env \
#     --payments-env /home/ubuntu/trust-bank/services/payments/.env
#
# Known limitation, not something this script can fix: Payments holds a
# single global LEDGER_API_KEY in its own .env (services/payments/src/
# services/ledgerClient.js), used for every tenant's settlement calls —
# but every Ledger credential except platform-admin is tenant-bound and
# rejects a mismatched tenant. That's correct for onboarding the first/
# only tenant on a box. Provisioning a *second* tenant and passing
# --payments-env again would overwrite the first tenant's Ledger
# credential in Payments and break its settlement calls. That's a real
# gap in Payments' credential model, not a deployment-tooling problem —
# flagged here rather than silently onboarding a second tenant into a
# broken state. Omit --payments-env on a second tenant until that's
# addressed.
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

SLUG="" NAME="" LICENSE_TYPE="OTHER" BASE_CURRENCY="NGN" PRODUCT_BACKEND_ENV="" PAYMENTS_ENV=""

usage() {
  cat <<EOF
Usage: $0 --slug SLUG --name NAME [options]
  --license-type TYPE       UNIT_MFB | STATE_MFB | NATIONAL_MFB | PSB | BAAS_RESELLER | OTHER (default: OTHER)
  --base-currency CUR       default: NGN
  --product-backend-env P   .env file to append TENANT_ID/*_API_KEY to (printed instead if omitted)
  --payments-env P          Payments' own .env to write its Ledger credential into (see the
                            single-global-key limitation noted at the top of this file — first
                            tenant on a box only)
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
    --payments-env) PAYMENTS_ENV="$2"; shift 2 ;;
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
  local ledger_key payments_key compliance_key ledger_key_for_payments
  ledger_key="$(cat "$TENANT_DIR/ledger_operate.token")"
  payments_key="$(cat "$TENANT_DIR/payments_operate.token")"
  compliance_key="$(cat "$TENANT_DIR/compliance_operate.token")"
  ledger_key_for_payments="$(cat "$TENANT_DIR/ledger_operate_payments.token")"

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

  if [ -n "$PAYMENTS_ENV" ]; then
    [ -f "$PAYMENTS_ENV" ] || die "$PAYMENTS_ENV does not exist"
    log "Writing $SLUG's Ledger credential into $PAYMENTS_ENV (see the single-global-key note at the top of this file)"
    env_file_set LEDGER_API_KEY "$ledger_key_for_payments" "$PAYMENTS_ENV"
    log "Restart Payments to pick this up: sudo systemctl restart trustbank-payments"
  else
    cat <<EOF
No --payments-env given — Payments needs its own Ledger credential to boot (services/payments/
src/config/index.js requires LEDGER_API_KEY). Add to Payments' own .env:

LEDGER_API_KEY=$ledger_key_for_payments
EOF
  fi
}

# ---------------------------------------------------------------------------
# 8. Print the gateway's own credentials — nothing gets written into a
#    .env for these (the gateway stores per-tenant credentials in its own
#    database, not a shared file), so this is the only place they surface.
# ---------------------------------------------------------------------------
print_gateway_summary() {
  cat <<EOF

Gateway (services/gateway — the public API for external bank/developer
integration): admin key and a starter sandbox key for '$SLUG':

Admin key   (issue/revoke further keys, POST /v1/tenants/$TENANT_ID/api-keys):
  $(cat "$TENANT_DIR/gateway_admin.token")
Sandbox key (the actual proxied banking routes, rate-limited):
  $(cat "$TENANT_DIR/gateway_sandbox.token")

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
  issue_starter_sandbox_key
  publish_default_policy
  write_env_snippet
  print_gateway_summary
  log "Done. Per-tenant state cached under $TENANT_DIR for reruns."
}

main
