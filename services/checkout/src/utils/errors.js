class CheckoutError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ProviderNotImplementedError extends CheckoutError {
  constructor(provider, method) {
    super(`Provider "${provider}" does not implement ${method} yet`, 'PROVIDER_NOT_IMPLEMENTED', 501);
  }
}

class TenantNotConfiguredError extends CheckoutError {
  constructor(tenantId) {
    super(`No checkout provider configured for tenant ${tenantId}`, 'TENANT_NOT_CONFIGURED', 404);
  }
}

class InvalidProviderError extends CheckoutError {
  constructor(provider) {
    super(`Unknown checkout provider: ${provider}`, 'INVALID_PROVIDER', 400);
  }
}

class WebhookVerificationError extends CheckoutError {
  constructor(message) {
    super(message || 'Webhook signature verification failed', 'WEBHOOK_VERIFICATION_FAILED', 401);
  }
}

class CredentialNotFoundError extends CheckoutError {
  constructor(credentialId) {
    super(`No credential found with id ${credentialId}`, 'CREDENTIAL_NOT_FOUND', 404);
  }
}

class TenantLedgerCredentialNotFoundError extends CheckoutError {
  constructor(tenantId) {
    super(
      `No Ledger credential stored for tenant ${tenantId} — Checkout can't call the Ledger on this tenant's behalf until one is stored via POST /v1/tenants/:tenantId/ledger-credential`,
      'TENANT_LEDGER_CREDENTIAL_NOT_FOUND',
      424,
    );
  }
}

class MerchantNotFoundError extends CheckoutError {
  constructor(merchantId) {
    super(`No merchant found with id ${merchantId}`, 'MERCHANT_NOT_FOUND', 404);
  }
}

class CheckoutSessionNotFoundError extends CheckoutError {
  constructor(sessionId) {
    super(`No checkout session found with id ${sessionId}`, 'CHECKOUT_SESSION_NOT_FOUND', 404);
  }
}

class CheckoutSessionNotCancellableError extends CheckoutError {
  constructor(sessionId, status) {
    super(`Checkout session ${sessionId} is ${status}, not pending/processing`, 'CHECKOUT_SESSION_NOT_CANCELLABLE', 409);
  }
}

// Thrown by requireMerchantAuth (via merchantSessionService.verify) when a
// mch_live_ token fails verification — mirrors Identity's own
// SessionInvalidError and Gateway's own GatewaySessionInvalidError.
class MerchantSessionInvalidError extends CheckoutError {
  constructor() {
    super('Invalid or expired session', 'SESSION_INVALID', 401);
  }
}

// Thrown when an OTP verifies successfully against the auth provider but
// doesn't resolve to a real, active Merchant for this tenant — a verified
// email with no matching merchant account isn't authorized for a
// dashboard, distinct from a wrong/expired code (which the provider
// itself rejects before this is ever reached).
class MerchantAuthInvalidError extends CheckoutError {
  constructor() {
    super('No active merchant account found for this email', 'MERCHANT_AUTH_INVALID', 403);
  }
}

module.exports = {
  CheckoutError,
  ProviderNotImplementedError,
  TenantNotConfiguredError,
  InvalidProviderError,
  WebhookVerificationError,
  CredentialNotFoundError,
  TenantLedgerCredentialNotFoundError,
  MerchantNotFoundError,
  CheckoutSessionNotFoundError,
  CheckoutSessionNotCancellableError,
  MerchantSessionInvalidError,
  MerchantAuthInvalidError,
};
