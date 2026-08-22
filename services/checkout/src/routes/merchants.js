const express = require('express');
const merchantService = require('../services/merchantService');
const merchantWebhookRunnerService = require('../services/merchantWebhookRunnerService');
const { requireApiKey } = require('../middleware/auth');
const { resolveMerchantScope } = require('../middleware/merchantAuth');

const router = express.Router();
const operate = requireApiKey('operate');

function forbidCrossMerchant(req, res) {
  if (req.scopedMerchantId && req.scopedMerchantId !== req.params.merchantId) {
    res.status(403).json({ success: false, error: 'Not authorized for this merchant' });
    return true;
  }
  return false;
}

router.post('/:tenantId/merchants', operate, async (req, res, next) => {
  try {
    const { name, email, webhookUrl } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'name and email are required' });
    }
    const merchant = await merchantService.create({ tenantId: req.params.tenantId, name, email, webhookUrl });
    res.status(201).json({
      success: true,
      data: {
        id: merchant.id, tenantId: merchant.tenantId, name: merchant.name, email: merchant.email,
        webhookUrl: merchant.webhookUrl, webhookSecret: merchant.webhookSecret, status: merchant.status,
        createdAt: merchant.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Either the tenant's own operate credential, or the merchant's own
// session viewing themselves — see resolveMerchantScope/forbidCrossMerchant.
router.get('/:tenantId/merchants/:merchantId', resolveMerchantScope(), async (req, res, next) => {
  try {
    if (forbidCrossMerchant(req, res)) return;
    const merchant = await merchantService.get({ tenantId: req.params.tenantId, merchantId: req.params.merchantId });
    res.json({
      success: true,
      data: {
        id: merchant.id, tenantId: merchant.tenantId, name: merchant.name, email: merchant.email,
        webhookUrl: merchant.webhookUrl, webhookSecret: merchant.webhookSecret, status: merchant.status,
        createdAt: merchant.createdAt, updatedAt: merchant.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/merchants', operate, async (req, res, next) => {
  try {
    const merchants = await merchantService.list({ tenantId: req.params.tenantId });
    res.json({ success: true, data: merchants });
  } catch (err) {
    next(err);
  }
});

// Mints a brand-new secret — re-readable indefinitely afterward via the
// GET above, same convention as the secret already has, not a shown-once
// credential (see merchantService.rotateWebhookSecret's own comment).
router.post('/:tenantId/merchants/:merchantId/webhook-secret/rotate', resolveMerchantScope(), async (req, res, next) => {
  try {
    if (forbidCrossMerchant(req, res)) return;
    const merchant = await merchantService.rotateWebhookSecret({ tenantId: req.params.tenantId, merchantId: req.params.merchantId });
    res.status(201).json({ success: true, data: { id: merchant.id, webhookSecret: merchant.webhookSecret } });
  } catch (err) {
    next(err);
  }
});

// A real gap this slice closes — no delivery-listing route existed at all.
router.get('/:tenantId/merchants/:merchantId/deliveries', resolveMerchantScope(), async (req, res, next) => {
  try {
    if (forbidCrossMerchant(req, res)) return;
    const { status, limit } = req.query;
    const deliveries = await merchantWebhookRunnerService.list({
      tenantId: req.params.tenantId, merchantId: req.params.merchantId, status, limit,
    });
    res.json({ success: true, data: deliveries });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
