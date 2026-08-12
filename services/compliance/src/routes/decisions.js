const express = require('express');
const decisionService = require('../services/decisionService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/compliance/kyc-tier-check', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { jurisdiction, userId, tier, amount, amountTransactedTodayKobo } = req.body;
    if (!userId || !tier || amount == null) {
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

module.exports = router;
