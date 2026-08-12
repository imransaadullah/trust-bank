// Same immutable/versioned discipline as policyService.js's two pairs —
// publishing never updates an existing row, it inserts a new one with a
// higher version and its own effectiveFrom.
const prisma = require('../db/prismaClient');
const { NoPolicyConfiguredError } = require('../utils/errors');

async function publishMonitoringPolicy({
  tenantId, jurisdiction, velocityWindowHours, velocityMaxTransactionCount,
  velocityMaxDistinctCounterparties, structuringThresholdKobo, structuringWindowCount,
  largeSingleTxnThresholdKobo, effectiveFrom,
}) {
  const nextVersion = await nextVersionFor(prisma.transactionMonitoringPolicy, { tenantId, jurisdiction });
  return prisma.transactionMonitoringPolicy.create({
    data: {
      tenantId, jurisdiction, velocityWindowHours, velocityMaxTransactionCount,
      velocityMaxDistinctCounterparties, structuringThresholdKobo, structuringWindowCount,
      largeSingleTxnThresholdKobo,
      version: nextVersion, effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });
}

async function getCurrentMonitoringPolicy(tenantId, jurisdiction, atDate = new Date()) {
  const policy = await prisma.transactionMonitoringPolicy.findFirst({
    where: { tenantId, jurisdiction, effectiveFrom: { lte: atDate } },
    orderBy: { version: 'desc' },
  });
  if (!policy) throw new NoPolicyConfiguredError('transaction-monitoring', tenantId);
  return policy;
}

async function nextVersionFor(model, where) {
  const latest = await model.findFirst({ where, orderBy: { version: 'desc' } });
  return latest ? latest.version + 1 : 1;
}

module.exports = { publishMonitoringPolicy, getCurrentMonitoringPolicy };
