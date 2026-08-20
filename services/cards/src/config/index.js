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
  port: parseInt(process.env.PORT || '8086', 10),
  // Loopback only — never internet-facing. Override to a private/VPN
  // interface IP for a hybrid deployment; never 0.0.0.0.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  encryptionKey: required('CARDS_ENCRYPTION_KEY'),
  ledger: {
    baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080',
    // No shared/global API key — each call uses this tenant's own
    // operate-scope Ledger credential, stored encrypted per-tenant
    // (TenantLedgerCredential, src/services/tenantLedgerCredentialService.js),
    // provisioned by deploy/provision-tenant.sh.
  },
};
