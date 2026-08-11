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

module.exports = { TrustPayError, InvalidOtpError, KYCTierRequiredError, UserNotFoundError, ComplianceDeniedError };
