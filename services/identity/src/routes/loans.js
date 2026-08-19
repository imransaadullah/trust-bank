// Staff-initiated loan origination — the calling layer that keeps the
// Ledger dumb (see internal/loan's own package comment): the credit-
// eligibility decision happens here, before the Ledger ever creates a
// PENDING loan account, matching the platform's existing "Compliance is
// consulted before the Ledger writes, by the calling backend" rule.
//
// Not maker-checker-gated: origination just captures intent and runs a
// deterministic, policy-based check — no staff discretion is exercised.
// Disbursement (the actual release of funds) IS maker-checker — see
// approvalService.js's LOAN_DISBURSEMENT entry, requested/approved
// through the existing generic /v1/approvals routes, same as every
// other maker-checker action — no bespoke route needed here for it.
const express = require('express');
const branchService = require('../services/branchService');
const backendExecutor = require('../services/backendExecutor');
const { requireStaffSession } = require('../middleware/requireStaffSession');

const router = express.Router();

const TENANT_WIDE_ROLES = ['credit_manager'];

router.post('/v1/loans', requireStaffSession({ roles: ['loan_officer', 'credit_manager'] }), async (req, res, next) => {
  try {
    const { externalCustomerId, principalKobo, tenorDays } = req.body;
    if (!externalCustomerId || !(principalKobo > 0) || !(tenorDays > 0)) {
      return res.status(400).json({ success: false, error: 'externalCustomerId, a positive principalKobo, and a positive tenorDays are required' });
    }

    let branchId;
    if (TENANT_WIDE_ROLES.includes(req.staff.role)) {
      if (req.body.branchId) {
        await branchService.get({ tenantId: req.staff.tenantId, branchId: req.body.branchId });
        branchId = req.body.branchId;
      }
    } else {
      // loan_officer: forced to their own branch, same access-control
      // point already established for account-open in slice 3.
      branchId = req.staff.branchId;
    }

    const tenantId = req.staff.tenantId;

    const account = await backendExecutor.execute('LEDGER_GET_ACCOUNT_BY_CUSTOMER', tenantId, { externalCustomerId });
    const existingLoans = await backendExecutor.execute('LOAN_LIST_BY_CUSTOMER', tenantId, { externalCustomerId });
    const hasActiveLoan = (existingLoans.loans || []).some((l) => l.status === 'PENDING' || l.status === 'ACTIVE');

    const decision = await backendExecutor.execute('LOAN_ELIGIBILITY_CHECK', tenantId, {
      userId: externalCustomerId, kycTier: account.kycTier,
      requestedAmountKobo: principalKobo, requestedTenorDays: tenorDays, hasActiveLoan,
    });
    if (!decision.allowed) {
      return res.status(422).json({ success: false, error: decision.reason, code: 'LOAN_NOT_ELIGIBLE', data: decision });
    }

    const loanAccount = await backendExecutor.execute('LOAN_ORIGINATE', tenantId, {
      externalCustomerId, principalKobo, tenorDays,
      annualRateBps: decision.interestRateAnnualBps, branchId,
    });
    res.status(201).json({ success: true, data: loanAccount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
