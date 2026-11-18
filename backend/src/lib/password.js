// Password hashing with scrypt (memory-hard, built into Node — no native deps).
// Stored format: scrypt$N$r$p$<salt b64>$<hash b64>
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  // Always do the same amount of work, even without a stored hash (no user enumeration by timing).
  const parts = (stored || 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$').split('$');
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64 || '', 'base64');
  const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), KEYLEN, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return Boolean(stored) && expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** At least 10 characters with upper, lower, digit and symbol. */
export function strongPassword(pw) {
  return typeof pw === 'string' && pw.length >= 10 && pw.length <= 200 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}
