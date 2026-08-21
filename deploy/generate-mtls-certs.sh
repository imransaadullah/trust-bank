#!/usr/bin/env bash
# Generates an internal, self-signed CA plus one leaf certificate per
# service — the capability behind Phase 6's mTLS item
# (CORE_BANKING_PLATFORM_ARCHITECTURE.md). Opt-in: nothing in the
# platform requires these certs to exist or be configured; a service
# only serves/dials with mTLS once MTLS_ENABLED=true points it at the
# files this script produces. Never leaves the operator's own machines —
# no public CA trust needed, purely for service-to-service identity.
#
# Idempotent per file, same caching discipline as provision-tenant.sh:
# reruns skip anything that already exists rather than regenerating
# (regenerating would invalidate every other service's copy of the CA
# cert it already trusts). Delete a specific file under $SECRETS_DIR/mtls
# to force that one piece to regenerate.
#
# What this deliberately does NOT do: automated rotation or revocation
# checking (CRL/OCSP) — same reasoning NETWORK_TOPOLOGY.md's own mTLS
# section already gave for deferring this: real PKI lifecycle management
# is ongoing operational burden not worth carrying before a real hybrid
# deployment needs it. Leaf certs are 1-year validity; rotate by rerunning
# after deleting the specific <service>.crt/.key you want renewed.
#
# Usage: ./generate-mtls-certs.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_cmd openssl "install it — part of every standard Linux/macOS toolchain"

MTLS_DIR="$SECRETS_DIR/mtls"
mkdir -p "$MTLS_DIR" && chmod 700 "$MTLS_DIR"

SERVICES=(ledger payments compliance identity cards gateway trustpay-backend)

CA_KEY="$MTLS_DIR/ca.key"
CA_CRT="$MTLS_DIR/ca.crt"

if [ -f "$CA_CRT" ]; then
  log "Internal CA already exists at $CA_CRT — reusing"
else
  log "Generating internal CA (10-year validity, never leaves this box)"
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout "$CA_KEY" -out "$CA_CRT" \
    -subj "/O=trust-bank internal/CN=trust-bank internal CA" >/dev/null 2>&1
  chmod 600 "$CA_KEY"
  chmod 644 "$CA_CRT"
fi

for svc in "${SERVICES[@]}"; do
  KEY="$MTLS_DIR/$svc.key"
  CRT="$MTLS_DIR/$svc.crt"
  CSR="$MTLS_DIR/$svc.csr"

  if [ -f "$CRT" ]; then
    log "$svc: certificate already exists at $CRT — reusing"
    continue
  fi

  log "Issuing certificate for $svc (1-year validity)"
  openssl req -newkey rsa:2048 -sha256 -nodes \
    -keyout "$KEY" -out "$CSR" \
    -subj "/O=trust-bank internal/CN=$svc" >/dev/null 2>&1
  openssl x509 -req -in "$CSR" -CA "$CA_CRT" -CAkey "$CA_KEY" -CAcreateserial \
    -days 365 -sha256 -out "$CRT" >/dev/null 2>&1
  rm -f "$CSR"
  chmod 600 "$KEY"
  chmod 644 "$CRT"
done

cat <<EOF

Done. Certificates under $MTLS_DIR:
  ca.crt                     the internal CA — every service's MTLS_CA_FILE
  <service>.crt/.key         each service's own leaf cert/key

Nothing is active yet — mTLS stays off until a service's .env sets:
  MTLS_ENABLED=true
  MTLS_CERT_FILE=$MTLS_DIR/<service>.crt
  MTLS_KEY_FILE=$MTLS_DIR/<service>.key
  MTLS_CA_FILE=$MTLS_DIR/ca.crt

Turn this on for whichever services actually cross an untrusted network
in a real hybrid deployment (NETWORK_TOPOLOGY.md) — leave it off for the
default single-box SaaS topology, where it defends against nothing.
EOF
