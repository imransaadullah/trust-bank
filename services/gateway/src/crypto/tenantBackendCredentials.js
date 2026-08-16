// Per-tenant Ledger/Payments/Compliance operate credentials
// (TenantBackendCredential.encryptedToken) are as sensitive as anything
// in this platform — a leak here is a leak of every tenant's operate
// access to all three backends, not just this service's own data. Same
// AES-256-GCM pattern services/payments already uses for
// TenantProviderConfig.encryptedCredentials
// (services/payments/src/crypto/tenantSecrets.js) — encrypted with a key
// that never touches the database.
const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const key = Buffer.from(config.encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('tenantBackendCredentials: GATEWAY_ENCRYPTION_KEY must be 32 bytes hex-encoded (64 hex chars)');
  }
  return key;
}

function encrypt(token) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(token, 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

function decrypt(encrypted) {
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split('.');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('tenantBackendCredentials: malformed encrypted payload');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

module.exports = { encrypt, decrypt };
