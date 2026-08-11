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

module.exports = { evaluateKYCTier, evaluateDevice };
