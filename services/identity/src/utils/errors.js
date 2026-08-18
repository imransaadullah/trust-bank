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
};
