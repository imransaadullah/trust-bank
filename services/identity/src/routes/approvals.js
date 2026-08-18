// Dual-approval on the concrete gaps this phase exists to close — see
// approvalService.js and ApprovalRequest's schema comment. All routes
// require a staff session; which role can request/approve a given
// actionType is checked inside approvalService itself (data-dependent,
// not expressible as a single static role list per route).
const express = require('express');
const approvalService = require('../services/approvalService');
const { requireStaffSession } = require('../middleware/requireStaffSession');

const router = express.Router();
const auth = requireStaffSession();

router.post('/v1/approvals', auth, async (req, res, next) => {
  try {
    const { actionType, payload } = req.body;
    if (!actionType || !payload) {
      return res.status(400).json({ success: false, error: 'actionType and payload are required' });
    }
    const approval = await approvalService.request({
      tenantId: req.staff.tenantId, actionType, payload, requester: req.staff,
    });
    res.status(201).json({ success: true, data: approval });
  } catch (err) {
    next(err);
  }
});

router.get('/v1/approvals', auth, async (req, res, next) => {
  try {
    const approvals = await approvalService.list({ tenantId: req.staff.tenantId, status: req.query.status });
    res.json({ success: true, data: approvals });
  } catch (err) {
    next(err);
  }
});

router.get('/v1/approvals/:id', auth, async (req, res, next) => {
  try {
    const approval = await approvalService.get({ tenantId: req.staff.tenantId, id: req.params.id });
    res.json({ success: true, data: approval });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/approvals/:id/approve', auth, async (req, res, next) => {
  try {
    const approval = await approvalService.approve({
      tenantId: req.staff.tenantId, id: req.params.id, approver: req.staff,
    });
    res.json({ success: true, data: approval });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/approvals/:id/reject', auth, async (req, res, next) => {
  try {
    const { reason } = req.body;
    const approval = await approvalService.reject({
      tenantId: req.staff.tenantId, id: req.params.id, approver: req.staff, reason,
    });
    res.json({ success: true, data: approval });
  } catch (err) {
    next(err);
  }
});

router.post('/v1/approvals/:id/retry-execution', auth, async (req, res, next) => {
  try {
    const approval = await approvalService.retryExecution({
      tenantId: req.staff.tenantId, id: req.params.id, approver: req.staff,
    });
    res.json({ success: true, data: approval });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
