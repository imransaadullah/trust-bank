// One model, three tiers doing two different jobs. 'sandbox'/'production'
// are the external-facing credential a bank's own engineers hold, rate-
// limited, gating the proxied banking routes. 'admin' is this service's
// own bootstrap/ops credential — mirrors every other service's
// admin/operate split (SERVICE_CREDENTIAL_MODEL.md): the first admin key
// is bootstrapped directly via scripts/bootstrapKey.js (the same
// chicken-and-egg fix Ledger/Payments/Compliance already use), and only
// an admin key can issue sandbox/production keys or store this tenant's
// backend credentials — never itself used for the banking routes.
// Same shape as services/compliance's credentialService.js otherwise
// (SHA-256 hashed, shown-once token).
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const { CredentialNotFoundError } = require('../utils/errors');

const TOKEN_PREFIX_LABEL = 'gw_live_';
const TIERS = ['admin', 'sandbox', 'production'];

// Defaults, overridable per key at issue time — sandbox is deliberately
// low so it's obviously not meant for real volume; production is a
// starting point, not a promise, until real usage patterns exist to
// tune it against. Admin is generously high rather than unlimited, so
// the same rate-limit code path applies uniformly (see middleware/auth.js)
// instead of a separate "admin skips rate limiting" branch.
const DEFAULT_RATE_LIMIT_PER_MINUTE = { admin: 6000, sandbox: 60, production: 600 };

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issue({ tenantId, label, tier, rateLimitPerMinute }) {
  if (!TIERS.includes(tier)) {
    throw new Error(`apiKeyService: tier must be one of ${TIERS.join(', ')}, got ${tier}`);
  }
  const randomHex = crypto.randomBytes(32).toString('hex');
  const token = TOKEN_PREFIX_LABEL + randomHex;
  const tokenPrefix = TOKEN_PREFIX_LABEL + randomHex.slice(0, 12);
  const hashedToken = hashToken(token);

  const apiKey = await prisma.apiKey.create({
    data: {
      tenantId, label, tier, tokenPrefix, hashedToken,
      rateLimitPerMinute: rateLimitPerMinute || DEFAULT_RATE_LIMIT_PER_MINUTE[tier],
    },
  });
  return { apiKey, token };
}

async function verify(token) {
  if (!token || token.length < TOKEN_PREFIX_LABEL.length + 12) return null;
  const prefix = token.slice(0, TOKEN_PREFIX_LABEL.length + 12);

  const apiKey = await prisma.apiKey.findUnique({ where: { tokenPrefix: prefix } });
  if (!apiKey) return null;

  const hashed = Buffer.from(hashToken(token));
  const stored = Buffer.from(apiKey.hashedToken);
  if (hashed.length !== stored.length || !crypto.timingSafeEqual(hashed, stored)) return null;
  if (apiKey.status !== 'active') return null;

  prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return apiKey;
}

async function revoke({ tenantId, apiKeyId }) {
  const result = await prisma.apiKey.updateMany({
    where: { id: apiKeyId, tenantId, status: 'active' },
    data: { status: 'revoked', revokedAt: new Date() },
  });
  if (result.count === 0) throw new CredentialNotFoundError(apiKeyId);
}

async function list({ tenantId }) {
  return prisma.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, label: true, tier: true, tokenPrefix: true, status: true,
      rateLimitPerMinute: true, createdAt: true, revokedAt: true, lastUsedAt: true,
    },
  });
}

module.exports = { issue, verify, revoke, list, TIERS };
