/* ==========================================================================
   Space Connect | Token Encryption & HMAC Utilities
   AES-256-GCM encryption for OAuth tokens stored in the database.
   The key is derived from SESSION_SECRET — never store it in plain text.
   ========================================================================== */

const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const SALT       = 'space-connect-token-v1';

/**
 * Derive a stable 32-byte key from SESSION_SECRET using scrypt.
 * Called lazily so the secret is read at runtime (not module-load time).
 */
let _key = null;
function getKey() {
  if (_key) return _key;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.warn('⚠️  SESSION_SECRET is not set — token encryption is degraded. Set it as a Replit Secret.');
  }
  _key = crypto.scryptSync(secret || 'dev-fallback-not-for-production', SALT, 32);
  return _key;
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded blob: [12-byte IV | 16-byte GCM tag | ciphertext].
 * Returns null if text is null/empty.
 */
function encrypt(text) {
  if (!text) return null;
  const iv       = crypto.randomBytes(12);
  const cipher   = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag      = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64-encoded blob produced by encrypt().
 * Returns null on failure (wrong key, tampered data, or empty input).
 */
function decrypt(encoded) {
  if (!encoded) return null;
  try {
    const buf       = Buffer.from(encoded, 'base64');
    const iv        = buf.subarray(0, 12);
    const tag       = buf.subarray(12, 28);
    const data      = buf.subarray(28);
    const decipher  = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Compute a deterministic HMAC-SHA256 of text using SESSION_SECRET.
 * Used to create a searchable, non-reversible fingerprint of an access token
 * so the database can look up a user by their token without storing it in plain text.
 * Returns null if text is null/empty.
 */
function hmac(text) {
  if (!text) return null;
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'dev-fallback-not-for-production')
    .update(text)
    .digest('hex');
}

module.exports = { encrypt, decrypt, hmac };
