// Any authenticated staff role can view open cases — same posture as
// GET /v1/branches. The action that's actually role-gated is
// *requesting a review* (a COMPLIANCE_CASE_REVIEW approval, via
// approvalService's PERMISSIONS map), not looking at the list.
const express = require('express');
const backendExecutor = require('../services/backendExecutor');
const { requireStaffSession } = require('../middleware/requireStaffSession');

const router = express.Router();

router.get('/v1/compliance-cases', requireStaffSession(), async (req, res, next) => {
  try {
    const { status, caseType } = req.query;
    const cases = await backendExecutor.execute('COMPLIANCE_CASE_LIST', req.staff.tenantId, { status, caseType });
    res.json({ success: true, data: cases });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
