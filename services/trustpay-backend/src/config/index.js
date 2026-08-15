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
  // Loopback only by default, even though this is the public-facing
  // service — a reverse proxy (see deploy/Caddyfile.example) terminates
  // TLS and is the only process that binds a public interface. Override
  // to a private/VPN interface IP only for a split hybrid deployment.
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  // The same tenant id everywhere — this backend is always exactly one
  // tenant, registered once on the Ledger (POST /v1/tenants) and
  // configured once on Payments (POST /v1/tenants/:id/config). Kept as a
  // single value rather than one per client so it can't drift between them.
  tenantId: required('TENANT_ID'),
  jwt: {
    secret: required('TRUSTPAY_JWT_SECRET'),
    expiry: process.env.TRUSTPAY_JWT_EXPIRY || '7d',
  },
  // A single deploy-time choice, same as tenantId — see
  // src/identity/registry.js. 'authcore' is the only real
  // implementation (Nigeria); 'twilio_verify' is an interface-proven
  // stub, not built, because no second market exists to build it for yet.
  identityProvider: process.env.IDENTITY_PROVIDER || 'authcore',
  authCore: {
    baseUrl: process.env.AUTHCORE_BASE_URL || 'https://authcore.akoti.com.ng',
    projectKey: required('AUTHCORE_PROJECT_KEY'),
    jwksUrl: process.env.AUTHCORE_JWKS_URL,
    projectId: process.env.AUTHCORE_PROJECT_ID,
  },
  // Operate-scope credentials for each upstream service, issued via that
  // service's cmd/bootstrap-key or POST /v1/tenants/:id/credentials — see
  // SERVICE_CREDENTIAL_MODEL.md (repo root). No longer shared secrets.
  ledger: {
    baseUrl: process.env.LEDGER_SERVICE_URL || 'http://localhost:8080',
    apiKey: required('LEDGER_API_KEY'),
  },
  payments: {
    baseUrl: process.env.PAYMENTS_SERVICE_URL || 'http://localhost:8081',
    apiKey: required('PAYMENTS_API_KEY'),
  },
  compliance: {
    baseUrl: process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:8083',
    apiKey: required('COMPLIANCE_API_KEY'),
  },
};
