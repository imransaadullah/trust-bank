class IdentityError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

class InvalidCredentialsError extends IdentityError {
  constructor() {
    super('Invalid email or password', 'INVALID_CREDENTIALS', 401);
  }
}

class MfaChallengeInvalidError extends IdentityError {
  constructor() {
    super('MFA challenge is invalid or has expired — log in again', 'MFA_CHALLENGE_INVALID', 401);
  }
}

class InvalidMfaCodeError extends IdentityError {
  constructor() {
    super('Invalid or expired MFA code', 'INVALID_MFA_CODE', 401);
  }
}

class MfaAlreadyEnrolledError extends IdentityError {
  constructor() {
    super('MFA is already enrolled for this account', 'MFA_ALREADY_ENROLLED', 409);
  }
}

class SessionInvalidError extends IdentityError {
  constructor() {
    super('Session is invalid, expired, or revoked', 'SESSION_INVALID', 401);
  }
}

class StaffUserNotFoundError extends IdentityError {
  constructor(staffUserId) {
    super(`No staff user found with id ${staffUserId}`, 'STAFF_USER_NOT_FOUND', 404);
  }
}

class EmailAlreadyExistsError extends IdentityError {
  constructor(email) {
    super(`A staff user with email ${email} already exists for this tenant`, 'EMAIL_ALREADY_EXISTS', 409);
  }
}

class BranchNotFoundError extends IdentityError {
  constructor(branchId) {
    super(`No branch found with id ${branchId}`, 'BRANCH_NOT_FOUND', 404);
  }
}

// Distinct from the credential-not-found errors above — this is the
// *backend* credential (Ledger/Compliance operate token) this service
// needs to actually execute an approved action on a tenant's behalf. See
// deploy/provision-tenant.sh's bootstrap_identity_backend_credentials.
class TenantBackendCredentialNotFoundError extends IdentityError {
  constructor(tenantId, service) {
    super(
      `Tenant ${tenantId} has no ${service} credential provisioned for identity — run provision-tenant.sh or scripts/storeTenantBackendCredential.js`,
      'BACKEND_CREDENTIAL_NOT_FOUND', 424,
    );
  }
}

class ApprovalRequestNotFoundError extends IdentityError {
  constructor(id) {
    super(`No approval request found with id ${id}`, 'APPROVAL_REQUEST_NOT_FOUND', 404);
  }
}

class InvalidActionTypeError extends IdentityError {
  constructor(actionType, validTypes) {
    super(`actionType must be one of ${validTypes.join(', ')}, got ${actionType}`, 'INVALID_ACTION_TYPE', 400);
  }
}

class ForbiddenActionRoleError extends IdentityError {
  constructor(actionType, allowedRoles) {
    super(`This action requires role: ${allowedRoles.join(' or ')}`, 'FORBIDDEN_ACTION_ROLE', 403);
  }
}

class SelfApprovalError extends IdentityError {
  constructor() {
    super('You cannot approve your own request — segregation of duties requires a different staff member', 'SELF_APPROVAL_FORBIDDEN', 403);
  }
}

class ApprovalNotPendingError extends IdentityError {
  constructor(id, status) {
    super(`Approval request ${id} is '${status}', not 'pending' — it can't be approved or rejected again`, 'APPROVAL_NOT_PENDING', 409);
  }
}

class ApprovalNotFailedError extends IdentityError {
  constructor(id, status) {
    super(`Approval request ${id} is '${status}', not 'failed' — only a failed execution can be retried`, 'APPROVAL_NOT_FAILED', 409);
  }
}

// Thrown after an approved action's backend call fails — the
// ApprovalRequest row is already updated to 'failed' with the real error
// captured before this is thrown; see approvalService.js's runExecution.
class ExecutionFailedError extends IdentityError {
  constructor(message) {
    super(`Execution failed: ${message}`, 'EXECUTION_FAILED', 502);
  }
}

module.exports = {
  IdentityError,
  InvalidCredentialsError,
  MfaChallengeInvalidError,
  InvalidMfaCodeError,
  MfaAlreadyEnrolledError,
  SessionInvalidError,
  StaffUserNotFoundError,
  EmailAlreadyExistsError,
  BranchNotFoundError,
  TenantBackendCredentialNotFoundError,
  ApprovalRequestNotFoundError,
  InvalidActionTypeError,
  ForbiddenActionRoleError,
  SelfApprovalError,
  ApprovalNotPendingError,
  ApprovalNotFailedError,
  ExecutionFailedError,
};
