require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`config: ${name} is required`);
  }
  return value;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8087', 10),
  // Loopback only — never internet-facing. Only /pay/* and
  // /v1/webhooks/* are ever reachable from outside this box, and only
  // via their own path-scoped Caddy site block (deploy/Caddyfile.example,
  // deploy/NETWORK_TOPOLOGY.md) — never 0.0.0.0 here.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  encryptionKey: required('CHECKOUT_ENCRYPTION_KEY'),
  // The externally reachable origin for the hosted pay page and inbound
  // webhooks — what a provider's callback_url/webhook URL, and this
  // service's own Noop /simulate links, get built from. Not the same as
  // bindHost:port, which is loopback-only.
  publicBaseUrl: process.env.CHECKOUT_PUBLIC_BASE_URL || 'http://localhost:8087',
  ledger: {
    baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080',
    // No shared/global API key — each call uses this tenant's own
    // operate-scope Ledger credential, stored encrypted per-tenant
    // (TenantLedgerCredential, src/services/tenantLedgerCredentialService.js),
    // provisioned by deploy/provision-tenant.sh.
  },
  merchantWebhook: {
    pollIntervalSeconds: parseInt(process.env.MERCHANT_WEBHOOK_POLL_INTERVAL_SECONDS || '5', 10),
    batchSize: parseInt(process.env.MERCHANT_WEBHOOK_BATCH_SIZE || '20', 10),
  },
  checkoutSession: {
    // How long an unpaid session's hosted page stays live before it
    // lazily flips to 'expired' on next read.
    defaultExpiryMinutes: parseInt(process.env.CHECKOUT_SESSION_DEFAULT_EXPIRY_MINUTES || '30', 10),
  },
  // Merchant-dashboard login (services/checkout/admin-console) — a single,
  // shared auth-provider choice across every tenant's merchants, not a
  // per-tenant config: AuthCore is one shared account (the same one
  // trustpay-backend already uses), and tenant isolation is enforced by
  // always resolving a Merchant via {tenantId, email}, never by email
  // alone (see providers/authProviders/registry.js). Defaults to 'noop'
  // so a fresh checkout of this repo boots without real AuthCore
  // credentials — a real deployment sets AUTH_PROVIDER=authcore.
  authProvider: {
    name: process.env.AUTH_PROVIDER || 'noop',
    // AuthCore-specific — optional at boot (only 'noop' needs to work
    // without them), required lazily by AuthCoreProvider itself the
    // first time a real request needs them, same "optional at config-
    // load, load-bearing on first real use" shape AUTHCORE_JWKS_URL
    // already has in trustpay-backend's own config.
    baseUrl: process.env.AUTHCORE_BASE_URL || 'https://authcore.akoti.com.ng',
    projectKey: process.env.AUTHCORE_PROJECT_KEY,
    jwksUrl: process.env.AUTHCORE_JWKS_URL,
    projectId: process.env.AUTHCORE_PROJECT_ID,
  },
  merchantSession: {
    // Same 30-minute sliding idle default as Identity's StaffSession and
    // Gateway's GatewaySession — a consistent UX across every console in
    // this platform rather than a coincidence worth diverging on.
    idleTimeoutMinutes: parseInt(process.env.MERCHANT_SESSION_IDLE_TIMEOUT_MINUTES || '30', 10),
  },
  // mTLS (Phase 6) — opt-in, off by default. See src/tls/mtls.js.
  mtls: {
    enabled: process.env.MTLS_ENABLED === 'true',
    certFile: process.env.MTLS_CERT_FILE,
    keyFile: process.env.MTLS_KEY_FILE,
    caFile: process.env.MTLS_CA_FILE,
  },
};
