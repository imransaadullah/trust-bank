const config = require('../config');

function requireSharedSecret(req, res, next) {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${config.sharedSecret}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireSharedSecret };
