const express = require('express');
const accountProvisioningService = require('../services/accountProvisioningService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/accounts', requireApiKey('operate'), async (req, res, next) => {
  try {
    const { externalCustomerId, email, firstName, lastName, phoneNumber, currency } = req.body;
    if (!externalCustomerId) {
      return res.status(400).json({ success: false, error: 'externalCustomerId is required' });
    }
    const account = await accountProvisioningService.provisionAccount(req.params.tenantId, {
      externalCustomerId, email, firstName, lastName, phoneNumber, currency,
    });
    res.status(201).json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/accounts/:externalCustomerId', requireApiKey('operate'), async (req, res, next) => {
  try {
    const account = await accountProvisioningService.findByCustomer(req.params.tenantId, req.params.externalCustomerId);
    if (!account) {
      return res.status(404).json({ success: false, error: 'No provisioned account for this customer' });
    }
    res.json({ success: true, data: account });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
