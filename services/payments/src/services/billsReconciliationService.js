// Mirrors reconciliationService.js exactly, against BillPaymentAttempt/
// TenantBillsProviderConfig instead of SettlementAttempt/
// TenantProviderConfig — a bills-only tenant has no row in the latter,
// the whole reason that table split exists (see schema.prisma).
const prisma = require('../db/prismaClient');
const billsService = require('./billsService');
const config = require('../config');
const logger = require('../utils/logger');

async function reconcileTenantBills(tenantId, options = {}) {
  const staleMinutes = options.staleMinutes ?? config.billsReconciliation.staleMinutes;
  const autoRefundMinutes = options.autoRefundMinutes ?? config.billsReconciliation.autoRefundMinutes;
  const now = Date.now();
  const staleCutoff = new Date(now - staleMinutes * 60_000);

  const pending = await prisma.billPaymentAttempt.findMany({
    where: { tenantId, status: 'pending', createdAt: { lt: staleCutoff } },
  });

  const results = [];
  for (const attempt of pending) {
    const ageMinutes = (now - attempt.createdAt.getTime()) / 60_000;
    const checked = await billsService.reconcileBillAttempt(attempt);

    if (checked.action === 'still-pending' && ageMinutes >= autoRefundMinutes) {
      const refunded = await billsService.autoRefundStaleBillAttempt(
        attempt, `Auto-refunded: exceeded ${autoRefundMinutes}-minute resolution SLA`,
      );
      results.push({ attemptId: attempt.id, ageMinutes: Math.round(ageMinutes), ...refunded });
    } else {
      results.push({ attemptId: attempt.id, ageMinutes: Math.round(ageMinutes), ...checked });
    }
  }

  if (results.length > 0) {
    logger.info(`[BillsReconciliation] tenant ${tenantId}: ${results.length} stale attempt(s) processed`, { results });
  }

  return results;
}

async function reconcileAllTenantsBills(options = {}) {
  const tenants = await prisma.tenantBillsProviderConfig.findMany({ where: { status: 'active' } });
  const summary = [];
  for (const tenant of tenants) {
    try {
      const results = await reconcileTenantBills(tenant.tenantId, options);
      summary.push({ tenantId: tenant.tenantId, results });
    } catch (err) {
      logger.error(`[BillsReconciliation] tenant ${tenant.tenantId} failed: ${err.message}`);
      summary.push({ tenantId: tenant.tenantId, error: err.message });
    }
  }
  return summary;
}

module.exports = { reconcileTenantBills, reconcileAllTenantsBills };
