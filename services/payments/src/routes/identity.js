const express = require('express');
const tenantConfigService = require('../services/tenantConfigService');

const router = express.Router();

router.post('/:tenantId/identity/verify', async (req, res, next) => {
  try {
    const { type, number, firstName, lastName } = req.body;
    if (!['bvn', 'nin'].includes(type) || !number || !firstName || !lastName) {
      return res.status(400).json({ success: false, error: 'type (bvn|nin), number, firstName, and lastName are required' });
    }
    const { provider } = await tenantConfigService.getProviderForTenant(req.params.tenantId);
    const result = await provider.verifyIdentity({ type, number, firstName, lastName });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
