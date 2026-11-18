// One-time sign-in codes sent by email.
// * 6 digits, valid 10 minutes, max 5 attempts, single use.
// * Stored as an HMAC (never plaintext); the address is referenced by its
//   blind index only.
// * Per-address throttle: 3 codes per 10 minutes and 10 per day.
import { env, isProd } from '../config/env.js';
import { query } from '../db/pool.js';
import { blindIndex, randomDigits, safeEqual } from '../lib/crypto.js';
import { ApiError, badRequest, tooMany } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { sendEmail } from './email.js';
import { settings } from './settings.js';

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const emailHash = (email) => blindIndex(String(email).trim().toLowerCase(), 'email');
const codeHash = (subject, code) => blindIndex(`${subject}:${code}`, 'otp');

const TEXT = {
  en: { subject: (c) => `${c} is your FoundBack code`, intro: 'Use this code to sign in to FoundBack:', expiry: 'It expires in 10 minutes. Never share it with anyone — FoundBack staff will never ask for it.', ignore: "If you didn't ask for this, you can ignore this email." },
  ur: { subject: (c) => `${c} آپ کا FoundBack کوڈ ہے`, intro: 'FoundBack میں سائن اِن کے لیے یہ کوڈ استعمال کریں:', expiry: 'یہ 10 منٹ میں ختم ہو جائے گا۔ یہ کسی کو نہ بتائیں — FoundBack کا عملہ کبھی یہ کوڈ نہیں مانگے گا۔', ignore: 'اگر آپ نے یہ نہیں مانگا تو اس ای میل کو نظر انداز کر دیں۔' },
  ar: { subject: (c) => `${c} هو رمز FoundBack الخاص بك`, intro: 'استخدم هذا الرمز لتسجيل الدخول إلى FoundBack:', expiry: 'ينتهي خلال 10 دقائق. لا تشاركه مع أي شخص — لن يطلبه منك فريق FoundBack أبدًا.', ignore: 'إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.' },
};

function codeEmail(code, language) {
  const t = TEXT[language] ?? TEXT.en;
  const dir = language === 'ur' || language === 'ar' ? 'rtl' : 'ltr';
  return {
    subject: t.subject(code),
    text: `${t.intro}\n\n${code}\n\n${t.expiry}\n${t.ignore}`,
    html: `<div dir="${dir}" style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#14272a">
<h2 style="color:#0f4c4f;margin-bottom:8px">FoundBack</h2><p>${t.intro}</p>
<p style="font-size:32px;font-weight:800;letter-spacing:6px;background:#fdf0db;padding:12px 18px;border-radius:12px;display:inline-block;direction:ltr">${code}</p>
<p style="color:#5b6f72">${t.expiry}</p><p style="color:#5b6f72;font-size:13px">${t.ignore}</p></div>`,
  };
}

export async function sendEmailOtp({ email, purpose = 'signin_email', userId = null, language = 'en', ip = null }) {
  const subject = emailHash(email);
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '10 minutes')::int AS recent,
            count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS daily
     FROM otp_codes WHERE subject_hash = $1`,
    [subject],
  );
  if (rows[0].recent >= 3 || rows[0].daily >= 10) throw tooMany('Too many codes requested for this email. Please wait a few minutes.');

  const code = randomDigits(6);
  await query(
    `INSERT INTO otp_codes (subject_hash, purpose, code_hash, user_id, expires_at, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
    [subject, purpose, codeHash(subject, code), userId, new Date(Date.now() + TTL_MS), ip],
  );

  const configured = Boolean((await settings()).resend_api_key);
  if (configured) {
    try {
      await sendEmail({ to: email, ...codeEmail(code, language) });
    } catch (err) {
      logger.error({ err: err.message }, 'sign-in code email failed');
      throw new ApiError(503, 'EMAIL_FAILED', 'We could not send the email. Please try again in a moment.');
    }
  } else if (!isProd) {
    logger.info(`[email:dev] sign-in code for ${email}: ${code}`);
  } else {
    throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email sign-in is not set up yet. Please use Google.');
  }
  // Demo/test convenience: echo the code, never in production.
  const echo = !configured && env.OTP_DEV_ECHO && !isProd;
  return { expiresIn: TTL_MS / 1000, ...(echo ? { devCode: code } : {}) };
}

/** Verifies and consumes the latest code for this address/purpose. */
export async function verifyEmailOtp({ email, code, purpose = 'signin_email' }) {
  const subject = emailHash(email);
  const { rows } = await query(
    `SELECT * FROM otp_codes
     WHERE subject_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [subject, purpose],
  );
  const otp = rows[0];
  if (!otp) throw badRequest('OTP_EXPIRED', 'This code has expired. Please request a new one.');
  if (otp.attempts >= MAX_ATTEMPTS) throw tooMany('Too many wrong attempts. Please request a new code.');

  await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
  if (!safeEqual(otp.code_hash, codeHash(subject, String(code).trim()))) {
    throw badRequest('OTP_INVALID', 'That code is not correct.');
  }
  const { rowCount } = await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [otp.id]);
  if (!rowCount) throw badRequest('OTP_EXPIRED', 'This code has already been used.');
}
