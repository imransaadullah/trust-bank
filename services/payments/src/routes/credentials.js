const express = require('express');
const credentialService = require('../services/credentialService');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

router.post('/:tenantId/credentials', requireApiKey('admin'), async (req, res, next) => {
  try {
    const { label, scope } = req.body;
    if (!label || !['admin', 'operate'].includes(scope)) {
      return res.status(400).json({ success: false, error: "label is required and scope must be 'admin' or 'operate'" });
    }
    const { credential, token } = await credentialService.issue({ tenantId: req.params.tenantId, label, scope });
    res.status(201).json({
      success: true,
      data: {
        id: credential.id, label: credential.label, scope: credential.scope, tokenPrefix: credential.tokenPrefix,
        // The only time this ever appears in a response — store it now.
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:tenantId/credentials', requireApiKey('admin'), async (req, res, next) => {
  try {
    const credentials = await credentialService.list({ tenantId: req.params.tenantId });
    res.json({ success: true, data: credentials });
  } catch (err) {
    next(err);
  }
});

router.post('/:tenantId/credentials/:credentialId/revoke', requireApiKey('admin'), async (req, res, next) => {
  try {
    await credentialService.revoke({ tenantId: req.params.tenantId, credentialId: req.params.credentialId });
    res.json({ success: true, data: { status: 'revoked' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
