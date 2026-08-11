const express = require('express');
const reconciliationService = require('../services/reconciliationService');

const router = express.Router();

// On-demand trigger — useful for ops, and for verifying the behavior
// without waiting on the background runner's poll interval.
router.post('/:tenantId/reconcile', async (req, res, next) => {
  try {
    const { staleMinutes, autoRefundMinutes } = req.body || {};
    const results = await reconciliationService.reconcileTenant(req.params.tenantId, {
      staleMinutes, autoRefundMinutes,
    });
    res.json({ success: true, data: { processed: results.length, results } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
