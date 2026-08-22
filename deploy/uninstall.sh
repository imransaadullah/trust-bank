#!/usr/bin/env bash
# Reverses install.sh — stops/removes every trust-bank systemd unit, drops
# every trust-bank Postgres database (and the ledger_app role), and deletes
# the cloned repo + $SECRETS_DIR. Leaves the OS-level packages install.sh
# added (Postgres, Caddy, Go, Node/nvm, awscli) in place by default, since
# removing them is riskier and not what "remove the app" usually means —
# pass --purge-packages to also apt-remove those.
#
# Same "not exercised against a real systemd/apt host" caveat install.sh
# carries — this repo's dev environment has neither. Every step here is the
# documented reverse of a step install.sh documents taking (see the
# comments below), and each one is idempotent/defensive the same way
# install.sh's own steps are (checks before acting, doesn't fail hard on
# something already gone) — but treat the first real run on an actual VPS
# as the actual test.
#
# Usage: ./uninstall.sh [--yes] [--purge-packages] [--keep-databases] [--keep-repo] [--keep-secrets]
#   --yes              skip the interactive confirmation (for scripted use)
#   --purge-packages   also apt-remove Postgres/Caddy/Go/Node(nvm)/awscli —
#                      genuinely returns the box near-bare, not just app-bare
#   --keep-databases   stop/remove services but leave every DB in place
#   --keep-repo        leave $APP_ROOT (the cloned checkout) in place
#   --keep-secrets     leave $SECRETS_DIR ($HOME/.trustbank) in place —
#                      only makes sense combined with --keep-databases,
#                      otherwise you're keeping keys with nothing left to
#                      decrypt
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

APP_ROOT="${APP_ROOT:-/home/ubuntu/trust-bank}"
SECRETS_DIR="${SECRETS_DIR:-$HOME/.trustbank}"

ASSUME_YES=0
PURGE_PACKAGES=0
KEEP_DATABASES=0
KEEP_REPO=0
KEEP_SECRETS=0

for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    --purge-packages) PURGE_PACKAGES=1 ;;
    --keep-databases) KEEP_DATABASES=1 ;;
    --keep-repo) KEEP_REPO=1 ;;
    --keep-secrets) KEEP_SECRETS=1 ;;
    *) die "unknown flag: $arg (see the usage comment at the top of this file)" ;;
  esac
done

[ "$(uname -s)" = "Linux" ] || die "uninstall.sh targets the same Ubuntu box install.sh does — refusing to run on $(uname -s)."
[ "$EUID" -ne 0 ] || die "run as the deploy user (e.g. ubuntu), not root — same as install.sh"

UNITS=(trustbank-ledger trustbank-payments trustbank-compliance trustbank-gateway trustbank-identity trustbank-cards trustbank-checkout trustpay-backend)
DATABASES=(trust_bank_ledger trustbank_payments trustbank_compliance trustbank_gateway trustbank_identity trustbank_cards trustbank_checkout trustpay_backend)

# ---------------------------------------------------------------------------
# 0. Confirm — this is destructive and, for the databases, not reversible
#    without a backup. Same "measure twice" reasoning as every other
#    destructive script in this repo.
# ---------------------------------------------------------------------------
confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0

  local msg="This will stop every trust-bank service and remove their systemd units."
  [ "$KEEP_DATABASES" -eq 0 ] && msg="$msg It will DROP every trust-bank database."
  [ "$KEEP_REPO" -eq 0 ] && msg="$msg It will delete $APP_ROOT."
  if [ "$KEEP_SECRETS" -eq 0 ]; then
    msg="$msg It will delete $SECRETS_DIR (encryption keys — see deploy/README.md's disaster-recovery section on what that means for any backups you'd ever want to restore)."
  fi
  warn "$msg"
  [ "$PURGE_PACKAGES" -eq 1 ] && warn "--purge-packages is also set: Postgres, Caddy, Go, Node/nvm, and awscli will be apt-removed."

  read -r -p "Type 'yes' to continue: " reply
  [ "$reply" = "yes" ] || die "aborted — nothing was touched."
}

# ---------------------------------------------------------------------------
# 1. Stop and remove every systemd unit install.sh installed
#    (reverses install_systemd_units).
# ---------------------------------------------------------------------------
teardown_systemd() {
  log "Stopping and disabling trust-bank services"
  for unit in "${UNITS[@]}"; do
    sudo systemctl stop "$unit" 2>/dev/null || true
    sudo systemctl disable "$unit" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/${unit}.service"
  done

  sudo systemctl stop trustbank-backup.timer 2>/dev/null || true
  sudo systemctl disable trustbank-backup.timer 2>/dev/null || true
  sudo rm -f /etc/systemd/system/trustbank-backup.service
  sudo rm -f /etc/systemd/system/trustbank-backup.timer

  # Instantiated on demand by OnFailure= (or the manual-test invocation in
  # deploy/README.md) — list whatever's currently active/failed and stop
  # those specific instances before removing the template unit itself.
  local instances
  instances="$(systemctl list-units --all --plain --no-legend 'trustbank-notify-failure@*.service' 2>/dev/null | awk '{print $1}')"
  if [ -n "$instances" ]; then
    log "Stopping running trustbank-notify-failure@ instances"
    while IFS= read -r inst; do
      [ -n "$inst" ] && sudo systemctl stop "$inst" 2>/dev/null || true
    done <<<"$instances"
  fi
  sudo rm -f "/etc/systemd/system/trustbank-notify-failure@.service"

  sudo systemctl daemon-reload
  sudo systemctl reset-failed 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 2. Drop every trust-bank database + the ledger_app role
#    (reverses pg_db_ensure calls in setup_ledger/setup_node_service, and
#    the ALTER ROLE ledger_app step in setup_ledger).
# ---------------------------------------------------------------------------
teardown_databases() {
  [ "$KEEP_DATABASES" -eq 1 ] && { log "Skipping database drop (--keep-databases)"; return 0; }
  have_cmd psql || { log "Postgres isn't installed — nothing to drop"; return 0; }

  log "Dropping trust-bank databases"
  for db in "${DATABASES[@]}"; do
    if pg_db_exists "$db"; then
      sudo -u postgres dropdb -p "$PG_PORT" "$db"
      log "Dropped $db"
    fi
  done

  # ledger_app owns nothing once trust_bank_ledger is gone — safe to drop
  # the role outright. Ubuntu's default postgres role is untouched (still
  # has whatever TCP password setup_postgres_auth set, if any — that's an
  # OS-account-level change, not app state, left alone here).
  if sudo -u postgres psql -p "$PG_PORT" -tAc "SELECT 1 FROM pg_roles WHERE rolname='ledger_app'" | grep -q 1; then
    sudo -u postgres psql -p "$PG_PORT" -c "DROP ROLE ledger_app;" || \
      warn "could not drop role ledger_app — it may still own objects outside the databases above; check manually with: sudo -u postgres psql -c \"\\du\""
  fi
}

# ---------------------------------------------------------------------------
# 3. Delete the cloned repo (reverses clone_or_pull) and $SECRETS_DIR
#    (reverses setup_postgres_auth / capture_critical_secret / every
#    provision-tenant.sh cache write under it).
# ---------------------------------------------------------------------------
teardown_app_state() {
  if [ "$KEEP_REPO" -eq 1 ]; then
    log "Skipping repo removal (--keep-repo)"
  elif [ -d "$APP_ROOT" ]; then
    log "Removing $APP_ROOT"
    rm -rf "$APP_ROOT"
  fi

  if [ "$KEEP_SECRETS" -eq 1 ]; then
    log "Skipping secrets removal (--keep-secrets)"
  elif [ -d "$SECRETS_DIR" ]; then
    log "Removing $SECRETS_DIR"
    rm -rf "$SECRETS_DIR"
  fi
}

# ---------------------------------------------------------------------------
# 4. Optional — apt-remove what install_system_deps installed. Off by
#    default: riskier (shared package manager state, not trust-bank-scoped)
#    and slower to redo than the app-level teardown above.
# ---------------------------------------------------------------------------
purge_packages() {
  [ "$PURGE_PACKAGES" -eq 1 ] || return 0
  log "Purging system packages install.sh added"

  sudo systemctl stop postgresql 2>/dev/null || true
  sudo apt-get purge -y postgresql postgresql-contrib 'postgresql-*' 2>/dev/null || true
  sudo rm -rf /var/lib/postgresql /etc/postgresql

  sudo systemctl stop caddy 2>/dev/null || true
  sudo apt-get purge -y caddy 2>/dev/null || true
  sudo rm -f /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  sudo rm -rf /etc/caddy

  sudo rm -rf /usr/local/go
  sudo sed -i '\#/usr/local/go/bin#d' /etc/profile 2>/dev/null || true

  # nvm/Node were installed per-user (never via apt) — remove the whole
  # nvm tree, same as nvm's own documented uninstall.
  rm -rf "$HOME/.nvm"
  sudo sed -i '\#NVM_DIR#d' "$HOME/.bashrc" "$HOME/.profile" 2>/dev/null || true

  sudo apt-get purge -y awscli 2>/dev/null || true

  sudo apt-get autoremove -y
}

main() {
  confirm
  teardown_systemd
  teardown_databases
  teardown_app_state
  purge_packages

  log "Done."
  if [ "$PURGE_PACKAGES" -eq 0 ]; then
    cat <<EOF

Postgres/Caddy/Go/Node are still installed — the box is app-bare, not
package-bare. Re-running install.sh from a fresh clone will rebuild
everything from here in one shot. Pass --purge-packages next time if you
wanted the OS-level packages gone too.
EOF
  fi
}

main "$@"
