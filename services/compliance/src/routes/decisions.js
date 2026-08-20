const express = require('express');
const decisionService = require('../services/decisionService');
const screeningService = require('../services/screeningService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/compliance/kyc-tier-check', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { jurisdiction, userId, tier, amount, amountTransactedTodayKobo } = req.body;
    if (!userId || tier == null || amount == null) {
      return res.status(400).json({ success: false, error: 'userId, tier, and amount are required' });
    }
    const decision = await decisionService.evaluateKYCTier({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG', tier, amount,
      amountTransactedTodayKobo: amountTransactedTodayKobo || 0,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/device-check', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { jurisdiction, userId, isNewDevice, deviceAgeHours, amount } = req.body;
    if (!userId || amount == null) {
      return res.status(400).json({ success: false, error: 'userId and amount are required' });
    }
    const decision = await decisionService.evaluateDevice({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG',
      isNewDevice: !!isNewDevice, deviceAgeHours, amount,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/loan-eligibility-check', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { jurisdiction, userId, kycTier, requestedAmountKobo, requestedTenorDays, hasActiveLoan } = req.body;
    if (!userId || kycTier == null || requestedAmountKobo == null || requestedTenorDays == null) {
      return res.status(400).json({ success: false, error: 'userId, kycTier, requestedAmountKobo, and requestedTenorDays are required' });
    }
    const decision = await decisionService.evaluateLoanEligibility({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG', kycTier,
      requestedAmountKobo, requestedTenorDays, hasActiveLoan: !!hasActiveLoan,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/card-issuance-check', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { jurisdiction, userId, kycTier, existingCardCount } = req.body;
    if (!userId || kycTier == null || existingCardCount == null) {
      return res.status(400).json({ success: false, error: 'userId, kycTier, and existingCardCount are required' });
    }
    const decision = await decisionService.evaluateCardIssuanceEligibility({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG', kycTier, existingCardCount,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

// Mechanical, caller-fed — the Ledger owns loan state and already computed
// daysPastDue/bucket (services/identity's delinquencyRunner just forwards
// them); this doesn't decide anything, it opens/updates the case a staff
// member reviews through the existing COMPLIANCE_CASE_REVIEW flow.
router.post('/:tenantId/compliance/loan-delinquency-flag', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { userId, loanAccountId, daysPastDue, bucket, principalOutstandingKobo } = req.body;
    if (!userId || !loanAccountId || daysPastDue == null || !bucket) {
      return res.status(400).json({ success: false, error: 'userId, loanAccountId, daysPastDue, and bucket are required' });
    }
    const result = await screeningService.flagLoanDelinquency({
      tenantId: req.params.tenantId, userId, loanAccountId,
      daysPastDue, bucket, principalOutstandingKobo,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
