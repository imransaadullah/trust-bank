// Same shown-once/hashed/indexed-prefix shape as every other credential
// in this platform, and structurally identical to Identity's own
// staffSessionService.js (sliding idle expiry) — see GatewaySession's
// schema comment for why this is a separate table/lifecycle rather than
// reusing Identity's StaffSession directly.
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { GatewaySessionInvalidError } = require('../utils/errors');

const TOKEN_PREFIX_LABEL = 'gws_live_';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newExpiry() {
  return new Date(Date.now() + config.gatewaySession.idleTimeoutMinutes * 60 * 1000);
}

async function issue({ tenantId, staffUserId, staffEmail }) {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const token = TOKEN_PREFIX_LABEL + randomHex;
  const tokenPrefix = TOKEN_PREFIX_LABEL + randomHex.slice(0, 12);
  const hashedToken = hashToken(token);

  const session = await prisma.gatewaySession.create({
    data: { tenantId, staffUserId, staffEmail, tokenPrefix, hashedToken, expiresAt: newExpiry() },
  });
  return { session, token };
}

/** @returns {Promise<GatewaySession>} the session, with a slid-forward expiry. */
async function verify(token) {
  if (!token || token.length < TOKEN_PREFIX_LABEL.length + 12) throw new GatewaySessionInvalidError();
  const prefix = token.slice(0, TOKEN_PREFIX_LABEL.length + 12);

  const session = await prisma.gatewaySession.findUnique({ where: { tokenPrefix: prefix } });
  if (!session) throw new GatewaySessionInvalidError();

  const hashed = Buffer.from(hashToken(token));
  const stored = Buffer.from(session.hashedToken);
  if (hashed.length !== stored.length || !crypto.timingSafeEqual(hashed, stored)) throw new GatewaySessionInvalidError();
  if (session.status !== 'active') throw new GatewaySessionInvalidError();
  if (session.expiresAt.getTime() < Date.now()) throw new GatewaySessionInvalidError();

  return prisma.gatewaySession.update({
    where: { id: session.id },
    data: { expiresAt: newExpiry(), lastActivityAt: new Date() },
  });
}

async function revoke(sessionId) {
  await prisma.gatewaySession.updateMany({
    where: { id: sessionId, status: 'active' },
    data: { status: 'revoked' },
  });
}

/** Is this token recognizable as a GatewaySession at all (vs. a gw_live_ ApiKey)? */
function isSessionToken(token) {
  return typeof token === 'string' && token.startsWith(TOKEN_PREFIX_LABEL);
}

module.exports = { issue, verify, revoke, isSessionToken, TOKEN_PREFIX_LABEL };
