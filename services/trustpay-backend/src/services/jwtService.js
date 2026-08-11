const jwt = require('jsonwebtoken');
const config = require('../config');

function mintToken(user) {
  return jwt.sign(
    { sub: user.id, phone: user.phoneNumber, kycTier: user.kycTier },
    config.jwt.secret,
    { expiresIn: config.jwt.expiry }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

module.exports = { mintToken, verifyToken };
