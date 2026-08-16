// Shared between wallet.js (transfer/withdraw) and bills.js (bill
// payments) — extracted so both go through the exact same KYC-tier/
// device/monitoring/sanctions checks rather than each route reimplementing
// them slightly differently. See COMPLIANCE_DESIGN_AND_BACKLOG.md.
const prisma = require('../db/prismaClient');
const complianceClient = require('./complianceClient');
const { ComplianceDeniedError } = require('../utils/errors');

async function amountTransactedTodayKobo(userId) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const result = await prisma.transaction.aggregate({
    where: {
      userId, type: { in: ['withdrawal', 'p2p_sent', 'bill_payment'] },
      createdAt: { gte: startOfToday }, status: { not: 'reversed' },
    },
    _sum: { amount: true },
  });
  return result._sum.amount || 0;
}

// A fixed, generous lookback rather than the monitoring policy's actual
// configured window — trustpay-backend doesn't need to know that value,
// compliance filters this down to its own policy window itself. Keeps
// "the rule changes without a redeploy here" true for this check too.
async function recentTransactionsForMonitoring(userId) {
  const windowStart = new Date(Date.now() - 7 * 24 * 3_600_000);
  const rows = await prisma.transaction.findMany({
    where: { userId, createdAt: { gte: windowStart }, status: { not: 'reversed' } },
    select: { amount: true, counterpartyUserId: true, counterpartyLabel: true, createdAt: true },
  });
  return rows.map((r) => ({
    amount: r.amount, counterpartyId: r.counterpartyUserId || r.counterpartyLabel, createdAt: r.createdAt,
  }));
}

// The one call site every money-moving route goes through instead of a
// hardcoded `if (user.kycTier < 1)` amount check — see
// COMPLIANCE_DESIGN_AND_BACKLOG.md. Two distinct checks, deliberately:
// the KYC-tier limit is a CBN-mandated daily/single-txn cap (skipped for
// kycTier 0 — that's our own pre-verification onboarding gate, not a
// CBN tier, so there's no policy to check against). Device binding
// applies regardless of tier — CBN's rule caps a new device "even for
// fully-verified Tier 3 accounts."
// counterpartyId/transactionRef feed transaction monitoring's velocity/
// structuring rules; namesToScreen feeds sanctions screening — the
// sender's own verified name (from Tier-1 BVN/NIN verification,
// User.verifiedFullName) when there is one, since that's actually been
// checked against a government identity record and not just typed in;
// falls back to the self-reported displayName for a Tier-0 user who
// hasn't verified yet — screening something unverified still beats
// screening nothing. Plus (for a withdrawal or bill payment) the
// external beneficiary/biller-customer name where known. Monitoring
// flags but never blocks (see services/compliance's screeningService.js);
// a sanctions hit does.
async function enforceCompliance({ user, deviceId, amount, counterpartyId, transactionRef, namesToScreen = [] }) {
  if (user.kycTier >= 1) {
    const spentToday = await amountTransactedTodayKobo(user.id);
    const kycDecision = await complianceClient.checkKYCTier({
      userId: user.id, tier: user.kycTier, amount, amountTransactedTodayKobo: spentToday,
    });
    if (!kycDecision.allowed) throw new ComplianceDeniedError(kycDecision.reason);
  }

  const device = deviceId
    ? await prisma.device.findUnique({ where: { userId_deviceId: { userId: user.id, deviceId } } })
    : null;
  const deviceAgeHours = device ? (Date.now() - device.firstSeenAt.getTime()) / 3_600_000 : 0;
  const deviceDecision = await complianceClient.checkDevice({
    userId: user.id, isNewDevice: !device, deviceAgeHours, amount,
  });
  if (!deviceDecision.allowed) throw new ComplianceDeniedError(deviceDecision.reason);

  const recentTransactions = await recentTransactionsForMonitoring(user.id);
  await complianceClient.screenTransaction({
    userId: user.id, amount, counterpartyId, recentTransactions, transactionRef,
  });

  const namesToCheck = [user.verifiedFullName || user.displayName, ...namesToScreen].filter(Boolean);
  for (const fullName of namesToCheck) {
    const sanctionsDecision = await complianceClient.screenSanctions({ userId: user.id, fullName });
    if (sanctionsDecision.hit) throw new ComplianceDeniedError('Transaction blocked by sanctions screening');
  }
}

module.exports = { enforceCompliance, amountTransactedTodayKobo, recentTransactionsForMonitoring };
