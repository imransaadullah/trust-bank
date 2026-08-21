const express = require('express');
const merchantService = require('../services/merchantService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const operate = requireApiKey('operate');

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

router.get('/:tenantId/merchants/:merchantId', operate, async (req, res, next) => {
  try {
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

module.exports = router;
