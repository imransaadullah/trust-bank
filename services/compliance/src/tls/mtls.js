// The capability behind Phase 6's mTLS item
// (CORE_BANKING_PLATFORM_ARCHITECTURE.md). Opt-in: on the default
// loopback-only SaaS topology this defends against nothing, so both
// functions below return a falsy default (null/undefined) unless
// MTLS_ENABLED/cert paths are explicitly configured — every existing
// server-start and outbound-call call site stays exactly as it was.
// Only worth turning on for a real hybrid deployment where a caller
// genuinely crosses an untrusted network — see deploy/NETWORK_TOPOLOGY.md.
const fs = require('fs');
const https = require('https');
const config = require('../config');

/** Returns null if MTLS_ENABLED isn't 'true' — the caller's signal to use plain app.listen(). */
function getServerOptions() {
  if (!config.mtls.enabled) return null;
  return {
    cert: fs.readFileSync(config.mtls.certFile),
    key: fs.readFileSync(config.mtls.keyFile),
    ca: fs.readFileSync(config.mtls.caFile),
    requestCert: true,
    rejectUnauthorized: true,
  };
}

// Client-cert presentation is independent of getServerOptions() above — a
// service can call another with a cert without requiring one on its own
// inbound side. The target server decides whether to require and verify it.
let cachedAgent;
function getHttpsAgent() {
  if (!config.mtls.certFile || !config.mtls.keyFile) return undefined;
  if (cachedAgent) return cachedAgent;
  cachedAgent = new https.Agent({
    cert: fs.readFileSync(config.mtls.certFile),
    key: fs.readFileSync(config.mtls.keyFile),
    ca: config.mtls.caFile ? fs.readFileSync(config.mtls.caFile) : undefined,
  });
  return cachedAgent;
}

module.exports = { getServerOptions, getHttpsAgent };
