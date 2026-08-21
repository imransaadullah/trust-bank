const express = require('express');
const tenantCheckoutProviderConfigService = require('../services/tenantCheckoutProviderConfigService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// credentials is optional — 'noop' needs none. A real 'paystack'
// provider needs { secretKey, webhookSecret? } here, same shape
// services/payments' own /config route already uses.
router.post('/:tenantId/checkout-config', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { tenantSlug, provider, credentials } = req.body;
    if (!tenantSlug || !provider) {
      return res.status(400).json({ success: false, error: 'tenantSlug and provider are required' });
    }
    const config = await tenantCheckoutProviderConfigService.setConfig({
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

router.get('/:tenantId/checkout-config', requireApiKey('admin'), async (req, res, next) => {
  try {
    const config = await tenantCheckoutProviderConfigService.getConfigByTenantId(req.params.tenantId);
    res.json({
      success: true,
      data: { tenantId: config.tenantId, tenantSlug: config.tenantSlug, provider: config.provider, status: config.status },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
