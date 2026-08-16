#!/usr/bin/env bash
# Generic webhook notifier, invoked by systemd's OnFailure= on any of the
# four services (see templates/trustbank-notify-failure@.service.tmpl and
# the OnFailure= line each service template carries). Posts a small JSON
# payload — works against a Slack incoming webhook, a Discord webhook, or
# most incident tools' generic webhook endpoint, with no vendor-specific
# code. Covers all four services, including the three that are
# loopback-only and can't be checked by an external HTTP ping (see
# deploy/README.md's note on pairing this with an external uptime check
# on trustpay-backend's public /health endpoint).
#
# Usage: ./notify-failure.sh <failed-unit-name>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$SCRIPT_DIR/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$BACKUP_ENV_FILE"
  set +a
fi

UNIT="${1:?Usage: $0 <failed-unit-name>}"

if [ -z "${NOTIFY_WEBHOOK_URL:-}" ]; then
  warn "NOTIFY_WEBHOOK_URL not configured in $BACKUP_ENV_FILE — $UNIT failed but nothing was notified"
  exit 0
fi

PAYLOAD="$(printf '{"text":"trust-bank: %s failed on %s at %s"}' "$UNIT" "$(hostname)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
curl -fsS -X POST -H 'Content-Type: application/json' -d "$PAYLOAD" "$NOTIFY_WEBHOOK_URL" \
  || warn "failed to deliver failure notification for $UNIT"
