const prisma = require('../db/prismaClient');
const tenantConfigService = require('./tenantConfigService');

async function provisionAccount(tenantId, { externalCustomerId, email, firstName, lastName, phoneNumber, currency }) {
  const existing = await prisma.provisionedAccount.findUnique({
    where: { tenantId_externalCustomerId: { tenantId, externalCustomerId } },
  });
  if (existing) {
    return existing;
  }

  const { provider } = await tenantConfigService.getProviderForTenant(tenantId);
  const result = await provider.provisionAccount({ externalCustomerId, email, firstName, lastName, phoneNumber, currency });

  return prisma.provisionedAccount.create({
    data: {
      tenantId, externalCustomerId, provider: provider.name,
      accountNumber: result.accountNumber, bankCode: result.bankCode, bankName: result.bankName,
      metadata: result.metadata || {},
    },
  });
}

/** The reverse lookup a webhook resolution needs: account number -> customer. */
async function findByAccountNumber(tenantId, accountNumber) {
  return prisma.provisionedAccount.findUnique({
    where: { tenantId_accountNumber: { tenantId, accountNumber } },
  });
}

async function findByCustomer(tenantId, externalCustomerId) {
  return prisma.provisionedAccount.findUnique({
    where: { tenantId_externalCustomerId: { tenantId, externalCustomerId } },
  });
}

module.exports = { provisionAccount, findByAccountNumber, findByCustomer };
