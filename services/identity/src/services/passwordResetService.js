// Self-service forgot-password: request() emails a token (via the
// configured EmailProvider — see providers/registry.js), confirm()
// redeems it. Same shown-once/hashed/prefix-indexed shape as
// staffSessionService.js's own session tokens.
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { getEmailProvider } = require('../providers/registry');
const staffUserService = require('./staffUserService');
const staffSessionService = require('./staffSessionService');
const { PasswordResetTokenInvalidError, WeakPasswordError } = require('../utils/errors');

const TOKEN_PREFIX_LABEL = 'prt_live_';
const MIN_PASSWORD_LENGTH = 12;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newExpiry() {
  return new Date(Date.now() + config.email.resetTokenTtlMinutes * 60 * 1000);
}

// Always resolves the same way regardless of whether the email exists —
// no enumeration signal. Only actually creates a token and emails it if
// a matching, active staff user is found.
async function request({ tenantId, email }) {
  const staff = await prisma.staffUser.findUnique({ where: { tenantId_email: { tenantId, email } } });
  if (staff && staff.status === 'active') {
    const randomHex = crypto.randomBytes(32).toString('hex');
    const token = TOKEN_PREFIX_LABEL + randomHex;
    const tokenPrefix = TOKEN_PREFIX_LABEL + randomHex.slice(0, 12);
    const hashedToken = hashToken(token);

    await prisma.passwordResetToken.create({
      data: { staffUserId: staff.id, tokenPrefix, hashedToken, expiresAt: newExpiry() },
    });

    await getEmailProvider().sendPasswordResetEmail({
      to: staff.email, resetToken: token, expiresInMinutes: config.email.resetTokenTtlMinutes,
    });
  }
  return { requested: true };
}

async function confirm({ token, newPassword }) {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(MIN_PASSWORD_LENGTH);
  }
  if (!token || token.length < TOKEN_PREFIX_LABEL.length + 12) throw new PasswordResetTokenInvalidError();
  const prefix = token.slice(0, TOKEN_PREFIX_LABEL.length + 12);

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenPrefix: prefix } });
  if (!resetToken) throw new PasswordResetTokenInvalidError();

  const hashed = Buffer.from(hashToken(token));
  const stored = Buffer.from(resetToken.hashedToken);
  if (hashed.length !== stored.length || !crypto.timingSafeEqual(hashed, stored)) {
    throw new PasswordResetTokenInvalidError();
  }
  if (resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
    throw new PasswordResetTokenInvalidError();
  }

  await staffUserService.updatePassword({ staffUserId: resetToken.staffUserId, newPassword });
  await prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } });
  await staffSessionService.revokeAllForStaffUser(resetToken.staffUserId);

  return { reset: true };
}

module.exports = { request, confirm };
