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
};
