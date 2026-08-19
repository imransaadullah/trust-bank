// Staff-initiated account opening — the one real caller that gives
// Ledger's branch_id column (services/ledger's ledger_accounts) an
// actual value to tag accounts with. Not maker-checker-gated: opening a
// wallet account isn't money-moving or limit-changing, the architecture
// doc's own trigger for dual approval — it's routine account creation,
// so this calls backendExecutor directly rather than going through
// approvalService's request/approve flow.
const express = require('express');
const branchService = require('../services/branchService');
const backendExecutor = require('../services/backendExecutor');
const { requireStaffSession } = require('../middleware/requireStaffSession');

const router = express.Router();

const TENANT_WIDE_ROLES = ['ops_admin'];

router.post('/v1/accounts', requireStaffSession({ roles: ['teller', 'branch_manager', 'ops_admin'] }), async (req, res, next) => {
  try {
    const { externalCustomerId, productType, currency, kycTier } = req.body;
    if (!externalCustomerId) {
      return res.status(400).json({ success: false, error: 'externalCustomerId is required' });
    }

    let branchId;
    if (TENANT_WIDE_ROLES.includes(req.staff.role)) {
      // ops_admin has no default branch — honor an explicit, real branch
      // if given, or open an unbranched account (e.g. HQ/support) if not.
      if (req.body.branchId) {
        await branchService.get({ tenantId: req.staff.tenantId, branchId: req.body.branchId });
        branchId = req.body.branchId;
      }
    } else {
      // teller/branch_manager: forced to their own branch regardless of
      // what's in the body — the one real access-control point in an
      // otherwise pure-tagging slice. A teller can't claim to open an
      // account at a branch other than their own.
      branchId = req.staff.branchId;
    }

    const result = await backendExecutor.execute('LEDGER_ACCOUNT_OPEN', req.staff.tenantId, {
      externalCustomerId, productType, currency, kycTier, branchId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
