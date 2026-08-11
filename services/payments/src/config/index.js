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
  sharedSecret: required('PAYMENTS_SHARED_SECRET'),
  encryptionKey: required('PAYMENTS_ENCRYPTION_KEY'),
  ledger: {
    baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080',
    sharedSecret: required('LEDGER_SHARED_SECRET'),
  },
  reconciliation: {
    // Operational tuning, not regulatory policy — doesn't go through
    // services/compliance's versioned-policy machinery.
    pollIntervalMinutes: parseInt(process.env.RECONCILIATION_POLL_INTERVAL_MINUTES || '5', 10),
    staleMinutes: parseInt(process.env.RECONCILIATION_STALE_MINUTES || '15', 10),
    autoRefundMinutes: parseInt(process.env.RECONCILIATION_AUTO_REFUND_MINUTES || '60', 10),
  },
};
