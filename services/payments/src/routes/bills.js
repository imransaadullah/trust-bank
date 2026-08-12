const express = require('express');
const billsService = require('../services/billsService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.get('/:tenantId/bills/billers', requireApiKey('operate'), async (req, res, next) => {
  try {
    const result = await billsService.getBillers(req.params.tenantId, req.query.type || null);
    res.json({ success: true, data: result.billers || [] });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/bills/verify', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { billerCode, customerId } = req.body;
    if (!billerCode || !customerId) {
      return res.status(400).json({ success: false, error: 'billerCode and customerId are required' });
    }
    const result = await billsService.verifyBillCustomer(req.params.tenantId, { billerCode, customerId });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/bills/purchase', requireApiKey('operate'), async (req, res, next) => {
  try {
    const {
      externalCustomerId, billerCode, customerId, amount, planCode,
      customerName, phone, reference, debitJournalEntryId,
    } = req.body;

    if (!externalCustomerId || !billerCode || !customerId || !amount || !reference || !debitJournalEntryId) {
      return res.status(400).json({
        success: false,
        error: 'externalCustomerId, billerCode, customerId, amount, reference, and debitJournalEntryId are required',
      });
    }

    const attempt = await billsService.purchaseBill(req.params.tenantId, {
      externalCustomerId, billerCode, customerId, amount, planCode,
      customerName, phone, reference, debitJournalEntryId,
    });
    res.status(201).json({ success: true, data: attempt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
