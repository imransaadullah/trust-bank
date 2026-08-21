#!/usr/bin/env bash
# Fresh Ubuntu 22.04/24.04 box -> all four trust-bank services built,
# migrated, and running under systemd. Idempotent — rerun to pick up a
# `git pull` and redeploy; never regenerates a secret or re-runs a
# destructive step once `.env` files already exist.
#
# NOT exercised against a real systemd/apt host as part of building this —
# this repo's dev environment is macOS with no systemd and no Docker
# available. The apt/Go/nvm/Caddy install steps and the systemd
# install/start steps are correct as written against each tool's
# documented usage, but treat the first real run on an actual VPS as the
# actual test of those specific steps. Everything from "per-service build
# and migrate" onward has been live-verified against a throwaway Postgres
# stack the same way every other pass in this repo's history has been.
#
# Usage: sudo -u ubuntu ./install.sh   (run as the deploy user, not root —
# it escalates to sudo only for the specific steps that need it)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

APP_ROOT="${APP_ROOT:-/home/ubuntu/trust-bank}"
DEPLOY_USER="${DEPLOY_USER:-$(whoami)}"
REPO_URL="${REPO_URL:-https://github.com/imransaadullah/trust-bank.git}"
GO_VERSION="1.26.5" # must match services/ledger/go.mod's `go` directive
SECRETS_DIR="${SECRETS_DIR:-$HOME/.trustbank}"
PG_SUPERUSER_PW_FILE="$SECRETS_DIR/postgres_superuser_password"

[ "$(uname -s)" = "Linux" ] || die "install.sh targets Ubuntu 22.04/24.04 — refusing to run on $(uname -s). See the note at the top of this file about what's unverified."
[ "$EUID" -ne 0 ] || die "run as the deploy user (e.g. ubuntu), not root — this script uses sudo only for the specific steps that need it"

# ---------------------------------------------------------------------------
# 1. System dependencies (idempotent — each checks "already installed?" first)
# ---------------------------------------------------------------------------
install_system_deps() {
  log "Checking system dependencies"

  if ! have_cmd psql; then
    log "Installing PostgreSQL"
    sudo apt-get update -y
    sudo apt-get install -y postgresql postgresql-contrib
  fi

  have_cmd git || sudo apt-get install -y git
  have_cmd gcc || sudo apt-get install -y build-essential curl ca-certificates

  if ! have_cmd go || [ "$(go version 2>/dev/null | awk '{print $3}')" != "go${GO_VERSION}" ]; then
    log "Installing Go ${GO_VERSION}"
    curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf /tmp/go.tar.gz
    rm -f /tmp/go.tar.gz
    grep -q '/usr/local/go/bin' /etc/profile 2>/dev/null || \
      echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee -a /etc/profile >/dev/null
    export PATH="$PATH:/usr/local/go/bin"
  fi

  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    log "Installing nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # nvm.sh itself references unset internal variables — incompatible with
  # `set -u` above. Relax it only for the duration of sourcing/using nvm.
  set +u
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  have_cmd node || { log "Installing Node LTS"; nvm install --lts; }
  set -u
  NODE_BIN="$(command -v node)"

  if ! have_cmd caddy; then
    log "Installing Caddy"
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y caddy
  fi

  # For backup.sh/restore.sh — any S3-compatible endpoint via --endpoint-url.
  have_cmd aws || { log "Installing awscli"; sudo apt-get install -y awscli; }
}

# ---------------------------------------------------------------------------
# 1b. Postgres superuser auth — `sudo -u postgres psql` (used for one-off
#     admin commands above) authenticates via the local `peer` mapping and
#     never needs a password, but Ledger's `make migrate` / `bootstrap-key`
#     connect over TCP with a plain postgres:// URI, which hits Ubuntu's
#     default `host ... md5` pg_hba.conf line instead — that fails with no
#     password set. Give `postgres` a real password once, store it
#     alongside the ledger_app one, and use it for every TCP superuser
#     connection this script (and provision-tenant.sh) makes from here on.
# ---------------------------------------------------------------------------
setup_postgres_auth() {
  mkdir -p "$SECRETS_DIR" && chmod 700 "$SECRETS_DIR"
  if [ ! -f "$PG_SUPERUSER_PW_FILE" ]; then
    log "Setting a Postgres superuser password for TCP connections"
    local pw; pw="$(gen_secret)"
    pg_admin_psql -c "ALTER ROLE postgres PASSWORD '${pw}';"
    printf '%s' "$pw" > "$PG_SUPERUSER_PW_FILE"
    chmod 600 "$PG_SUPERUSER_PW_FILE"
  fi
  PG_SUPERUSER_URL="$(pg_superuser_url "$PG_SUPERUSER_PW_FILE")"
}

# ---------------------------------------------------------------------------
# 2. Clone or update
# ---------------------------------------------------------------------------
clone_or_pull() {
  if [ -d "$APP_ROOT/.git" ]; then
    log "Updating existing checkout at $APP_ROOT"
    git -C "$APP_ROOT" pull --ff-only
  else
    log "Cloning trust-bank to $APP_ROOT"
    sudo mkdir -p "$(dirname "$APP_ROOT")"
    sudo chown "$DEPLOY_USER" "$(dirname "$APP_ROOT")"
    git clone "$REPO_URL" "$APP_ROOT"
  fi
}

# ---------------------------------------------------------------------------
# 3. Ledger (Go) — its own DB role (ledger_app) per migrations/0003_app_role.sql
# ---------------------------------------------------------------------------
setup_ledger() {
  log "Setting up Ledger"
  local dir="$APP_ROOT/services/ledger"
  pg_db_ensure trust_bank_ledger

  local env_file="$dir/.env"
  local first_run=0
  [ -f "$env_file" ] || first_run=1

  if [ "$first_run" -eq 1 ]; then
    cp "$dir/.env.example" "$env_file"
    local ledger_app_pw; ledger_app_pw="$(gen_secret)"
    env_file_set MIGRATE_DATABASE_URL "${PG_SUPERUSER_URL}/trust_bank_ledger?sslmode=disable" "$env_file"
    env_file_set DATABASE_URL "postgres://ledger_app:${ledger_app_pw}@localhost:${PG_PORT}/trust_bank_ledger?sslmode=disable" "$env_file"
    printf '%s' "$ledger_app_pw" > /tmp/.trustbank_ledger_app_pw
  fi

  (cd "$dir" && MIGRATE_DATABASE_URL="${PG_SUPERUSER_URL}/trust_bank_ledger?sslmode=disable" make migrate)

  # migrations/0003 creates ledger_app with the literal default password
  # 'change-me-in-production' (IF NOT EXISTS — safe to run every time).
  # Overwrite it with our generated one on first run only, so the same
  # well-known default isn't left live on a real deployment.
  if [ "$first_run" -eq 1 ] && [ -f /tmp/.trustbank_ledger_app_pw ]; then
    local pw; pw="$(cat /tmp/.trustbank_ledger_app_pw)"
    pg_admin_psql -d trust_bank_ledger -c "ALTER ROLE ledger_app PASSWORD '${pw}';"
    rm -f /tmp/.trustbank_ledger_app_pw
  fi

  (cd "$dir" && go build -o bin/ledger ./cmd/ledger)
}

# ---------------------------------------------------------------------------
# 4. Payments / Compliance / trustpay-backend (Node, Prisma) — shared shape
# ---------------------------------------------------------------------------
setup_node_service() {
  local name="$1" dbname="$2"
  local dir="$APP_ROOT/services/$name"
  log "Setting up $name"
  pg_db_ensure "$dbname"

  local env_file="$dir/.env"
  local first_run=0
  [ -f "$env_file" ] || first_run=1
  if [ "$first_run" -eq 1 ]; then
    cp "$dir/.env.example" "$env_file"
    # Prisma accepts both postgres:// and postgresql:// schemes.
    env_file_set DATABASE_URL "${PG_SUPERUSER_URL}/${dbname}?schema=public" "$env_file"
  fi

  (cd "$dir" && npm ci && npx prisma generate)
  (cd "$dir" && DATABASE_URL="$(grep '^DATABASE_URL=' "$env_file" | cut -d= -f2-)" npx prisma migrate deploy)

  if [ "$first_run" -eq 1 ]; then
    case "$name" in
      payments)
        # PAYMENTS_ENCRYPTION_KEY encrypts TenantProviderConfig.encryptedCredentials
        # at rest — losing it doesn't mean "generate a new one," it means
        # every tenant's provider credentials become permanently unreadable.
        # Captured in $SECRETS_DIR/critical-secrets.env too, not just this
        # .env, so it isn't the box's only copy — see deploy/README.md's
        # disaster-recovery section for why, and what still has to happen
        # manually (copying it somewhere durable off-box).
        local payments_key; payments_key="$(gen_secret)"
        env_file_set PAYMENTS_ENCRYPTION_KEY "$payments_key" "$env_file"
        capture_critical_secret payments PAYMENTS_ENCRYPTION_KEY "$payments_key"
        ;;
      trustpay-backend)
        # Lower stakes than the key above — losing this only invalidates
        # existing sessions, nobody loses data — but capturing it costs
        # nothing and saves a forced mass re-login after a real disaster.
        local jwt_secret; jwt_secret="$(gen_secret)"
        env_file_set TRUSTPAY_JWT_SECRET "$jwt_secret" "$env_file"
        capture_critical_secret trustpay-backend TRUSTPAY_JWT_SECRET "$jwt_secret"
        ;;
      gateway)
        # Same stakes as PAYMENTS_ENCRYPTION_KEY above — encrypts every
        # tenant's stored Ledger/Payments/Compliance operate credential
        # (TenantBackendCredential.encryptedToken). Losing it means every
        # tenant needs re-provisioning via provision-tenant.sh, not that
        # data is corrupted.
        local gateway_key; gateway_key="$(gen_secret)"
        env_file_set GATEWAY_ENCRYPTION_KEY "$gateway_key" "$env_file"
        capture_critical_secret gateway GATEWAY_ENCRYPTION_KEY "$gateway_key"
        ;;
      identity)
        # Same stakes as PAYMENTS_ENCRYPTION_KEY/GATEWAY_ENCRYPTION_KEY —
        # encrypts every staff user's TOTP secret (StaffUser.mfaSecret).
        # Losing it means every staff member needs to re-enroll MFA, not
        # that data is corrupted.
        local identity_key; identity_key="$(gen_secret)"
        env_file_set IDENTITY_ENCRYPTION_KEY "$identity_key" "$env_file"
        capture_critical_secret identity IDENTITY_ENCRYPTION_KEY "$identity_key"
        ;;
      cards)
        # Same stakes as the other services' own *_ENCRYPTION_KEY —
        # encrypts TenantLedgerCredential/TenantCardProviderConfig at
        # rest. Was missing from this case statement even though Cards
        # itself was already shipped — this service was never actually
        # stood up by a fresh install; fixed here alongside Checkout.
        local cards_key; cards_key="$(gen_secret)"
        env_file_set CARDS_ENCRYPTION_KEY "$cards_key" "$env_file"
        capture_critical_secret cards CARDS_ENCRYPTION_KEY "$cards_key"
        ;;
      checkout)
        # Same stakes as Cards' own key — encrypts
        # TenantLedgerCredential/TenantCheckoutProviderConfig and every
        # merchant's own webhook signing secret at rest.
        local checkout_key; checkout_key="$(gen_secret)"
        env_file_set CHECKOUT_ENCRYPTION_KEY "$checkout_key" "$env_file"
        capture_critical_secret checkout CHECKOUT_ENCRYPTION_KEY "$checkout_key"
        ;;
    esac
  fi
}

# ---------------------------------------------------------------------------
# 4b. backup.env — first run only, never overwritten (holds real S3 +
#     webhook credentials the operator fills in after install).
# ---------------------------------------------------------------------------
setup_backup_env() {
  local env_file="$SCRIPT_DIR/backup.env"
  if [ ! -f "$env_file" ]; then
    log "Creating deploy/backup.env from backup.env.example — fill in real credentials before backups/notifications work"
    cp "$SCRIPT_DIR/backup.env.example" "$env_file"
  fi
}

# ---------------------------------------------------------------------------
# 5. systemd units — rendered from deploy/templates/, not checked in static
# ---------------------------------------------------------------------------
install_systemd_units() {
  log "Installing systemd units"
  local tmp; tmp="$(mktemp -d)"
  local unit

  for unit in trustbank-ledger trustbank-payments trustbank-compliance trustbank-gateway trustbank-identity trustbank-cards trustbank-checkout trustpay-backend; do
    render_template "$SCRIPT_DIR/templates/${unit}.service.tmpl" "$tmp/${unit}.service" \
      "APP_ROOT=${APP_ROOT}" "DEPLOY_USER=${DEPLOY_USER}" "NODE_BIN=${NODE_BIN}"
    sudo cp "$tmp/${unit}.service" "/etc/systemd/system/${unit}.service"
  done

  render_template "$SCRIPT_DIR/templates/trustbank-backup.service.tmpl" "$tmp/trustbank-backup.service" \
    "APP_ROOT=${APP_ROOT}" "DEPLOY_USER=${DEPLOY_USER}" "NODE_BIN=${NODE_BIN}"
  sudo cp "$tmp/trustbank-backup.service" /etc/systemd/system/trustbank-backup.service
  sudo cp "$SCRIPT_DIR/templates/trustbank-backup.timer.tmpl" /etc/systemd/system/trustbank-backup.timer

  # Instantiated on demand by other units' OnFailure=, never enabled/started
  # directly — install the template unit itself, that's all it needs.
  render_template "$SCRIPT_DIR/templates/trustbank-notify-failure@.service.tmpl" "$tmp/trustbank-notify-failure@.service" \
    "APP_ROOT=${APP_ROOT}" "DEPLOY_USER=${DEPLOY_USER}" "NODE_BIN=${NODE_BIN}"
  sudo cp "$tmp/trustbank-notify-failure@.service" "/etc/systemd/system/trustbank-notify-failure@.service"

  rm -rf "$tmp"

  sudo systemctl daemon-reload
  for unit in trustbank-ledger trustbank-payments trustbank-compliance trustbank-gateway trustbank-identity trustbank-cards trustbank-checkout trustpay-backend; do
    sudo systemctl enable "$unit"
    sudo systemctl restart "$unit"
  done
  # The timer, not the backup service itself — running backup.sh now would
  # just fail until backup.env has real credentials in it, which is
  # expected on a fresh install (see setup_backup_env's log line above).
  sudo systemctl enable --now trustbank-backup.timer
}

# ---------------------------------------------------------------------------
# 6. Caddy — reverse proxy, TrustPay Backend only (see NETWORK_TOPOLOGY.md)
# ---------------------------------------------------------------------------
setup_caddy() {
  log "Configuring Caddy"
  if [ ! -f /etc/caddy/Caddyfile ] || ! grep -q "reverse_proxy 127.0.0.1:8082" /etc/caddy/Caddyfile 2>/dev/null; then
    warn "Caddy site blocks not detected — copy deploy/Caddyfile.example to /etc/caddy/Caddyfile (two domains: trustpay-backend on :8082, the gateway on :8084), set your real domains, then run: sudo systemctl reload caddy"
  else
    sudo systemctl reload caddy
  fi
}

main() {
  install_system_deps
  setup_postgres_auth
  clone_or_pull
  setup_ledger
  setup_node_service payments trustbank_payments
  setup_node_service compliance trustbank_compliance
  setup_node_service gateway trustbank_gateway
  setup_node_service identity trustbank_identity
  # Both were previously missing from main() despite being marked
  # shipped — Cards/Checkout were never actually stood up by a fresh
  # install. Fixed here alongside Checkout's own build.
  setup_node_service cards trustbank_cards
  setup_node_service checkout trustbank_checkout
  setup_node_service trustpay-backend trustpay_backend
  setup_backup_env
  install_systemd_units
  setup_caddy

  log "Done. Service status:"
  sudo systemctl --no-pager status trustbank-ledger trustbank-payments trustbank-compliance trustbank-gateway trustbank-identity trustbank-cards trustbank-checkout trustpay-backend || true
  cat <<EOF

Next steps:
  1. trustpay-backend/.env still needs real vendor credentials before it will
     stay up: AUTHCORE_PROJECT_KEY, AUTHCORE_JWKS_URL, AUTHCORE_PROJECT_ID.
  2. Run deploy/provision-tenant.sh to onboard a tenant and populate
     TENANT_ID / LEDGER_API_KEY / PAYMENTS_API_KEY / COMPLIANCE_API_KEY, and
     the gateway's own per-tenant backend credentials (services/gateway —
     the public API for external bank/developer integration, distinct from
     trustpay-backend). See services/gateway/README.md.
  2b. The identity service (services/identity — staff login, MFA, RBAC,
     branches; Phase 2.5) needs its first staff user bootstrapped
     separately: node scripts/bootstrapStaffUser.js --tenant-id <id>
     --email <email> --role ops_admin, run from services/identity. See
     services/identity/README.md.
  3. Payments' TenantProviderConfig (Paystack/self-issued-NUBAN credentials)
     is set up per-tenant via its own API — see services/payments/README.md.
  4. Fill in deploy/backup.env (S3-compatible bucket + credentials, a
     webhook URL for crash notifications) — daily backups and failure
     alerts are installed but inert until it's configured. Then rehearse
     a restore: deploy/restore.sh <db-name> — see deploy/README.md.
  5. Set up an external uptime monitor (UptimeRobot, healthchecks.io, etc.)
     pinging https://<your-domain>/health — the one check that catches
     trustpay-backend being unreachable from outside, which systemd alone
     can't see.
  6. IMPORTANT — copy $SECRETS_DIR/critical-secrets.env somewhere durable
     and off this box RIGHT NOW (a password manager, a secrets tool). It
     holds PAYMENTS_ENCRYPTION_KEY — lose this box without a copy of that
     key elsewhere and every tenant's provider credentials become
     permanently unreadable, even with a perfect database restore.
EOF
}

main "$@"
