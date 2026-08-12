const express = require('express');
const tenantConfigService = require('../services/tenantConfigService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/config', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { tenantSlug, provider, credentials } = req.body;
    if (!tenantSlug || !provider || !credentials) {
      return res.status(400).json({ success: false, error: 'tenantSlug, provider, and credentials are required' });
    }
    const config = await tenantConfigService.setConfig({
      tenantId: req.params.tenantId, tenantSlug, provider, credentials,
    });
    res.status(201).json({
      success: true,
      data: { tenantId: config.tenantId, tenantSlug: config.tenantSlug, provider: config.provider, status: config.status },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/config', requireApiKey('admin'), async (req, res, next) => {
  try {
    const config = await tenantConfigService.getConfigByTenantId(req.params.tenantId);
    res.json({
      success: true,
      data: { tenantId: config.tenantId, tenantSlug: config.tenantSlug, provider: config.provider, status: config.status },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
