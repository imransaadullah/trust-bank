class PaymentsError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class TenantNotConfiguredError extends PaymentsError {
  constructor(tenantId) {
    super(`No provider configured for tenant ${tenantId}`, 'TENANT_NOT_CONFIGURED', 404);
  }
}

class ProviderNotImplementedError extends PaymentsError {
  constructor(provider, method) {
    super(`Provider "${provider}" does not implement ${method} yet`, 'PROVIDER_NOT_IMPLEMENTED', 501);
  }
}

class WebhookVerificationError extends PaymentsError {
  constructor(message) {
    super(message || 'Webhook signature verification failed', 'WEBHOOK_VERIFICATION_FAILED', 401);
  }
}

class InvalidProviderError extends PaymentsError {
  constructor(provider) {
    super(`Unknown provider: ${provider}`, 'INVALID_PROVIDER', 400);
  }
}

module.exports = {
  PaymentsError,
  TenantNotConfiguredError,
  ProviderNotImplementedError,
  WebhookVerificationError,
  InvalidProviderError,
};
