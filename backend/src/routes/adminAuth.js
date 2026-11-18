// Staff sign-in for admins/moderators: email + password, then a 6-digit code
// emailed to the staff address (2-step, can be turned off in settings).
// * 5 wrong passwords lock the account for 15 minutes.
// * Error messages never reveal whether an email exists.
// * Every attempt is written to the audit log.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env, isProd, isTest } from '../config/env.js';
import { query } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { blindIndex, randomDigits, safeEqual } from '../lib/crypto.js';
import { ApiError, badRequest, tooMany, unauthorized } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { hashPassword, strongPassword, verifyPassword } from '../lib/password.js';
import { validate } from '../lib/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { sendEmail } from '../services/email.js';
import { settings } from '../services/settings.js';
import { issueSession, setRefreshCookie } from '../services/tokens.js';
import { loadUser, serializeMe } from '../services/users.js';

export const adminAuthRouter = Router();

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const TICKET_AUDIENCE = 'foundback-admin-2fa';
const codeHash = (userId, code) => blindIndex(`admin2fa:${userId}:${code}`, 'otp');

async function startSession(req, res, userId) {
  await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [userId]);
  const user = await loadUser(userId);
  const { accessToken, refresh } = await issueSession(user, req);
  setRefreshCookie(res, refresh);
  await audit({ actorId: userId, action: 'admin.login', ip: req.ip });
  res.json({ accessToken, user: await serializeMe(user) });
}

adminAuthRouter.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) }) }),
  async (req, res) => {
    const { email, password } = req.body;
    const { rows } = await query(
      "SELECT id, email, password_hash, failed_logins, locked_until, role, status FROM users WHERE email = $1 AND role IN ('admin','moderator')",
      [email],
    );
    const u = rows[0];
    if (u?.locked_until && new Date(u.locked_until) > new Date()) {
      throw new ApiError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes.');
    }
    const ok = await verifyPassword(password, u?.password_hash); // runs even when u is missing (constant time)
    if (!u || !ok || u.status !== 'active') {
      if (u) {
        const fails = u.failed_logins + 1;
        const lock = fails >= MAX_FAILS;
        await query(
          `UPDATE users SET failed_logins = $2,
             locked_until = CASE WHEN $3 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END
           WHERE id = $1`,
          [u.id, lock ? 0 : fails, lock],
        );
        await audit({ actorId: u.id, action: fails >= MAX_FAILS ? 'admin.locked' : 'admin.login_failed', ip: req.ip });
      } else {
        await audit({ action: 'admin.login_failed_unknown', meta: { email: email.replace(/(^.).*(@.*$)/, '$1***$2') }, ip: req.ip });
      }
      throw unauthorized('Email or password is incorrect.');
    }

    if (!(await settings()).admin_2fa_enabled) return startSession(req, res, u.id);

    // Step 2: email a code.
    const recent = await query("SELECT count(*)::int AS n FROM otp_codes WHERE purpose = 'admin_2fa' AND user_id = $1 AND created_at > now() - interval '10 minutes'", [u.id]);
    if (recent.rows[0].n >= (isTest ? 1000 : 5)) throw tooMany('Too many codes requested. Please wait a few minutes.');
    const code = randomDigits(6);
    await query(
      "INSERT INTO otp_codes (subject_hash, purpose, code_hash, user_id, expires_at, ip) VALUES ($1,'admin_2fa',$2,$3, now() + interval '10 minutes', $4)",
      [`admin:${u.id}`, codeHash(u.id, code), u.id, req.ip],
    );
    const s = await settings();
    if (s.resend_api_key) {
      try {
        await sendEmail({
          to: u.email,
          subject: `FoundBack admin sign-in code: ${code}`,
          text: `Your FoundBack admin sign-in code is ${code}. It expires in 10 minutes.\nIf this wasn't you, change your password now.\nIP: ${req.ip}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;color:#14272a"><h2 style="color:#0f4c4f">Admin sign-in</h2><p>Your code:</p><p style="font-size:32px;font-weight:800;letter-spacing:6px;background:#fdf0db;padding:12px 18px;border-radius:12px;display:inline-block">${code}</p><p style="color:#5b6f72">Expires in 10 minutes. If this wasn't you, change your password now. Request IP: ${req.ip}</p></div>`,
        });
      } catch (err) {
        logger.error({ err: err.message }, 'admin 2FA email failed');
        throw new ApiError(503, 'EMAIL_FAILED', 'We could not send the sign-in code. Check the email settings.');
      }
    } else {
      // Break-glass when email isn't configured yet: the code is only in the private server logs.
      logger.warn(`[admin-2fa] Email is not configured. Sign-in code for ${u.email}: ${code}`);
    }
    const ticket = jwt.sign({ purpose: 'admin2fa' }, env.JWT_ACCESS_SECRET, { subject: u.id, audience: TICKET_AUDIENCE, expiresIn: '10m', algorithm: 'HS256' });
    res.json({ twoFactor: true, ticket, sentTo: u.email.replace(/(^.{2}).*(@.*$)/, '$1•••$2'), ...(!isProd && env.OTP_DEV_ECHO ? { devCode: code } : {}) });
  },
);

adminAuthRouter.post(
  '/verify',
  authLimiter,
  validate({ body: z.object({ ticket: z.string().min(20).max(1000), code: z.string().regex(/^\d{6}$/) }) }),
  async (req, res) => {
    let userId;
    try {
      userId = jwt.verify(req.body.ticket, env.JWT_ACCESS_SECRET, { audience: TICKET_AUDIENCE, algorithms: ['HS256'] }).sub;
    } catch {
      throw unauthorized('This sign-in attempt expired. Start again.');
    }
    const { rows } = await query(
      "SELECT * FROM otp_codes WHERE purpose = 'admin_2fa' AND user_id = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
      [userId],
    );
    const otp = rows[0];
    if (!otp) throw badRequest('OTP_EXPIRED', 'This code has expired. Sign in again.');
    if (otp.attempts >= 5) throw tooMany('Too many wrong codes. Sign in again.');
    await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
    if (!safeEqual(otp.code_hash, codeHash(userId, req.body.code))) {
      await audit({ actorId: userId, action: 'admin.2fa_failed', ip: req.ip });
      throw badRequest('OTP_INVALID', 'That code is not correct.');
    }
    await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
    await startSession(req, res, userId);
  },
);

/** Create the first admin from ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD (idempotent). */
export async function bootstrapAdmin(log = logger) {
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  if (!email) return;
  const { rows } = await query('SELECT id, password_hash, role FROM users WHERE email = $1', [email]);
  if (rows[0]) {
    if (rows[0].role !== 'admin') await query("UPDATE users SET role = 'admin' WHERE id = $1", [rows[0].id]);
    if (!rows[0].password_hash && env.ADMIN_INITIAL_PASSWORD) {
      if (!strongPassword(env.ADMIN_INITIAL_PASSWORD)) return log.warn('[admin] ADMIN_INITIAL_PASSWORD is too weak — not set.');
      await query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].id, await hashPassword(env.ADMIN_INITIAL_PASSWORD)]);
    }
    return;
  }
  if (!strongPassword(env.ADMIN_INITIAL_PASSWORD)) {
    return log.warn('[admin] ADMIN_EMAIL is set but ADMIN_INITIAL_PASSWORD is missing or weak (10+ chars, upper, lower, digit, symbol). Admin not created.');
  }
  await query(
    `INSERT INTO users (email, email_verified, display_name, role, password_hash, language, text_dir, onboarding_completed_at)
     VALUES ($1, true, 'FoundBack Admin', 'admin', $2, 'en', 'ltr', now())`,
    [email, await hashPassword(env.ADMIN_INITIAL_PASSWORD)],
  );
  log.info?.(`[admin] created admin account ${email}`);
}

export { strongPassword };
