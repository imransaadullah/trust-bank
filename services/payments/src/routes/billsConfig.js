const express = require('express');
const billsConfigService = require('../services/billsConfigService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/bills-config', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { provider, credentials } = req.body;
    if (!provider || !credentials) {
      return res.status(400).json({ success: false, error: 'provider and credentials are required' });
    }
    const config = await billsConfigService.setConfig({ tenantId: req.params.tenantId, provider, credentials });
    res.status(201).json({
      success: true,
      data: { tenantId: config.tenantId, provider: config.provider, status: config.status },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/bills-config', requireApiKey('admin'), async (req, res, next) => {
  try {
    const config = await billsConfigService.getConfigByTenantId(req.params.tenantId);
    res.json({
      success: true,
      data: { tenantId: config.tenantId, provider: config.provider, status: config.status },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
