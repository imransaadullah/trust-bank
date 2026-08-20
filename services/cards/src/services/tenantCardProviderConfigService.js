// Which CardIssuingProvider a tenant is on, and that provider's own
// credentials — mirrors services/payments' tenantConfigService.js
// verbatim. Every card operation (issue/freeze/unfreeze/close/authorize/
// settle) resolves its provider through here per call, not a
// module-level constant, since different tenants can be on different
// providers.
const prisma = require('../db/prismaClient');
const { encryptJSON, decryptJSON } = require('../crypto/tenantSecrets');
const { getProvider } = require('../providers/registry');
const { TenantNotConfiguredError } = require('../utils/errors');

async function setConfig({ tenantId, tenantSlug, provider, credentials }) {
  const encryptedCredentials = encryptJSON(credentials || {});
  return prisma.tenantCardProviderConfig.upsert({
    where: { tenantId },
    create: { tenantId, tenantSlug, provider, encryptedCredentials },
    update: { tenantSlug, provider, encryptedCredentials },
  });
}

async function getConfigByTenantId(tenantId) {
  const row = await prisma.tenantCardProviderConfig.findUnique({ where: { tenantId } });
  if (!row || row.status !== 'active') {
    throw new TenantNotConfiguredError(tenantId);
  }
  return row;
}

async function getConfigBySlug(tenantSlug) {
  const row = await prisma.tenantCardProviderConfig.findUnique({ where: { tenantSlug } });
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
