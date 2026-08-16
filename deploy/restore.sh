#!/usr/bin/env bash
# Restores a database from a backup produced by backup.sh. Two purposes:
# real disaster recovery, and rehearsing a restore — the actual point of
# CORE_BANKING_PLATFORM_ARCHITECTURE.md §8's "we have backups is not a DR
# plan until you've timed a restore." Defaults to a throwaway
# *_restore_test database so a rehearsal can never accidentally clobber
# the live one — pass --target-db explicitly for a real recovery.
#
# Usage: ./restore.sh <db-name> [backup-name|latest] [--target-db <name>]
#   db-name: trust_bank_ledger | trustbank_payments | trustbank_compliance | trustpay_backend
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

require_cmd aws "install.sh installs awscli — rerun it, or: pip3 install awscli"
require_cmd pg_restore "should ship with the postgresql-client package"
[ -f "$PG_SUPERUSER_PW_FILE" ] || die "$PG_SUPERUSER_PW_FILE not found — run install.sh first"

[ $# -ge 1 ] || die "Usage: $0 <db-name> [backup-name|latest] [--target-db <name>]"
DB_NAME="$1"; shift
case "$DB_NAME" in
  trust_bank_ledger|trustbank_payments|trustbank_compliance|trustpay_backend) ;;
  *) die "unknown db-name: $DB_NAME (expected trust_bank_ledger, trustbank_payments, trustbank_compliance, or trustpay_backend)" ;;
esac

BACKUP_NAME="latest"
if [ $# -gt 0 ] && [ "$1" != "--target-db" ]; then
  BACKUP_NAME="$1"; shift
fi
TARGET_DB=""
if [ "${1:-}" = "--target-db" ]; then
  TARGET_DB="${2:?--target-db requires a value}"
  shift 2
fi
TARGET_DB="${TARGET_DB:-${DB_NAME}_restore_test}"

PGPASSWORD="$(cat "$PG_SUPERUSER_PW_FILE")"
export PGPASSWORD

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

if [ "$BACKUP_NAME" = "latest" ]; then
  log "Finding latest backup for $DB_NAME"
  BACKUP_KEY="$(aws s3 ls "s3://${BACKUP_S3_BUCKET}/${DB_NAME}/" --endpoint-url "$BACKUP_S3_ENDPOINT" \
    | awk '{print $4}' | sort | tail -1)"
  [ -n "$BACKUP_KEY" ] || die "no backups found for $DB_NAME in s3://${BACKUP_S3_BUCKET}/${DB_NAME}/"
else
  BACKUP_KEY="$BACKUP_NAME"
  [[ "$BACKUP_KEY" == *.dump.gz ]] || BACKUP_KEY="${BACKUP_KEY}.dump.gz"
fi

log "Downloading ${DB_NAME}/${BACKUP_KEY}"
LOCAL_FILE="$WORKDIR/${BACKUP_KEY}"
aws s3 cp "s3://${BACKUP_S3_BUCKET}/${DB_NAME}/${BACKUP_KEY}" "$LOCAL_FILE" --endpoint-url "$BACKUP_S3_ENDPOINT" --only-show-errors
gunzip "$LOCAL_FILE"
DUMP_FILE="${LOCAL_FILE%.gz}"

pg_db_ensure "$TARGET_DB"
log "Restoring into $TARGET_DB (source: $DB_NAME/$BACKUP_KEY)"
pg_restore -h localhost -p "$PG_PORT" -U postgres -d "$TARGET_DB" --clean --if-exists --no-owner "$DUMP_FILE"
log "Restore complete: $TARGET_DB"
