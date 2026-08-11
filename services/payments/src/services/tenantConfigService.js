const prisma = require('../db/prismaClient');
const { encryptJSON, decryptJSON } = require('../crypto/tenantSecrets');
const { getProvider } = require('../providers/registry');
const { TenantNotConfiguredError } = require('../utils/errors');

async function setConfig({ tenantId, tenantSlug, provider, credentials }) {
  const encryptedCredentials = encryptJSON(credentials);
  return prisma.tenantProviderConfig.upsert({
    where: { tenantId },
    create: { tenantId, tenantSlug, provider, encryptedCredentials },
    update: { tenantSlug, provider, encryptedCredentials },
  });
}

async function getConfigByTenantId(tenantId) {
  const row = await prisma.tenantProviderConfig.findUnique({ where: { tenantId } });
  if (!row || row.status !== 'active') {
    throw new TenantNotConfiguredError(tenantId);
  }
  return row;
}

async function getConfigBySlug(tenantSlug) {
  const row = await prisma.tenantProviderConfig.findUnique({ where: { tenantSlug } });
  if (!row || row.status !== 'active') {
    throw new TenantNotConfiguredError(tenantSlug);
  }
  return row;
}

/** Loads a tenant's config and returns a ready-to-use provider instance. */
async function getProviderForTenant(tenantId) {
  const row = await getConfigByTenantId(tenantId);
  const credentials = decryptJSON(row.encryptedCredentials);
  return { tenantId: row.tenantId, provider: getProvider(row.provider, credentials) };
}

async function getProviderForTenantSlug(tenantSlug) {
  const row = await getConfigBySlug(tenantSlug);
  const credentials = decryptJSON(row.encryptedCredentials);
  return { tenantId: row.tenantId, provider: getProvider(row.provider, credentials) };
}

module.exports = { setConfig, getConfigByTenantId, getConfigBySlug, getProviderForTenant, getProviderForTenantSlug };
