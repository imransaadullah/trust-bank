// Mirrors tenantConfigService.js exactly, against TenantBillsProviderConfig
// instead of TenantProviderConfig — see that model's comment in
// schema.prisma for why this is a separate table rather than a shared one.
const prisma = require('../db/prismaClient');
const { encryptJSON, decryptJSON } = require('../crypto/tenantSecrets');
const { getBillsProvider } = require('../providers/billsRegistry');
const { TenantNotConfiguredError } = require('../utils/errors');

async function setConfig({ tenantId, provider, credentials }) {
  const encryptedCredentials = encryptJSON(credentials);
  return prisma.tenantBillsProviderConfig.upsert({
    where: { tenantId },
    create: { tenantId, provider, encryptedCredentials },
    update: { provider, encryptedCredentials },
  });
}

async function getConfigByTenantId(tenantId) {
  const row = await prisma.tenantBillsProviderConfig.findUnique({ where: { tenantId } });
  if (!row || row.status !== 'active') {
    throw new TenantNotConfiguredError(tenantId);
  }
  return row;
}

/** Loads a tenant's bills config and returns a ready-to-use provider instance. */
async function getProviderForTenant(tenantId) {
  const row = await getConfigByTenantId(tenantId);
  const credentials = decryptJSON(row.encryptedCredentials);
  return { tenantId: row.tenantId, provider: getBillsProvider(row.provider, credentials) };
}

module.exports = { setConfig, getConfigByTenantId, getProviderForTenant };
