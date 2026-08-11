// Finds outbound SettlementAttempts stuck in 'pending' because their
// webhook never arrived (a NIBSS outage, a dropped delivery) and either
// resolves them by asking the provider directly, or — past a longer SLA —
// refunds automatically rather than leaving the customer waiting on an
// outage to resolve itself. See settlementService.js's
// reconcileOutboundAttempt/autoRefundStaleAttempt, which own the actual
// state transitions; this is just the "find stale rows, apply the right
// one" orchestration.
const prisma = require('../db/prismaClient');
const settlementService = require('./settlementService');
const config = require('../config');
const logger = require('../utils/logger');

async function reconcileTenant(tenantId, options = {}) {
  const staleMinutes = options.staleMinutes ?? config.reconciliation.staleMinutes;
  const autoRefundMinutes = options.autoRefundMinutes ?? config.reconciliation.autoRefundMinutes;
  const now = Date.now();
  const staleCutoff = new Date(now - staleMinutes * 60_000);

  const pending = await prisma.settlementAttempt.findMany({
    where: { tenantId, direction: 'outbound', status: 'pending', createdAt: { lt: staleCutoff } },
  });

  const results = [];
  for (const attempt of pending) {
    const ageMinutes = (now - attempt.createdAt.getTime()) / 60_000;
    const checked = await settlementService.reconcileOutboundAttempt(attempt);

    if (checked.action === 'still-pending' && ageMinutes >= autoRefundMinutes) {
      const refunded = await settlementService.autoRefundStaleAttempt(
        attempt, `Auto-refunded: exceeded ${autoRefundMinutes}-minute resolution SLA`
      );
      results.push({ attemptId: attempt.id, ageMinutes: Math.round(ageMinutes), ...refunded });
    } else {
      results.push({ attemptId: attempt.id, ageMinutes: Math.round(ageMinutes), ...checked });
    }
  }

  if (results.length > 0) {
    logger.info(`[Reconciliation] tenant ${tenantId}: ${results.length} stale attempt(s) processed`, { results });
  }

  return results;
}

async function reconcileAllTenants(options = {}) {
  const tenants = await prisma.tenantProviderConfig.findMany({ where: { status: 'active' } });
  const summary = [];
  for (const tenant of tenants) {
    try {
      const results = await reconcileTenant(tenant.tenantId, options);
      summary.push({ tenantId: tenant.tenantId, results });
    } catch (err) {
      logger.error(`[Reconciliation] tenant ${tenant.tenantId} failed: ${err.message}`);
      summary.push({ tenantId: tenant.tenantId, error: err.message });
    }
  }
  return summary;
}

module.exports = { reconcileTenant, reconcileAllTenants };
