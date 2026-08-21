const express = require('express');
const checkoutSessionService = require('../services/checkoutSessionService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();
const operate = requireApiKey('operate');

router.post('/:tenantId/checkout-sessions', operate, async (req, res, next) => {
  try {
    const { merchantId, amountKobo, customerEmail, description, metadata, idempotencyKey } = req.body;
    if (!merchantId || !amountKobo || amountKobo <= 0 || !customerEmail || !idempotencyKey) {
      return res.status(400).json({
        success: false,
        error: 'merchantId, a positive amountKobo, customerEmail, and idempotencyKey are required',
      });
    }
    const session = await checkoutSessionService.create({
      tenantId: req.params.tenantId, merchantId, amountKobo, customerEmail, description, metadata, idempotencyKey,
    });
    res.status(201).json({
      success: true,
      data: {
        id: session.id, reference: session.reference, authorizationUrl: session.authorizationUrl,
        status: session.status, amountKobo: session.amountKobo, expiresAt: session.expiresAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/checkout-sessions/:sessionId', operate, async (req, res, next) => {
  try {
    const session = await checkoutSessionService.getAndSync({ tenantId: req.params.tenantId, sessionId: req.params.sessionId });
    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/checkout-sessions/:sessionId/cancel', operate, async (req, res, next) => {
  try {
    const session = await checkoutSessionService.cancel({ tenantId: req.params.tenantId, sessionId: req.params.sessionId });
    res.json({ success: true, data: { id: session.id, status: session.status } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
