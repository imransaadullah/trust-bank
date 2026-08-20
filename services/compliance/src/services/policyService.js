// Policy rows are immutable and versioned — publishing never updates an
// existing row, it inserts a new one with version = max(existing) + 1 and
// its own effectiveFrom. "Current policy" is always "the highest version
// whose effectiveFrom has already passed" — this is what lets a
// regulation change ship as a data write instead of a deploy, and it's
// what gives every decision an audit trail (see decisionService.js).
const prisma = require('../db/prismaClient');
const { NoPolicyConfiguredError } = require('../utils/errors');

async function publishKYCPolicy({ tenantId, jurisdiction, tier, requiredVerifications, dailyLimitKobo, singleTxnLimitKobo, effectiveFrom }) {
  const nextVersion = await nextVersionFor(prisma.kYCTierPolicy, { tenantId, jurisdiction, tier });
  return prisma.kYCTierPolicy.create({
    data: {
      tenantId, jurisdiction, tier, requiredVerifications: requiredVerifications || [],
      dailyLimitKobo: dailyLimitKobo ?? null, singleTxnLimitKobo: singleTxnLimitKobo ?? null,
      version: nextVersion, effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });
}

async function getCurrentKYCPolicy(tenantId, jurisdiction, tier, atDate = new Date()) {
  const policy = await prisma.kYCTierPolicy.findFirst({
    where: { tenantId, jurisdiction, tier, effectiveFrom: { lte: atDate } },
    orderBy: { version: 'desc' },
  });
  if (!policy) throw new NoPolicyConfiguredError(`KYC tier ${tier}`, tenantId);
  return policy;
}

async function publishDevicePolicy({ tenantId, jurisdiction, maxActiveDevices, newDeviceCooldownHours, newDeviceLimitKobo, effectiveFrom }) {
  const nextVersion = await nextVersionFor(prisma.deviceBindingPolicy, { tenantId, jurisdiction });
  return prisma.deviceBindingPolicy.create({
    data: {
      tenantId, jurisdiction, maxActiveDevices: maxActiveDevices ?? 1,
      newDeviceCooldownHours, newDeviceLimitKobo,
      version: nextVersion, effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });
}

async function getCurrentDevicePolicy(tenantId, jurisdiction, atDate = new Date()) {
  const policy = await prisma.deviceBindingPolicy.findFirst({
    where: { tenantId, jurisdiction, effectiveFrom: { lte: atDate } },
    orderBy: { version: 'desc' },
  });
  if (!policy) throw new NoPolicyConfiguredError('device-binding', tenantId);
  return policy;
}

async function publishLoanEligibilityPolicy({ tenantId, jurisdiction, minKycTier, maxLoanAmountKobo, maxTenorDays, interestRateAnnualBps, effectiveFrom }) {
  const nextVersion = await nextVersionFor(prisma.loanEligibilityPolicy, { tenantId, jurisdiction });
  return prisma.loanEligibilityPolicy.create({
    data: {
      tenantId, jurisdiction, minKycTier, maxLoanAmountKobo, maxTenorDays, interestRateAnnualBps,
      version: nextVersion, effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });
}

async function getCurrentLoanEligibilityPolicy(tenantId, jurisdiction, atDate = new Date()) {
  const policy = await prisma.loanEligibilityPolicy.findFirst({
    where: { tenantId, jurisdiction, effectiveFrom: { lte: atDate } },
    orderBy: { version: 'desc' },
  });
  if (!policy) throw new NoPolicyConfiguredError('loan-eligibility', tenantId);
  return policy;
}

async function publishCardIssuancePolicy({ tenantId, jurisdiction, minKycTier, maxCardsPerCustomer, dailySpendLimitKobo, singleTxnLimitKobo, effectiveFrom }) {
  const nextVersion = await nextVersionFor(prisma.cardIssuancePolicy, { tenantId, jurisdiction });
  return prisma.cardIssuancePolicy.create({
    data: {
      tenantId, jurisdiction, minKycTier, maxCardsPerCustomer, dailySpendLimitKobo, singleTxnLimitKobo,
      version: nextVersion, effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
    },
  });
}

async function getCurrentCardIssuancePolicy(tenantId, jurisdiction, atDate = new Date()) {
  const policy = await prisma.cardIssuancePolicy.findFirst({
    where: { tenantId, jurisdiction, effectiveFrom: { lte: atDate } },
    orderBy: { version: 'desc' },
  });
  if (!policy) throw new NoPolicyConfiguredError('card-issuance', tenantId);
  return policy;
}

async function nextVersionFor(model, where) {
  const latest = await model.findFirst({ where, orderBy: { version: 'desc' } });
  return latest ? latest.version + 1 : 1;
}

module.exports = {
  publishKYCPolicy, getCurrentKYCPolicy, publishDevicePolicy, getCurrentDevicePolicy,
  publishLoanEligibilityPolicy, getCurrentLoanEligibilityPolicy,
  publishCardIssuancePolicy, getCurrentCardIssuancePolicy,
};
