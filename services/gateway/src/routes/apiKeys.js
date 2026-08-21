// Admin-tier only — issuing/listing/revoking/rotating the sandbox/
// production keys a bank's own engineers actually use, plus reading
// back usage for them. Same shape as services/compliance's
// routes/credentials.js.
const express = require('express');
const apiKeyService = require('../services/apiKeyService');
const usageService = require('../services/usageService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const adminOnly = requireApiKey({ allowedTiers: ['admin'] });
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

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

router.post('/:tenantId/api-keys/:apiKeyId/rotate', adminOnly, async (req, res, next) => {
  try {
    const { apiKey, token } = await apiKeyService.rotate({ tenantId: req.params.tenantId, apiKeyId: req.params.apiKeyId });
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

// Usage-transparency, not billing — request counts only, no cost/quota/
// plan fields. See ApiKeyDailyUsage's own schema comment for why.
router.get('/:tenantId/usage', adminOnly, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if ((from && !DATE_PARAM_RE.test(from)) || (to && !DATE_PARAM_RE.test(to))) {
      return res.status(400).json({ success: false, error: "from/to must be YYYY-MM-DD" });
    }
    const usage = await usageService.getUsage({ tenantId: req.params.tenantId, from, to });
    res.json({ success: true, data: usage });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
