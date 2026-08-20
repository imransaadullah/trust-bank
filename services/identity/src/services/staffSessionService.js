// Same shown-once/hashed/indexed-prefix shape as every other credential
// in this platform (SERVICE_CREDENTIAL_MODEL.md), but short-lived with a
// sliding idle timeout instead of a fixed long life — see
// config.session.idleTimeoutMinutes and touch() below.
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { SessionInvalidError } = require('../utils/errors');

const TOKEN_PREFIX_LABEL = 'stf_live_';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newExpiry() {
  return new Date(Date.now() + config.session.idleTimeoutMinutes * 60 * 1000);
}

async function issue(staffUserId) {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const token = TOKEN_PREFIX_LABEL + randomHex;
  const tokenPrefix = TOKEN_PREFIX_LABEL + randomHex.slice(0, 12);
  const hashedToken = hashToken(token);

  const session = await prisma.staffSession.create({
    data: { staffUserId, tokenPrefix, hashedToken, expiresAt: newExpiry() },
  });
  return { session, token };
}

/** @returns {Promise<{session, staff}>} the session + its staff user, with a slid-forward expiry. */
async function verify(token) {
  if (!token || token.length < TOKEN_PREFIX_LABEL.length + 12) throw new SessionInvalidError();
  const prefix = token.slice(0, TOKEN_PREFIX_LABEL.length + 12);

  const session = await prisma.staffSession.findUnique({
    where: { tokenPrefix: prefix },
    include: { staffUser: { include: { branch: true } } },
  });
  if (!session) throw new SessionInvalidError();

  const hashed = Buffer.from(hashToken(token));
  const stored = Buffer.from(session.hashedToken);
  if (hashed.length !== stored.length || !crypto.timingSafeEqual(hashed, stored)) throw new SessionInvalidError();
  if (session.status !== 'active') throw new SessionInvalidError();
  if (session.expiresAt.getTime() < Date.now()) throw new SessionInvalidError();
  if (session.staffUser.status !== 'active') throw new SessionInvalidError();

  const updated = await prisma.staffSession.update({
    where: { id: session.id },
    data: { expiresAt: newExpiry(), lastActivityAt: new Date() },
  });

  return { session: updated, staff: session.staffUser };
}

async function revoke(sessionId) {
  await prisma.staffSession.updateMany({
    where: { id: sessionId, status: 'active' },
    data: { status: 'revoked' },
  });
}

/**
 * Called after any password change — a reset or admin-initiated change
 * kills every session; a self-service change-password kills every
 * session except the one making the request (exceptSessionId).
 */
async function revokeAllForStaffUser(staffUserId, { exceptSessionId } = {}) {
  await prisma.staffSession.updateMany({
    where: {
      staffUserId, status: 'active',
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { status: 'revoked' },
  });
}

module.exports = { issue, verify, revoke, revokeAllForStaffUser };
