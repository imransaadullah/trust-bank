const express = require('express');
const tenantLedgerCredentialService = require('../services/tenantLedgerCredentialService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

// The operate-scope Ledger credential Payments itself uses to call the
// Ledger on this tenant's behalf — see src/services/ledgerClient.js.
// Normally called by deploy/provision-tenant.sh during onboarding, once
// per tenant (real or sandbox), not by a bank's own integration.
router.post('/:tenantId/ledger-credential', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, error: 'token is required' });
    }
    await tenantLedgerCredentialService.store({ tenantId: req.params.tenantId, token });
    res.status(201).json({ success: true, data: { tenantId: req.params.tenantId, status: 'stored' } });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/ledger-credential', requireApiKey('admin'), async (req, res, next) => {
  try {
    // Confirms a credential is stored without ever returning it.
    await tenantLedgerCredentialService.get(req.params.tenantId);
    res.json({ success: true, data: { tenantId: req.params.tenantId, status: 'stored' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
