const express = require('express');
const policyService = require('../services/policyService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/compliance/kyc-policy', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { jurisdiction, tier, requiredVerifications, dailyLimitKobo, singleTxnLimitKobo, effectiveFrom } = req.body;
    if (!tier || !requiredVerifications) {
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

module.exports = router;
