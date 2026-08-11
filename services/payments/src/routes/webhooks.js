// Mounted with express.raw() in app.js — signature verification needs the
// exact raw bytes Paystack signed, not a re-serialized JSON.parse() of it.
const express = require('express');
const settlementService = require('../services/settlementService');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/:tenantSlug/:provider', async (req, res, next) => {
  try {
    const signature = req.headers['x-paystack-signature'] || req.headers['x-signature'];
    const result = await settlementService.resolveInboundWebhook(
      req.params.tenantSlug, req.params.provider, req.body, signature
    );
    if (!result.handled) {
      logger.warn(`[Webhook] Not handled: ${result.reason}`, { tenantSlug: req.params.tenantSlug });
    }
    // Always 200 once signature verification passes — an unhandled event
    // type isn't a delivery failure, and we don't want the provider
    // retrying something we've already decided to ignore.
    res.status(200).json({ success: true, handled: result.handled });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
