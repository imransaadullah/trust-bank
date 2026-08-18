// The gap between "password verified" and "TOTP code verified" during
// login. Deliberately NOT a database row like every other credential in
// this platform — it's single-use, minutes-lived state, so a signed,
// stateless token (HMAC over staffUserId + expiry) avoids a table that
// would otherwise need its own cleanup job for a handful of minutes of
// data. Reuses IDENTITY_ENCRYPTION_KEY as the HMAC key rather than
// introducing a second required secret: even a forged challenge token
// only gets an attacker to the TOTP-code step, which still needs the
// real encrypted mfaSecret (same key, but requires DB access too) to
// produce a valid code.
const crypto = require('crypto');
const config = require('../config');
const { MfaChallengeInvalidError } = require('../utils/errors');

function hmacKey() {
  return Buffer.from(config.encryptionKey, 'hex');
}

function issue(staffUserId) {
  const expiresAt = Date.now() + config.session.mfaChallengeTtlMinutes * 60 * 1000;
  const payload = `${staffUserId}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', hmacKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`, 'utf8').toString('base64url');
}

function verify(challengeToken) {
  try {
    const decoded = Buffer.from(challengeToken, 'base64url').toString('utf8');
    const [staffUserId, expiresAtStr, signature] = decoded.split(':');
    const expiresAt = parseInt(expiresAtStr, 10);
    if (!staffUserId || !Number.isFinite(expiresAt) || !signature) {
      throw new MfaChallengeInvalidError();
    }
    const payload = `${staffUserId}:${expiresAtStr}`;
    const expectedSignature = crypto.createHmac('sha256', hmacKey()).update(payload).digest('hex');
    const actual = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
      throw new MfaChallengeInvalidError();
    }
    if (Date.now() > expiresAt) {
      throw new MfaChallengeInvalidError();
    }
    return staffUserId;
  } catch (err) {
    if (err instanceof MfaChallengeInvalidError) throw err;
    throw new MfaChallengeInvalidError();
  }
}

module.exports = { issue, verify };
