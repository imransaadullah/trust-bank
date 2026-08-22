// Same shown-once/hashed/indexed-prefix shape as every other credential
// in this platform, and structurally identical to Identity's own
// StaffSession and Gateway's own GatewaySession — see MerchantSession's
// schema comment for why this is its own table/lifecycle rather than
// reusing either of those directly.
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const config = require('../config');
const { MerchantSessionInvalidError } = require('../utils/errors');

const TOKEN_PREFIX_LABEL = 'mch_live_';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newExpiry() {
  return new Date(Date.now() + config.merchantSession.idleTimeoutMinutes * 60 * 1000);
}

async function issue({ tenantId, merchantId, merchantEmail }) {
  const randomHex = crypto.randomBytes(32).toString('hex');
  const token = TOKEN_PREFIX_LABEL + randomHex;
  const tokenPrefix = TOKEN_PREFIX_LABEL + randomHex.slice(0, 12);
  const hashedToken = hashToken(token);

  const session = await prisma.merchantSession.create({
    data: { tenantId, merchantId, merchantEmail, tokenPrefix, hashedToken, expiresAt: newExpiry() },
  });
  return { session, token };
}

/** @returns {Promise<MerchantSession>} the session, with a slid-forward expiry. */
async function verify(token) {
  if (!token || token.length < TOKEN_PREFIX_LABEL.length + 12) throw new MerchantSessionInvalidError();
  const prefix = token.slice(0, TOKEN_PREFIX_LABEL.length + 12);

  const session = await prisma.merchantSession.findUnique({ where: { tokenPrefix: prefix } });
  if (!session) throw new MerchantSessionInvalidError();

  const hashed = Buffer.from(hashToken(token));
  const stored = Buffer.from(session.hashedToken);
  if (hashed.length !== stored.length || !crypto.timingSafeEqual(hashed, stored)) throw new MerchantSessionInvalidError();
  if (session.status !== 'active') throw new MerchantSessionInvalidError();
  if (session.expiresAt.getTime() < Date.now()) throw new MerchantSessionInvalidError();

  return prisma.merchantSession.update({
    where: { id: session.id },
    data: { expiresAt: newExpiry(), lastActivityAt: new Date() },
  });
}

async function revoke(sessionId) {
  await prisma.merchantSession.updateMany({
    where: { id: sessionId, status: 'active' },
    data: { status: 'revoked' },
  });
}

/** Is this token recognizable as a MerchantSession at all? */
function isSessionToken(token) {
  return typeof token === 'string' && token.startsWith(TOKEN_PREFIX_LABEL);
}

module.exports = { issue, verify, revoke, isSessionToken, TOKEN_PREFIX_LABEL };
