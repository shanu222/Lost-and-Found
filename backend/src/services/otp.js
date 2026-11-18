// One-time codes sent by SMS.
// * 6 digits, valid 5 minutes, max 5 attempts, single use.
// * Stored as an HMAC (never plaintext). Phone numbers are referenced by their
//   blind index only.
// * Per-number throttle: 3 codes per 10 minutes and 10 per day.
import { env, isProd } from '../config/env.js';
import { query } from '../db/pool.js';
import { blindIndex, randomDigits, safeEqual } from '../lib/crypto.js';
import { badRequest, tooMany } from '../lib/errors.js';
import { otpMessage, sendSms } from './sms/index.js';

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const codeHash = (phoneHash, code) => blindIndex(`${phoneHash}:${code}`, 'otp');

export async function sendOtp({ e164, purpose, userId = null, language = 'en', ip = null }) {
  const phoneHash = blindIndex(e164, 'phone');
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '10 minutes')::int AS recent,
            count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS daily
     FROM otp_codes WHERE phone_hash = $1`,
    [phoneHash],
  );
  if (rows[0].recent >= 3 || rows[0].daily >= 10) throw tooMany('Too many codes requested for this number. Please wait a few minutes.');

  const code = randomDigits(6);
  await query(
    `INSERT INTO otp_codes (phone_hash, purpose, code_hash, user_id, expires_at, ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [phoneHash, purpose, codeHash(phoneHash, code), userId, new Date(Date.now() + TTL_MS), ip],
  );
  const provider = await sendSms({ to: e164, body: otpMessage(code, language) });

  // Demo convenience: echo the code in the API response. Only with the dev
  // SMS provider and only when explicitly enabled outside production.
  const echo = provider === 'dev' && env.OTP_DEV_ECHO && !isProd;
  return { expiresIn: TTL_MS / 1000, ...(echo ? { devCode: code } : {}) };
}

/** Verifies and consumes the latest code for this number/purpose. */
export async function verifyOtp({ e164, purpose, code, userId = null }) {
  const phoneHash = blindIndex(e164, 'phone');
  const { rows } = await query(
    `SELECT * FROM otp_codes
     WHERE phone_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
       AND ($3::uuid IS NULL OR user_id = $3)
     ORDER BY created_at DESC LIMIT 1`,
    [phoneHash, purpose, userId],
  );
  const otp = rows[0];
  if (!otp) throw badRequest('OTP_EXPIRED', 'This code has expired. Please request a new one.');
  if (otp.attempts >= MAX_ATTEMPTS) throw tooMany('Too many wrong attempts. Please request a new code.');

  // Count the attempt first (atomic), then compare in constant time.
  await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
  if (!safeEqual(otp.code_hash, codeHash(phoneHash, String(code).trim()))) {
    throw badRequest('OTP_INVALID', 'That code is not correct.');
  }
  const { rowCount } = await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [otp.id]);
  if (!rowCount) throw badRequest('OTP_EXPIRED', 'This code has already been used.');
  return { phoneHash };
}

