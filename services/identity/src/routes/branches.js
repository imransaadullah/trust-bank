const express = require('express');
const branchService = require('../services/branchService');
const { requireStaffSession } = require('../middleware/requireStaffSession');

const router = express.Router();

router.post('/v1/branches', requireStaffSession({ roles: ['ops_admin'] }), async (req, res, next) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, error: 'code and name are required' });
    }
    const branch = await branchService.create({ tenantId: req.staff.tenantId, code, name });
    res.status(201).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
});

router.get('/v1/branches', requireStaffSession(), async (req, res, next) => {
  try {
    const branches = await branchService.list({ tenantId: req.staff.tenantId });
    res.json({ success: true, data: branches });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
