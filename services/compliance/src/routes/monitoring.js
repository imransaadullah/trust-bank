const express = require('express');
const monitoringPolicyService = require('../services/monitoringPolicyService');
const screeningService = require('../services/screeningService');

const router = express.Router();

router.post('/:tenantId/compliance/monitoring-policy', async (req, res, next) => {
  try {
    const {
      jurisdiction, velocityWindowHours, velocityMaxTransactionCount,
      velocityMaxDistinctCounterparties, structuringThresholdKobo, structuringWindowCount,
      largeSingleTxnThresholdKobo, effectiveFrom,
    } = req.body;
    if (
      velocityWindowHours == null || velocityMaxTransactionCount == null
      || velocityMaxDistinctCounterparties == null || structuringThresholdKobo == null
      || structuringWindowCount == null || largeSingleTxnThresholdKobo == null
    ) {
      return res.status(400).json({
        success: false,
        error: 'velocityWindowHours, velocityMaxTransactionCount, velocityMaxDistinctCounterparties, '
          + 'structuringThresholdKobo, structuringWindowCount, and largeSingleTxnThresholdKobo are required',
      });
    }
    const policy = await monitoringPolicyService.publishMonitoringPolicy({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG',
      velocityWindowHours, velocityMaxTransactionCount, velocityMaxDistinctCounterparties,
      structuringThresholdKobo, structuringWindowCount, largeSingleTxnThresholdKobo, effectiveFrom,
    });
    res.status(201).json({ success: true, data: policy });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/screen-transaction', async (req, res, next) => {
  try {
    const { jurisdiction, userId, amount, counterpartyId, recentTransactions, transactionRef } = req.body;
    if (!userId || amount == null) {
      return res.status(400).json({ success: false, error: 'userId and amount are required' });
    }
    const decision = await screeningService.screenTransaction({
      tenantId: req.params.tenantId, jurisdiction: jurisdiction || 'NG', userId, amount,
      counterpartyId, recentTransactions: recentTransactions || [], transactionRef,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/screen-sanctions', async (req, res, next) => {
  try {
    const { userId, fullName } = req.body;
    if (!userId || !fullName) {
      return res.status(400).json({ success: false, error: 'userId and fullName are required' });
    }
    const decision = await screeningService.screenSanctions({
      tenantId: req.params.tenantId, userId, fullName,
    });
    res.json({ success: true, data: decision });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/compliance/cases', async (req, res, next) => {
  try {
    const { status, caseType } = req.query;
    const cases = await screeningService.listCases({ tenantId: req.params.tenantId, status, caseType });
    res.json({ success: true, data: cases });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/compliance/cases/:caseId/review', async (req, res, next) => {
  try {
    const { status, reviewedBy, reviewNotes } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }
    const updated = await screeningService.reviewCase({
      tenantId: req.params.tenantId, caseId: req.params.caseId, status, reviewedBy, reviewNotes,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
