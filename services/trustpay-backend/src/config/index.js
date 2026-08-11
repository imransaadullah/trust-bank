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
  port: parseInt(process.env.PORT || '8082', 10),
  // The same tenant id everywhere — this backend is always exactly one
  // tenant, registered once on the Ledger (POST /v1/tenants) and
  // configured once on Payments (POST /v1/tenants/:id/config). Kept as a
  // single value rather than one per client so it can't drift between them.
  tenantId: required('TENANT_ID'),
  jwt: {
    secret: required('TRUSTPAY_JWT_SECRET'),
    expiry: process.env.TRUSTPAY_JWT_EXPIRY || '7d',
  },
  authCore: {
    baseUrl: process.env.AUTHCORE_BASE_URL || 'https://authcore.akoti.com.ng',
    projectKey: required('AUTHCORE_PROJECT_KEY'),
    jwksUrl: process.env.AUTHCORE_JWKS_URL,
    projectId: process.env.AUTHCORE_PROJECT_ID,
  },
  ledger: {
    baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080',
    sharedSecret: required('LEDGER_SHARED_SECRET'),
  },
  payments: {
    baseUrl: process.env.PAYMENTS_SERVICE_URL || 'http://localhost:8081',
    sharedSecret: required('PAYMENTS_SHARED_SECRET'),
  },
};
