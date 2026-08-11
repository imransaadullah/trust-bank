const jwtService = require('../services/jwtService');

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const payload = jwtService.verifyToken(auth.slice('Bearer '.length));
    req.userId = payload.sub;
    next();
  } catch (_err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
