class TrustPayError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class InvalidOtpError extends TrustPayError {
  constructor() {
    super('Invalid or expired code', 'INVALID_OTP', 401);
  }
}

class KYCTierRequiredError extends TrustPayError {
  constructor(requiredTier) {
    super(`This action requires KYC tier ${requiredTier} or higher`, 'KYC_TIER_REQUIRED', 403);
  }
}

class UserNotFoundError extends TrustPayError {
  constructor() {
    super('User not found', 'USER_NOT_FOUND', 404);
  }
}

// Raised when services/compliance's decision endpoints return
// { allowed: false } — a regulatory limit (KYC-tier daily/single-txn cap,
// device-binding cap), not a product-level gate like KYCTierRequiredError.
class ComplianceDeniedError extends TrustPayError {
  constructor(reason) {
    super(reason || 'This action is not allowed', 'COMPLIANCE_DENIED', 403);
  }
}

// Same role as services/payments' ProviderNotImplementedError — a
// provider (identity, or any future one) that hasn't built a given
// method yet rejects loudly instead of silently no-op-ing.
class ProviderNotImplementedError extends TrustPayError {
  constructor(provider, method) {
    super(`Provider "${provider}" does not implement ${method} yet`, 'PROVIDER_NOT_IMPLEMENTED', 501);
  }
}

class InvalidProviderError extends TrustPayError {
  constructor(provider) {
    super(`Unknown identity provider: ${provider}`, 'INVALID_PROVIDER', 400);
  }
}

// Deliberately a generic 404, not 403 — doesn't confirm or deny that a
// card with this id exists at all, just that it isn't one of yours.
class CardNotFoundError extends TrustPayError {
  constructor() {
    super('No card found with that id', 'CARD_NOT_FOUND', 404);
  }
}

module.exports = {
  TrustPayError, InvalidOtpError, KYCTierRequiredError, UserNotFoundError, ComplianceDeniedError,
  ProviderNotImplementedError, InvalidProviderError, CardNotFoundError,
};
