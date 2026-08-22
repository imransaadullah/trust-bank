#!/usr/bin/env bash
# Dumps all eight trust-bank databases + Postgres role definitions, uploads
# each to S3-compatible storage, and prunes backups older than
# BACKUP_RETENTION_DAYS. Meant to run daily via trustbank-backup.timer
# (deploy/templates/trustbank-backup.timer.tmpl).
#
# pg_dump/pg_restore, not continuous WAL archiving — deliberately scoped
# for pre-launch, single-tenant volume, not the full multi-region HA/DR
# posture CORE_BANKING_PLATFORM_ARCHITECTURE.md §8 describes for real
# institutional volume. Upgrade path if that's ever warranted; premature
# now.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

SECRETS_DIR="${SECRETS_DIR:-$HOME/.trustbank}"
PG_SUPERUSER_PW_FILE="$SECRETS_DIR/postgres_superuser_password"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-$SCRIPT_DIR/backup.env}"

[ -f "$BACKUP_ENV_FILE" ] || die "$BACKUP_ENV_FILE not found — copy backup.env.example to backup.env and fill it in first"
set -a
# shellcheck source=/dev/null
source "$BACKUP_ENV_FILE"
set +a

: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required in $BACKUP_ENV_FILE}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required in $BACKUP_ENV_FILE}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required in $BACKUP_ENV_FILE}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required in $BACKUP_ENV_FILE}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

require_cmd pg_dump "should ship with the postgresql-client package"
require_cmd pg_dumpall "should ship with the postgresql-client package"
require_cmd aws "install.sh installs awscli — rerun it, or: pip3 install awscli"
require_cmd gzip "should already be present"
[ -f "$PG_SUPERUSER_PW_FILE" ] || die "$PG_SUPERUSER_PW_FILE not found — run install.sh first"

PGPASSWORD="$(cat "$PG_SUPERUSER_PW_FILE")"
export PGPASSWORD

# Gateway/Identity/Cards/Checkout were missing here despite being shipped
# and backed up nowhere else — the same "shipped but never actually wired
# into main()" gap install.sh's own comment already documents fixing for
# its build loop; this is the backup-side equivalent, caught while
# building deploy/uninstall.sh (which needed the real database list too).
DATABASES=(trust_bank_ledger trustbank_payments trustbank_compliance trustbank_gateway trustbank_identity trustbank_cards trustbank_checkout trustpay_backend)
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

s3_upload() {
  # Usage: s3_upload local_path s3_key
  aws s3 cp "$1" "s3://${BACKUP_S3_BUCKET}/$2" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
}

# --- 1. Role/global definitions — not captured by a per-database dump,
#        and a real restore needs ledger_app etc. to already exist. ---
log "Dumping global role definitions"
GLOBALS_FILE="$WORKDIR/globals_${TIMESTAMP}.sql.gz"
pg_dumpall -h localhost -p "$PG_PORT" -U postgres --globals-only | gzip > "$GLOBALS_FILE"
s3_upload "$GLOBALS_FILE" "globals/${TIMESTAMP}.sql.gz"

# --- 2. Each database, custom format (-Fc) — lets restore.sh (pg_restore)
#        do selective/parallel restore later, not just a flat SQL replay. ---
for db in "${DATABASES[@]}"; do
  log "Dumping $db"
  DUMP_FILE="$WORKDIR/${db}_${TIMESTAMP}.dump"
  pg_dump -h localhost -p "$PG_PORT" -U postgres -Fc -f "$DUMP_FILE" "$db"
  gzip "$DUMP_FILE"
  s3_upload "${DUMP_FILE}.gz" "${db}/${TIMESTAMP}.dump.gz"
done

# --- 3. Prune backups older than BACKUP_RETENTION_DAYS. The timestamp
#        format (%Y%m%dT%H%M%SZ) is fixed-width and sorts correctly as a
#        plain string, so this needs no date parsing beyond computing the
#        cutoff once — works identically against any S3-compatible target,
#        no bucket lifecycle policy assumed. `date -d` is GNU coreutils
#        syntax (Ubuntu-only, matching install.sh's own target). ---
CUTOFF_TIMESTAMP="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%Y%m%dT%H%M%SZ)"
for prefix in globals "${DATABASES[@]}"; do
  aws s3 ls "s3://${BACKUP_S3_BUCKET}/${prefix}/" --endpoint-url "$BACKUP_S3_ENDPOINT" 2>/dev/null \
    | awk '{print $4}' \
    | while read -r key; do
        [ -z "$key" ] && continue
        key_ts="${key%%.*}"
        if [[ "$key_ts" < "$CUTOFF_TIMESTAMP" ]]; then
          log "Pruning old backup: ${prefix}/${key}"
          aws s3 rm "s3://${BACKUP_S3_BUCKET}/${prefix}/${key}" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
        fi
      done
done

log "Backup complete: ${TIMESTAMP}"
