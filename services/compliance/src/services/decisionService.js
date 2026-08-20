// The actual decisions — pure policy math over facts the caller supplies.
// This service never looks up per-user history itself (no "has this user
// transacted today" query, no "have I seen this device before" table) —
// that's product-backend-owned state. Keeping this stateless is what
// makes it safe for any tenant's backend to call without compliance
// needing to know anything about their data model.
const policyService = require('./policyService');

async function evaluateKYCTier({ tenantId, jurisdiction, tier, amount, amountTransactedTodayKobo }) {
  const policy = await policyService.getCurrentKYCPolicy(tenantId, jurisdiction, tier);

  if (policy.singleTxnLimitKobo != null && amount > policy.singleTxnLimitKobo) {
    return {
      allowed: false, reason: `Exceeds the single-transaction limit of ${policy.singleTxnLimitKobo} kobo for tier ${tier}`,
      dailyLimitKobo: policy.dailyLimitKobo, singleTxnLimitKobo: policy.singleTxnLimitKobo, policyVersion: policy.version,
    };
  }

  const projectedDailyTotal = (amountTransactedTodayKobo || 0) + amount;
  if (policy.dailyLimitKobo != null && projectedDailyTotal > policy.dailyLimitKobo) {
    return {
      allowed: false, reason: `Exceeds the daily limit of ${policy.dailyLimitKobo} kobo for tier ${tier}`,
      dailyLimitKobo: policy.dailyLimitKobo, singleTxnLimitKobo: policy.singleTxnLimitKobo, policyVersion: policy.version,
    };
  }

  return {
    allowed: true, dailyLimitKobo: policy.dailyLimitKobo, singleTxnLimitKobo: policy.singleTxnLimitKobo,
    policyVersion: policy.version,
  };
}

async function evaluateDevice({ tenantId, jurisdiction, isNewDevice, deviceAgeHours, amount }) {
  const policy = await policyService.getCurrentDevicePolicy(tenantId, jurisdiction);

  const withinCooldown = isNewDevice || (deviceAgeHours != null && deviceAgeHours < policy.newDeviceCooldownHours);
  if (!withinCooldown) {
    return { allowed: true, policyVersion: policy.version };
  }

  if (amount > policy.newDeviceLimitKobo) {
    return {
      allowed: false, capAppliedKobo: policy.newDeviceLimitKobo, cooldownHours: policy.newDeviceCooldownHours,
      reason: `New device — capped at ${policy.newDeviceLimitKobo} kobo for ${policy.newDeviceCooldownHours}h`,
      policyVersion: policy.version,
    };
  }

  return {
    allowed: true, capAppliedKobo: policy.newDeviceLimitKobo, cooldownHours: policy.newDeviceCooldownHours,
    policyVersion: policy.version,
  };
}

// Stateless, same as the two decisions above — the caller (services/
// identity) supplies hasActiveLoan since loan state lives in the Ledger,
// not here. Deliberately simple for Phase 3 slice 1: a flat cap and a
// fixed tenant-wide rate, not income-based underwriting or a live credit
// bureau score — both real, separate, later work.
async function evaluateLoanEligibility({ tenantId, jurisdiction, kycTier, requestedAmountKobo, requestedTenorDays, hasActiveLoan }) {
  const policy = await policyService.getCurrentLoanEligibilityPolicy(tenantId, jurisdiction);

  if (hasActiveLoan) {
    return {
      allowed: false, reason: 'Customer already has an active or pending loan',
      maxLoanAmountKobo: policy.maxLoanAmountKobo, interestRateAnnualBps: policy.interestRateAnnualBps,
      maxTenorDays: policy.maxTenorDays, policyVersion: policy.version,
    };
  }

  if (kycTier < policy.minKycTier) {
    return {
      allowed: false, reason: `Requires at least KYC tier ${policy.minKycTier}`,
      maxLoanAmountKobo: policy.maxLoanAmountKobo, interestRateAnnualBps: policy.interestRateAnnualBps,
      maxTenorDays: policy.maxTenorDays, policyVersion: policy.version,
    };
  }

  if (requestedAmountKobo > policy.maxLoanAmountKobo) {
    return {
      allowed: false, reason: `Exceeds the maximum loan amount of ${policy.maxLoanAmountKobo} kobo`,
      maxLoanAmountKobo: policy.maxLoanAmountKobo, interestRateAnnualBps: policy.interestRateAnnualBps,
      maxTenorDays: policy.maxTenorDays, policyVersion: policy.version,
    };
  }

  if (requestedTenorDays > policy.maxTenorDays) {
    return {
      allowed: false, reason: `Exceeds the maximum tenor of ${policy.maxTenorDays} days`,
      maxLoanAmountKobo: policy.maxLoanAmountKobo, interestRateAnnualBps: policy.interestRateAnnualBps,
      maxTenorDays: policy.maxTenorDays, policyVersion: policy.version,
    };
  }

  return {
    allowed: true, maxLoanAmountKobo: policy.maxLoanAmountKobo,
    interestRateAnnualBps: policy.interestRateAnnualBps, maxTenorDays: policy.maxTenorDays,
    policyVersion: policy.version,
  };
}

// Stateless and caller-fed, same posture as evaluateLoanEligibility —
// Compliance doesn't own card state any more than it owns loan state,
// services/cards does. existingCardCount comes from the caller
// (trustpay-backend, via services/cards) the same way hasActiveLoan does.
async function evaluateCardIssuanceEligibility({ tenantId, jurisdiction, kycTier, existingCardCount }) {
  const policy = await policyService.getCurrentCardIssuancePolicy(tenantId, jurisdiction);

  if (kycTier < policy.minKycTier) {
    return {
      allowed: false, reason: `Requires at least KYC tier ${policy.minKycTier}`,
      dailySpendLimitKobo: policy.dailySpendLimitKobo, singleTxnLimitKobo: policy.singleTxnLimitKobo,
      maxCardsPerCustomer: policy.maxCardsPerCustomer, policyVersion: policy.version,
    };
  }

  if (existingCardCount >= policy.maxCardsPerCustomer) {
    return {
      allowed: false, reason: `Exceeds the maximum of ${policy.maxCardsPerCustomer} card(s) per customer`,
      dailySpendLimitKobo: policy.dailySpendLimitKobo, singleTxnLimitKobo: policy.singleTxnLimitKobo,
      maxCardsPerCustomer: policy.maxCardsPerCustomer, policyVersion: policy.version,
    };
  }

  return {
    allowed: true, dailySpendLimitKobo: policy.dailySpendLimitKobo,
    singleTxnLimitKobo: policy.singleTxnLimitKobo, maxCardsPerCustomer: policy.maxCardsPerCustomer,
    policyVersion: policy.version,
  };
}

module.exports = { evaluateKYCTier, evaluateDevice, evaluateLoanEligibility, evaluateCardIssuanceEligibility };
