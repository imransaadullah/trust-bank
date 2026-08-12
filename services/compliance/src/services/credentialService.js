// Replaces the single static COMPLIANCE_SHARED_SECRET with scoped,
// revocable, tenant-bound API credentials. See SERVICE_CREDENTIAL_MODEL.md
// (repo root). High-entropy random tokens don't need slow/salted password
// hashing — SHA-256 is what Stripe/GitHub use for the same reason.
const crypto = require('crypto');
const prisma = require('../db/prismaClient');
const { CredentialNotFoundError } = require('../utils/errors');

const TOKEN_PREFIX_LABEL = 'cmp_live_';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issue({ tenantId, label, scope }) {
  if (!['admin', 'operate'].includes(scope)) {
    throw new Error(`credentialService: scope must be 'admin' or 'operate', got ${scope}`);
  }
  const randomHex = crypto.randomBytes(32).toString('hex');
  const token = TOKEN_PREFIX_LABEL + randomHex;
  const tokenPrefix = TOKEN_PREFIX_LABEL + randomHex.slice(0, 12);
  const hashedToken = hashToken(token);

  const credential = await prisma.apiCredential.create({
    data: { tenantId, label, tokenPrefix, hashedToken, scope },
  });
  return { credential, token };
}

async function verify(token) {
  if (!token || token.length < TOKEN_PREFIX_LABEL.length + 12) return null;
  const prefix = token.slice(0, TOKEN_PREFIX_LABEL.length + 12);

  const credential = await prisma.apiCredential.findUnique({ where: { tokenPrefix: prefix } });
  if (!credential) return null;

  const hashed = Buffer.from(hashToken(token));
  const stored = Buffer.from(credential.hashedToken);
  if (hashed.length !== stored.length || !crypto.timingSafeEqual(hashed, stored)) return null;
  if (credential.status !== 'active') return null;

  prisma.apiCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

  return credential;
}

async function revoke({ tenantId, credentialId }) {
  const result = await prisma.apiCredential.updateMany({
    where: { id: credentialId, tenantId, status: 'active' },
    data: { status: 'revoked', revokedAt: new Date() },
  });
  if (result.count === 0) throw new CredentialNotFoundError(credentialId);
}

async function list({ tenantId }) {
  return prisma.apiCredential.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, label: true, tokenPrefix: true, scope: true, status: true,
      createdAt: true, revokedAt: true, lastUsedAt: true,
    },
  });
}

module.exports = { issue, verify, revoke, list };
