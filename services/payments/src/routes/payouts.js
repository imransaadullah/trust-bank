const express = require('express');
const settlementService = require('../services/settlementService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/payouts', requireApiKey('operate'), async (req, res, next) => {
  try {
    const {
      externalCustomerId, amount, beneficiaryAccountNumber, beneficiaryBankCode,
      beneficiaryName, reference, debitJournalEntryId, description,
    } = req.body;

    if (!externalCustomerId || !amount || !beneficiaryAccountNumber || !beneficiaryBankCode || !reference || !debitJournalEntryId) {
      return res.status(400).json({
        success: false,
        error: 'externalCustomerId, amount, beneficiaryAccountNumber, beneficiaryBankCode, reference, and debitJournalEntryId are required',
      });
    }

    const attempt = await settlementService.initiatePayout(req.params.tenantId, {
      externalCustomerId, amount, beneficiaryAccountNumber, beneficiaryBankCode,
      beneficiaryName, reference, debitJournalEntryId, description,
    });
    res.status(201).json({ success: true, data: attempt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
