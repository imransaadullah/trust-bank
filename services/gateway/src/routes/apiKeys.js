// Admin-tier only — issuing/listing/revoking the sandbox/production keys
// a bank's own engineers actually use. Same shape as
// services/compliance's routes/credentials.js.
const express = require('express');
const apiKeyService = require('../services/apiKeyService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireApiKey({ allowedTiers: ['admin'] });

router.post('/:tenantId/api-keys', adminOnly, async (req, res, next) => {
  try {
    const { label, tier, rateLimitPerMinute } = req.body;
    if (!label || !['sandbox', 'production'].includes(tier)) {
      return res.status(400).json({ success: false, error: "label is required and tier must be 'sandbox' or 'production'" });
    }
    const { apiKey, token } = await apiKeyService.issue({ tenantId: req.params.tenantId, label, tier, rateLimitPerMinute });
    res.status(201).json({
      success: true,
      data: {
        id: apiKey.id, label: apiKey.label, tier: apiKey.tier, tokenPrefix: apiKey.tokenPrefix,
        rateLimitPerMinute: apiKey.rateLimitPerMinute, token,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/api-keys', adminOnly, async (req, res, next) => {
  try {
    const keys = await apiKeyService.list({ tenantId: req.params.tenantId });
    res.json({ success: true, data: keys });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/api-keys/:apiKeyId/revoke', adminOnly, async (req, res, next) => {
  try {
    await apiKeyService.revoke({ tenantId: req.params.tenantId, apiKeyId: req.params.apiKeyId });
    res.json({ success: true, data: { status: 'revoked' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
