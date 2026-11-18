// Field-level encryption (AES-256-GCM) and keyed hashing.
//
// encrypt() output format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
// The version prefix lets us rotate keys later (add v2 + ENCRYPTION_KEY_V2 and
// re-encrypt lazily).
//
// blindIndex() is an HMAC-SHA256 with a server-side pepper: it lets us look
// up / compare values (phone numbers, ID numbers, IMEI) without storing them
// in plaintext and without the hash being brute-forceable from a DB dump alone.
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');

export function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return null;
  const [version, ivB64, tagB64, ctB64] = payload.split(':');
  if (version !== 'v1') throw new Error('Unsupported ciphertext version');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Normalise free text before hashing so "ab 12" and "AB12" compare equal. */
export const normalizeForHash = (value) => String(value).toUpperCase().replace(/[\s\-_.]/g, '');

export function blindIndex(value, purpose = 'generic') {
  return crypto.createHmac('sha256', env.HASH_PEPPER).update(`${purpose}:${normalizeForHash(value)}`).digest('hex');
}

/** SHA-256 of an opaque random token (refresh tokens). */
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

/** Uniform random numeric code, e.g. OTPs and handover codes. */
export function randomDigits(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) out += crypto.randomInt(0, 10);
  return out;
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
