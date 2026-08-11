class ComplianceError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class NoPolicyConfiguredError extends ComplianceError {
  constructor(kind, tenantId) {
    super(`No ${kind} policy configured for tenant ${tenantId}`, 'NO_POLICY_CONFIGURED', 404);
  }
}

module.exports = { ComplianceError, NoPolicyConfiguredError };
