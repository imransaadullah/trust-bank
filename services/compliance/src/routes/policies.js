const express = require('express');
const policyService = require('../services/policyService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/compliance/kyc-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction, tier, requiredVerifications, dailyLimitKobo, singleTxnLimitKobo, effectiveFrom } = req.body;
    if (tier == null || !requiredVerifications) {
      return res.status(400).json({ success: false, error: 'tier and requiredVerifications are required' });
    }
    const policy = await policyService.publishKYCPolicy({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG', tier,
      requiredVerifications, dailyLimitKobo, singleTxnLimitKobo, effectiveFrom,
    });
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/compliance/kyc-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction, tier } = req.query;
    if (tier == null) {
      return res.status(400).json({ success: false, error: 'tier query param is required' });
    }
    const policy = await policyService.getCurrentKYCPolicy(req.params.tenantId, jurisdiction || 'NG', Number(tier));
    res.json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/device-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction, maxActiveDevices, newDeviceCooldownHours, newDeviceLimitKobo, effectiveFrom } = req.body;
    if (newDeviceCooldownHours == null || newDeviceLimitKobo == null) {
      return res.status(400).json({ success: false, error: 'newDeviceCooldownHours and newDeviceLimitKobo are required' });
    }
    const policy = await policyService.publishDevicePolicy({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG',
      maxActiveDevices, newDeviceCooldownHours, newDeviceLimitKobo, effectiveFrom,
    });
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/compliance/device-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction } = req.query;
    const policy = await policyService.getCurrentDevicePolicy(req.params.tenantId, jurisdiction || 'NG');
    res.json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/loan-eligibility-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction, minKycTier, maxLoanAmountKobo, maxTenorDays, interestRateAnnualBps, effectiveFrom } = req.body;
    if (minKycTier == null || maxLoanAmountKobo == null || maxTenorDays == null || interestRateAnnualBps == null) {
      return res.status(400).json({ success: false, error: 'minKycTier, maxLoanAmountKobo, maxTenorDays, and interestRateAnnualBps are required' });
    }
    const policy = await policyService.publishLoanEligibilityPolicy({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG',
      minKycTier, maxLoanAmountKobo, maxTenorDays, interestRateAnnualBps, effectiveFrom,
    });
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/compliance/loan-eligibility-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction } = req.query;
    const policy = await policyService.getCurrentLoanEligibilityPolicy(req.params.tenantId, jurisdiction || 'NG');
    res.json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/card-issuance-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction, minKycTier, maxCardsPerCustomer, dailySpendLimitKobo, singleTxnLimitKobo, effectiveFrom } = req.body;
    if (minKycTier == null || maxCardsPerCustomer == null || dailySpendLimitKobo == null || singleTxnLimitKobo == null) {
      return res.status(400).json({ success: false, error: 'minKycTier, maxCardsPerCustomer, dailySpendLimitKobo, and singleTxnLimitKobo are required' });
    }
    const policy = await policyService.publishCardIssuancePolicy({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG',
      minKycTier, maxCardsPerCustomer, dailySpendLimitKobo, singleTxnLimitKobo, effectiveFrom,
    });
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/compliance/card-issuance-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction } = req.query;
    const policy = await policyService.getCurrentCardIssuancePolicy(req.params.tenantId, jurisdiction || 'NG');
    res.json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
