const argon2 = require('argon2');
const { generateSecret, generateURI, verify: verifyTotp } = require('otplib');
const prisma = require('../db/prismaClient');
// Required lazily (inside the functions that actually touch MFA secrets)
// rather than at the top of the file — it transitively requires config.js,
// which requires IDENTITY_ENCRYPTION_KEY to be set. create()/verifyPassword()
// don't need it, and scripts/bootstrapStaffUser.js only ever calls create() —
// an eager top-level require would force that script to need an encryption
// key it never uses. Found live: the bootstrap script failed on
// IDENTITY_ENCRYPTION_KEY being unset before this was fixed.
const {
  InvalidCredentialsError, InvalidMfaCodeError, MfaAlreadyEnrolledError, StaffUserNotFoundError, EmailAlreadyExistsError,
} = require('../utils/errors');

// loan_officer/credit_manager: Phase 3's own architecture-doc language,
// "officer originates, credit manager approves" — added rather than
// overloading teller/branch_manager or compliance_officer, none of which
// were designed for credit decisions.
const ROLES = ['teller', 'branch_manager', 'compliance_officer', 'ops_admin', 'loan_officer', 'credit_manager'];
// Roles that operate across the whole tenant rather than one branch —
// everything else requires a branchId. credit_manager is tenant-wide —
// centralized underwriting is the more common real-bank shape;
// loan_officer stays branch-scoped, like teller/branch_manager.
const TENANT_WIDE_ROLES = ['ops_admin', 'compliance_officer', 'credit_manager'];

/** Used by the bootstrap script and any future staff-management route. */
async function create({ tenantId, email, password, role, branchId }) {
  if (!ROLES.includes(role)) {
    throw new Error(`staffUserService: role must be one of ${ROLES.join(', ')}`);
  }
  if (!branchId && !TENANT_WIDE_ROLES.includes(role)) {
    throw new Error(`staffUserService: role '${role}' requires a branchId`);
  }
  const existing = await prisma.staffUser.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (existing) throw new EmailAlreadyExistsError(email);

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.staffUser.create({
    data: { tenantId, email, passwordHash, role, branchId: branchId || null },
  });
}

/** @returns the StaffUser row if the password matches, throws otherwise. */
async function verifyPassword({ tenantId, email, password }) {
  const staff = await prisma.staffUser.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (!staff || staff.status !== 'active') throw new InvalidCredentialsError();

  const valid = await argon2.verify(staff.passwordHash, password);
  if (!valid) throw new InvalidCredentialsError();

  return staff;
}

/** Starts enrollment: generates and stores a new TOTP secret, not yet active. */
async function beginMfaEnrollment(staffUserId) {
  const mfaSecrets = require('../crypto/mfaSecrets');
  const staff = await prisma.staffUser.findUnique({ where: { id: staffUserId } });
  if (!staff) throw new StaffUserNotFoundError(staffUserId);
  if (staff.mfaEnabled) throw new MfaAlreadyEnrolledError();

  const secret = generateSecret();
  await prisma.staffUser.update({
    where: { id: staffUserId },
    data: { mfaSecret: mfaSecrets.encrypt(secret) },
  });
  const otpauthUri = generateURI({ issuer: 'trust-bank', label: staff.email, secret });
  return { otpauthUri };
}

/** Confirms enrollment with a real code, activates MFA. */
async function confirmMfaEnrollment(staffUserId, code) {
  const mfaSecrets = require('../crypto/mfaSecrets');
  const staff = await prisma.staffUser.findUnique({ where: { id: staffUserId } });
  if (!staff || !staff.mfaSecret) throw new InvalidMfaCodeError();

  const secret = mfaSecrets.decrypt(staff.mfaSecret);
  const result = await verifyTotp({ secret, token: code });
  if (!result.valid) throw new InvalidMfaCodeError();

  return prisma.staffUser.update({
    where: { id: staffUserId },
    data: { mfaEnabled: true, lastLoginAt: new Date() },
  });
}

/** Verifies a TOTP code against an already-enrolled secret (normal login). */
async function verifyMfaCode(staffUserId, code) {
  const mfaSecrets = require('../crypto/mfaSecrets');
  const staff = await prisma.staffUser.findUnique({ where: { id: staffUserId } });
  if (!staff || !staff.mfaEnabled || !staff.mfaSecret) throw new InvalidMfaCodeError();

  const secret = mfaSecrets.decrypt(staff.mfaSecret);
  const result = await verifyTotp({ secret, token: code });
  if (!result.valid) throw new InvalidMfaCodeError();

  await prisma.staffUser.update({ where: { id: staffUserId }, data: { lastLoginAt: new Date() } });
  return staff;
}

async function get(staffUserId) {
  const staff = await prisma.staffUser.findUnique({ where: { id: staffUserId } });
  if (!staff) throw new StaffUserNotFoundError(staffUserId);
  return staff;
}

module.exports = {
  ROLES, TENANT_WIDE_ROLES, create, verifyPassword, beginMfaEnrollment, confirmMfaEnrollment, verifyMfaCode, get,
};
