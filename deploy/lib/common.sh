#!/usr/bin/env bash
# Shared helpers for install.sh / provision-tenant.sh. Sourced, not executed
# directly — every script that uses this sets its own `set -euo pipefail`
# first.

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# The one Postgres instance a box runs, per NETWORK_TOPOLOGY.md's SaaS/
# single-VPS model. Override if it's ever not on the default port.
PG_PORT="${PG_PORT:-5432}"

# Where every script in this directory keeps local, never-auto-uploaded
# state — bootstrap tokens, the Postgres superuser password, and (see
# capture_critical_secret below) durable copies of secrets whose loss
# means data loss, not just "regenerate it."
SECRETS_DIR="${SECRETS_DIR:-$HOME/.trustbank}"

# Usage: have_cmd node
have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Usage: require_cmd node "install Node via nvm first"
require_cmd() {
  have_cmd "$1" || die "$1 is required — $2"
}

# Random 32-byte hex secret, same shape every openssl-generated key in this
# repo already uses (PAYMENTS_ENCRYPTION_KEY, ledger_app's password, etc).
gen_secret() { openssl rand -hex 32; }

# Usage: env_file_has KEY /path/to/.env  — true (0) if KEY=<non-empty> is set.
env_file_has() {
  local key="$1" file="$2"
  [ -f "$file" ] && grep -qE "^${key}=.+" "$file"
}

# Usage: env_file_set KEY value /path/to/.env — updates in place if the key
# exists (even if blank), appends otherwise. Never touches other lines.
env_file_set() {
  local key="$1" value="$2" file="$3"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    # `#` is never valid inside a generated secret/token, safe as a sed delimiter here.
    sed -i.bak "s#^${key}=.*#${key}=${value}#" "$file" && rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Usage: capture_critical_secret payments PAYMENTS_ENCRYPTION_KEY "$value"
# Appends to $SECRETS_DIR/critical-secrets.env — the durable copy of any
# secret whose loss isn't just "generate a new one" but "some already-
# encrypted data becomes permanently unreadable" (see deploy/README.md's
# disaster-recovery section). Not auto-uploaded anywhere by this repo's
# own code — deliberately: a key living right next to the ciphertext it
# protects, in the same backup blast radius, defeats the point of it
# being separate. The operator copies this file off-box (a password
# manager, a secrets tool) themselves; this only guarantees it's captured
# in ONE place outside the service's own .env, not that it's durable yet.
capture_critical_secret() {
  local service="$1" key="$2" value="$3"
  local file="$SECRETS_DIR/critical-secrets.env"
  mkdir -p "$SECRETS_DIR" && chmod 700 "$SECRETS_DIR"
  [ -f "$file" ] || { touch "$file"; chmod 600 "$file"; }
  env_file_set "${service}_${key}" "$value" "$file"
}

# Usage: extract_token "$command_output" lgr_live   (prefix, no trailing _)
# The three bootstrap tools (Ledger's cmd/bootstrap-key, Payments'/
# Compliance's scripts/bootstrapKey.js) all print a labeled, human-readable
# block ending in the token on its own indented line — matching on the
# token's own documented prefix (SERVICE_CREDENTIAL_MODEL.md) is far more
# robust than counting lines relative to a label.
extract_token() {
  grep -oE "${2}_[A-Za-z0-9]+" <<<"$1" | head -1
}

# Usage: pg_db_exists dbname
pg_db_exists() {
  sudo -u postgres psql -p "$PG_PORT" -tAc "SELECT 1 FROM pg_database WHERE datname='$1'" | grep -q 1
}

# Usage: pg_db_ensure dbname — creates it if missing, no-op otherwise.
pg_db_ensure() {
  pg_db_exists "$1" || { log "Creating Postgres database $1"; sudo -u postgres createdb -p "$PG_PORT" "$1"; }
}

# Runs an admin psql command against the box's one local Postgres instance
# (peer auth via the postgres OS user) — factored out so anything that
# needs to run superuser SQL goes through one place, same reasoning as
# pg_db_ensure above.
pg_admin_psql() { sudo -u postgres psql -p "$PG_PORT" "$@"; }

# The one shared postgres://postgres:<pw>@localhost:<port> base every TCP
# superuser connection in both scripts builds on — one place to construct
# it instead of each call site hardcoding the port.
pg_superuser_url() { printf 'postgres://postgres:%s@localhost:%s' "$(cat "$1")" "$PG_PORT"; }

# Usage: render_template template.tmpl output.file KEY1=val1 KEY2=val2 ...
# Placeholders in the template look like {{KEY1}}. Every KEY passed must be
# substituted; a leftover {{...}} after substitution is a bug in the caller,
# not something a running service should ever see, so this fails loudly.
render_template() {
  local tmpl="$1" out="$2"; shift 2
  local content
  content="$(cat "$tmpl")"
  for pair in "$@"; do
    local key="${pair%%=*}" val="${pair#*=}"
    content="${content//\{\{$key\}\}/$val}"
  done
  if grep -qE '\{\{[A-Z_]+\}\}' <<<"$content"; then
    die "render_template: $tmpl has unsubstituted placeholder(s) — $(grep -oE '\{\{[A-Z_]+\}\}' <<<"$content" | sort -u | tr '\n' ' ')"
  fi
  printf '%s\n' "$content" > "$out"
}
