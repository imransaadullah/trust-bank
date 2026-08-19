require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`config: ${name} is required`);
  }
  return value;
}

// Same overflow this codebase has already been bitten by once —
// services/compliance/src/config/index.js's clampPollHours, caught live
// when an intentionally-huge test value turned a runner into a tight
// loop (setInterval/setTimeout silently overflow past ~24.8 days, a
// 32-bit signed ms count internally). 30,000 minutes = 500 hours, the
// same real margin compliance's own clamp uses.
const MAX_SAFE_POLL_MINUTES = 30_000;
function clampPollMinutes(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_SAFE_POLL_MINUTES);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8085', 10),
  // Loopback only — internal back-office tooling, never internet-facing,
  // not fronted by Caddy the way the gateway is (see deploy/NETWORK_TOPOLOGY.md).
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  // 32-byte key, hex-encoded. Encrypts each staff user's TOTP secret at
  // rest — same AES-256-GCM pattern as PAYMENTS_ENCRYPTION_KEY/
  // GATEWAY_ENCRYPTION_KEY. Generate with: openssl rand -hex 32
  encryptionKey: required('IDENTITY_ENCRYPTION_KEY'),
  session: {
    // Architecture doc section 7: "session timeouts tuned for a banking
    // back-office — short." A sliding idle timeout, extended on every
    // authenticated request (see staffSessionService.touch), not a fixed
    // absolute expiry.
    idleTimeoutMinutes: parseInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES || '30', 10),
    // How long an MFA challenge (the gap between password verification
    // and a valid TOTP code) stays valid before the caller has to log in
    // again from scratch.
    mfaChallengeTtlMinutes: parseInt(process.env.MFA_CHALLENGE_TTL_MINUTES || '5', 10),
  },
  // The two backends this service executes approved actions against — no
  // shared API key here, each call uses this tenant's own stored operate
  // credential (src/services/tenantBackendCredentialService.js).
  ledger: { baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080' },
  compliance: { baseUrl: process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:8083' },
  // src/services/delinquencyRunner.js — a process-internal periodic job,
  // same shape as services/payments' reconciliationRunner.js.
  delinquency: {
    pollIntervalMinutes: clampPollMinutes(process.env.DELINQUENCY_POLL_INTERVAL_MINUTES, 60),
  },
  // src/services/creditBureauRunner.js — same shape as delinquency above.
  // Real bureau reporting is typically monthly, but a literal 30-day
  // interval isn't safely expressible via setInterval (see
  // MAX_SAFE_POLL_MINUTES); ticks daily instead since nothing real is
  // submitted yet — a real provider owns its own submission cadence.
  creditBureau: {
    pollIntervalMinutes: clampPollMinutes(process.env.CREDIT_BUREAU_POLL_INTERVAL_MINUTES, 1440),
  },
};
