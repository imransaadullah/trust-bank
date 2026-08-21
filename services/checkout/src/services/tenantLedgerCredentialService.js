const prisma = require('../db/prismaClient');
const { encryptJSON, decryptJSON } = require('../crypto/tenantSecrets');
const { TenantLedgerCredentialNotFoundError } = require('../utils/errors');

async function store({ tenantId, token }) {
  const encryptedToken = encryptJSON({ token });
  return prisma.tenantLedgerCredential.upsert({
    where: { tenantId },
    create: { tenantId, encryptedToken },
    update: { encryptedToken },
  });
}

async function get(tenantId) {
  const row = await prisma.tenantLedgerCredential.findUnique({ where: { tenantId } });
  if (!row) {
    throw new TenantLedgerCredentialNotFoundError(tenantId);
  }
  return decryptJSON(row.encryptedToken).token;
}

module.exports = { store, get };
