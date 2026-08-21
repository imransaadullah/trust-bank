require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`config: ${name} is required`);
  }
  return value;
}

// setInterval/setTimeout silently overflow past ~24.8 days (2^31-1 ms, a
// 32-bit signed int internally) and fire almost immediately instead of
// waiting — not a documented error, just wrong behavior. Caught live
// during this feature's own verification: an intentionally-huge test
// value turned the sanctions-feed runner into a tight loop hammering
// OFAC/UN/Nigeria's real servers. Clamping here means any hours-based
// polling interval in this config is safe to feed straight into
// setInterval, not just the one it was caught on.
// 2^31-1 ms / 3,600,000 ms-per-hour = 596.5h, so 720 (30 days) would
// still overflow — confirmed live after first writing this with the
// wrong number. 500h leaves real margin under the actual ~596h ceiling.
const MAX_SAFE_POLL_HOURS = 500;
function clampPollHours(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_SAFE_POLL_HOURS);
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8083', 10),
  // Loopback only by default — never internet-facing. Override to a
  // private/VPN interface IP for a hybrid deployment; never 0.0.0.0.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  // Operational tuning, not regulatory policy — same reasoning as
  // Payments' reconciliation block. A sanctions list doesn't need
  // minute-level freshness.
  sanctionsFeed: {
    pollIntervalHours: clampPollHours(process.env.SANCTIONS_FEED_POLL_INTERVAL_HOURS, 24),
  },
  // mTLS (Phase 6) — opt-in, off by default. See src/tls/mtls.js.
  mtls: {
    enabled: process.env.MTLS_ENABLED === 'true',
    certFile: process.env.MTLS_CERT_FILE,
    keyFile: process.env.MTLS_KEY_FILE,
    caFile: process.env.MTLS_CA_FILE,
  },
};
