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
  port: parseInt(process.env.PORT || '8084', 10),
  // Loopback by default like every other service — but this is the one
  // meant to eventually sit behind Caddy as a *second* public entry
  // point alongside trustpay-backend (external bank developers, not
  // TrustPay's own consumer app). See deploy/NETWORK_TOPOLOGY.md.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  // Encrypts TenantBackendCredential.encryptedToken at rest — see
  // src/crypto/tenantBackendCredentials.js. Unlike trustpay-backend
  // (single-tenant, credentials live in its own .env), the gateway is
  // multi-tenant and stores a Ledger/Payments/Compliance operate
  // credential per tenant in its own DB, so it needs this the same way
  // Payments needs PAYMENTS_ENCRYPTION_KEY.
  encryptionKey: required('GATEWAY_ENCRYPTION_KEY'),
  // Base URLs only — no shared API key here. Each backend call carries
  // the *calling tenant's own* operate credential, decrypted per-request
  // from TenantBackendCredential, not a single credential this service
  // holds for everyone.
  ledger: { baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080' },
  payments: { baseUrl: process.env.PAYMENTS_SERVICE_URL || 'http://localhost:8081' },
  compliance: { baseUrl: process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:8083' },
  cards: { baseUrl: process.env.CARDS_SERVICE_URL || 'http://localhost:8086' },
  // Circuit breaker tuning — one breaker per backend service
  // (src/services/backendProxy.js), so Ledger trouble doesn't trip
  // Payments' or Compliance's.
  circuitBreaker: {
    timeoutMs: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS || '10000', 10),
    errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE || '50', 10),
    resetTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || '15000', 10),
    // opossum's own default is 0 — meaning a single failing request (100%
    // of 1) already exceeds errorThresholdPercentage and opens the
    // circuit for every caller. Caught live: a lone connection-refused
    // blip tripped the breaker on the very first request. Require a
    // small minimum sample first, so one transient failure doesn't take
    // a whole backend offline for everyone.
    volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '5', 10),
  },
  // mTLS (Phase 6) — opt-in, off by default. See src/tls/mtls.js.
  mtls: {
    enabled: process.env.MTLS_ENABLED === 'true',
    certFile: process.env.MTLS_CERT_FILE,
    keyFile: process.env.MTLS_KEY_FILE,
    caFile: process.env.MTLS_CA_FILE,
  },
};
