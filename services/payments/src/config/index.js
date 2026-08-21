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
  port: parseInt(process.env.PORT || '8081', 10),
  // Loopback only by default — never internet-facing. Override to a
  // private/VPN interface IP for a hybrid deployment; never 0.0.0.0.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  encryptionKey: required('PAYMENTS_ENCRYPTION_KEY'),
  ledger: {
    baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080',
    // No shared/global API key here — each call uses the calling
    // tenant's own operate-scope Ledger credential, stored encrypted
    // per-tenant (TenantLedgerCredential, see
    // src/services/tenantLedgerCredentialService.js). Stored via
    // POST /v1/tenants/:tenantId/ledger-credential, provisioned by
    // deploy/provision-tenant.sh.
  },
  reconciliation: {
    // Operational tuning, not regulatory policy — doesn't go through
    // services/compliance's versioned-policy machinery.
    pollIntervalMinutes: parseInt(process.env.RECONCILIATION_POLL_INTERVAL_MINUTES || '5', 10),
    staleMinutes: parseInt(process.env.RECONCILIATION_STALE_MINUTES || '15', 10),
    autoRefundMinutes: parseInt(process.env.RECONCILIATION_AUTO_REFUND_MINUTES || '60', 10),
  },
  // A separate job from the above, against BillPaymentAttempt/
  // TenantBillsProviderConfig rather than SettlementAttempt/
  // TenantProviderConfig — own config block even though the defaults
  // happen to match, since they're tuning different tables.
  billsReconciliation: {
    pollIntervalMinutes: parseInt(process.env.BILLS_RECONCILIATION_POLL_INTERVAL_MINUTES || '5', 10),
    staleMinutes: parseInt(process.env.BILLS_RECONCILIATION_STALE_MINUTES || '15', 10),
    autoRefundMinutes: parseInt(process.env.BILLS_RECONCILIATION_AUTO_REFUND_MINUTES || '60', 10),
  },
  // mTLS (Phase 6) — opt-in, off by default. See src/tls/mtls.js.
  mtls: {
    enabled: process.env.MTLS_ENABLED === 'true',
    certFile: process.env.MTLS_CERT_FILE,
    keyFile: process.env.MTLS_KEY_FILE,
    caFile: process.env.MTLS_CA_FILE,
  },
};
