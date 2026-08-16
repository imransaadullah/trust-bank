class GatewayError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class CredentialNotFoundError extends GatewayError {
  constructor(credentialId) {
    super(`No API key found with id ${credentialId}`, 'CREDENTIAL_NOT_FOUND', 404);
  }
}

// Distinct from CredentialNotFoundError — this is the *backend*
// credential (Ledger/Payments/Compliance operate token) a tenant needs
// provisioned before the gateway can call anything on their behalf. See
// deploy/provision-tenant.sh's new step and POST /v1/tenants/:id/backend-credentials.
class TenantBackendCredentialNotFoundError extends GatewayError {
  constructor(tenantId, service) {
    super(
      `Tenant ${tenantId} has no ${service} credential provisioned for the gateway — run provision-tenant.sh or POST /v1/tenants/${tenantId}/backend-credentials`,
      'BACKEND_CREDENTIAL_NOT_FOUND', 424
    );
  }
}

class RateLimitExceededError extends GatewayError {
  constructor(retryAfterSeconds) {
    super(`Rate limit exceeded — retry after ${retryAfterSeconds}s`, 'RATE_LIMIT_EXCEEDED', 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Thrown by backendProxy.js when a circuit breaker is open — the backend
// is failing repeatedly, so this fails fast instead of hanging the
// caller for the breaker's own timeout on every single request.
class BackendUnavailableError extends GatewayError {
  constructor(service) {
    super(`${service} is currently unavailable — try again shortly`, 'BACKEND_UNAVAILABLE', 503);
    this.service = service;
  }
}

module.exports = {
  GatewayError, CredentialNotFoundError, TenantBackendCredentialNotFoundError,
  RateLimitExceededError, BackendUnavailableError,
};
