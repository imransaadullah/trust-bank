const crypto = require('crypto');

describe('tenantSecrets encryptJSON/decryptJSON', () => {
  beforeAll(() => {
    process.env.PAYMENTS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  });

  test('round-trips a credentials object', () => {
    const { encryptJSON, decryptJSON } = require('../src/crypto/tenantSecrets');
    const original = { secretKey: 'sk_live_abc123', preferredBank: 'wema-bank' };
    const encrypted = encryptJSON(original);
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain('sk_live_abc123');
    expect(decryptJSON(encrypted)).toEqual(original);
  });

  test('rejects a tampered ciphertext (auth tag check)', () => {
    const { encryptJSON, decryptJSON } = require('../src/crypto/tenantSecrets');
    const encrypted = encryptJSON({ secretKey: 'sk_live_abc123' });
    const [iv, authTag, ciphertext] = encrypted.split('.');
    const tamperedCiphertext = Buffer.from(ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff;
    const tampered = [iv, authTag, tamperedCiphertext.toString('base64')].join('.');
    expect(() => decryptJSON(tampered)).toThrow();
  });

  test('rejects a malformed payload', () => {
    const { decryptJSON } = require('../src/crypto/tenantSecrets');
    expect(() => decryptJSON('not-a-valid-payload')).toThrow('malformed');
  });
});
