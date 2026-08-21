// Stores/retrieves each tenant's Ledger/Payments/Compliance operate
// credential — provisioned once per tenant (deploy/provision-tenant.sh's
// new step, or POST /v1/tenants/:id/backend-credentials directly) and
// read on every proxied request (backendProxy.js) to authenticate to the
// right backend as that tenant.
const prisma = require('../db/prismaClient');
const { encrypt, decrypt } = require('../crypto/tenantBackendCredentials');
const { TenantBackendCredentialNotFoundError } = require('../utils/errors');

const VALID_SERVICES = ['ledger', 'payments', 'compliance', 'cards', 'checkout'];
const VALID_SCOPES = ['operate', 'admin'];

async function store({ tenantId, service, token, scope = 'operate' }) {
  if (!VALID_SERVICES.includes(service)) {
    throw new Error(`tenantBackendCredentialService: service must be one of ${VALID_SERVICES.join(', ')}`);
  }
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`tenantBackendCredentialService: scope must be one of ${VALID_SCOPES.join(', ')}`);
  }
  const encryptedToken = encrypt(token);
  return prisma.tenantBackendCredential.upsert({
    where: { tenantId_service_scope: { tenantId, service, scope } },
    create: { tenantId, service, scope, encryptedToken },
    update: { encryptedToken },
  });
}

/** @returns {Promise<string>} the decrypted token for this (tenant, service, scope) */
async function get(tenantId, service, scope = 'operate') {
  const row = await prisma.tenantBackendCredential.findUnique({
    where: { tenantId_service_scope: { tenantId, service, scope } },
  });
  if (!row) throw new TenantBackendCredentialNotFoundError(tenantId, service, scope);
  return decrypt(row.encryptedToken);
}

module.exports = { store, get, VALID_SERVICES, VALID_SCOPES };
