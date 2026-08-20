// Stores/retrieves each tenant's Ledger/Payments/Compliance operate
// credential — provisioned once per tenant (deploy/provision-tenant.sh's
// new step, or POST /v1/tenants/:id/backend-credentials directly) and
// read on every proxied request (backendProxy.js) to authenticate to the
// right backend as that tenant.
const prisma = require('../db/prismaClient');
const { encrypt, decrypt } = require('../crypto/tenantBackendCredentials');
const { TenantBackendCredentialNotFoundError } = require('../utils/errors');

const VALID_SERVICES = ['ledger', 'payments', 'compliance', 'cards'];

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

module.exports = { store, get, VALID_SERVICES };
