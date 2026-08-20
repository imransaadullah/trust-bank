const express = require('express');
const cardService = require('../services/cardService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// Issuance is routine customer self-service (a fixed, policy-driven
// limit, not staff discretion) — trustpay-backend calls this directly
// after running Compliance's card-issuance-check itself. This service
// never calls Compliance.
router.post('/:tenantId/cards', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { externalCustomerId, dailySpendLimitKobo, singleTxnLimitKobo } = req.body;
    if (!externalCustomerId || dailySpendLimitKobo == null || singleTxnLimitKobo == null) {
      return res.status(400).json({ success: false, error: 'externalCustomerId, dailySpendLimitKobo, and singleTxnLimitKobo are required' });
    }
    const card = await cardService.issueCard({
      tenantId: req.params.tenantId, externalCustomerId, dailySpendLimitKobo, singleTxnLimitKobo,
    });
    res.status(201).json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/customers/:externalCustomerId/cards', requireApiKey('operate'), async (req, res, next) => {
  try {
    const cards = await cardService.listCardsByCustomer({
      tenantId: req.params.tenantId, externalCustomerId: req.params.externalCustomerId,
    });
    res.json({ success: true, data: cards });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/cards/:cardId/freeze', requireApiKey('operate'), async (req, res, next) => {
  try {
    const card = await cardService.freezeCard({ tenantId: req.params.tenantId, cardId: req.params.cardId });
    res.json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/cards/:cardId/unfreeze', requireApiKey('operate'), async (req, res, next) => {
  try {
    const card = await cardService.unfreezeCard({ tenantId: req.params.tenantId, cardId: req.params.cardId });
    res.json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/cards/:cardId/close', requireApiKey('operate'), async (req, res, next) => {
  try {
    const card = await cardService.closeCard({ tenantId: req.params.tenantId, cardId: req.params.cardId });
    res.json({ success: true, data: card });
  } catch (err) {
    next(err);
  }
});

// A stand-in for what a real card processor's own real-time
// authorization webhook would trigger — not called automatically by
// anything yet (named, out of scope for this slice), but works exactly
// the way that webhook eventually would.
router.post('/:tenantId/cards/:cardId/authorize', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { amountKobo } = req.body;
    if (!(amountKobo > 0)) {
      return res.status(400).json({ success: false, error: 'a positive amountKobo is required' });
    }
    const decision = await cardService.authorize({
      tenantId: req.params.tenantId, cardId: req.params.cardId, amountKobo,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/cards/:cardId/settle', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { amountKobo, reference, idempotencyKey, description } = req.body;
    if (!(amountKobo > 0) || !reference || !idempotencyKey) {
      return res.status(400).json({ success: false, error: 'a positive amountKobo, reference, and idempotencyKey are required' });
    }
    const result = await cardService.settle({
      tenantId: req.params.tenantId, cardId: req.params.cardId,
      amountKobo, reference, idempotencyKey, description,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
