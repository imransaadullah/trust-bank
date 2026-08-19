// Stores/retrieves this service's own Ledger/Compliance operate
// credential per tenant — needed to actually execute an approved action
// (backendExecutor.js). Identical shape to the gateway's own
// tenantBackendCredentialService.js/TenantBackendCredential — this
// service is genuinely multi-tenant, so it can't hold one shared
// credential per backend the way trustpay-backend's own .env does.
const prisma = require('../db/prismaClient');
const { encrypt, decrypt } = require('../crypto/mfaSecrets');
const { TenantBackendCredentialNotFoundError } = require('../utils/errors');

const VALID_SERVICES = ['ledger', 'compliance'];

async function store({ tenantId, service, token }) {
  if (!VALID_SERVICES.includes(service)) {
    throw new Error(`tenantBackendCredentialService: service must be one of ${VALID_SERVICES.join(', ')}`);
  }
  const encryptedToken = encrypt(token);
  return prisma.tenantBackendCredential.upsert({
    where: { tenantId_service: { tenantId, service } },
    create: { tenantId, service, encryptedToken },
    update: { encryptedToken },
  });
}

/** @returns {Promise<string>} the decrypted operate token */
async function get(tenantId, service) {
  const row = await prisma.tenantBackendCredential.findUnique({
    where: { tenantId_service: { tenantId, service } },
  });
  if (!row) throw new TenantBackendCredentialNotFoundError(tenantId, service);
  return decrypt(row.encryptedToken);
}

// Every tenant this service can actually act for — both delinquencyRunner.js
// and creditBureauRunner.js need "which tenants have both credentials
// stored" to know who to enumerate on each tick.
async function listTenantsWithLedgerAndCompliance() {
  const rows = await prisma.tenantBackendCredential.findMany({
    where: { service: { in: VALID_SERVICES } },
    select: { tenantId: true, service: true },
  });
  const byTenant = new Map();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, new Set());
    byTenant.get(row.tenantId).add(row.service);
  }
  return [...byTenant.entries()]
    .filter(([, services]) => services.has('ledger') && services.has('compliance'))
    .map(([tenantId]) => tenantId);
}

module.exports = { store, get, VALID_SERVICES, listTenantsWithLedgerAndCompliance };
