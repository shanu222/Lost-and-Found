// /api/auth — phone OTP sign-in, Google sign-in, refresh rotation, logout.
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { isSupportedLanguage, textDirFor } from '../data/languages.js';
import { audit } from '../lib/audit.js';
import { encrypt } from '../lib/crypto.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { countryCode, validate } from '../lib/validate.js';
import { authLimiter, otpLimiter } from '../middleware/rateLimit.js';
import { sendOtp, verifyOtp } from '../services/otp.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  issueSession,
  revokeRefreshFamily,
  rotateRefreshToken,
  setRefreshCookie,
} from '../services/tokens.js';
import { loadUser, serializeMe } from '../services/users.js';

export const authRouter = Router();
const google = new OAuth2Client();

const language = z
  .string()
  .optional()
  .transform((l) => (l && isSupportedLanguage(l) ? l : 'en'));

async function respondWithSession(req, res, userId, status = 200) {
  const user = await loadUser(userId);
  if (user.status === 'banned') throw forbidden('ACCOUNT_BANNED', 'This account has been suspended.');
  const { accessToken, refresh } = await issueSession(user, req);
  setRefreshCookie(res, refresh);
  res.status(status).json({ accessToken, user: await serializeMe(user) });
}

// Step 1 of phone sign-in: send a code.
authRouter.post(
  '/otp/request',
  otpLimiter,
  validate({ body: z.object({ phone: z.string().min(4).max(32), countryCode: countryCode.optional(), language }) }),
  async (req, res) => {
    const phone = normalizePhone(req.body.phone, req.body.countryCode);
    const result = await sendOtp({ e164: phone.e164, purpose: 'signin', language: req.body.language, ip: req.ip });
    res.json({ sent: true, phone: phone.international, ...result });
  },
);

// Step 2: verify the code → sign in (creating the account on first use).
authRouter.post(
  '/otp/verify',
  authLimiter,
  validate({
    body: z.object({
      phone: z.string().min(4).max(32),
      countryCode: countryCode.optional(),
      code: z.string().regex(/^\d{6}$/),
      language,
    }),
  }),
  async (req, res) => {
    const phone = normalizePhone(req.body.phone, req.body.countryCode);
    const { phoneHash } = await verifyOtp({ e164: phone.e164, purpose: 'signin', code: req.body.code });

    const existing = await query('SELECT id, status FROM users WHERE phone_hash = $1', [phoneHash]);
    let userId = existing.rows[0]?.id;
    let created = false;
    if (existing.rows[0]?.status === 'deleted') throw forbidden('ACCOUNT_DELETED', 'This account was deleted.');
    if (!userId) {
      const { rows } = await query(
        `INSERT INTO users (phone_enc, phone_hash, phone_last4, phone_verified_at, language, text_dir)
         VALUES ($1,$2,$3,now(),$4,$5) RETURNING id`,
        [encrypt(phone.e164), phoneHash, phone.last4, req.body.language, textDirFor(req.body.language)],
      );
      userId = rows[0].id;
      created = true;
    }
    await audit({ actorId: userId, action: created ? 'auth.signup_phone' : 'auth.signin_phone', ip: req.ip });
    await respondWithSession(req, res, userId, created ? 201 : 200);
  },
);

// Google Identity Services: the web app sends the ID token (credential).
authRouter.post(
  '/google',
  authLimiter,
  validate({ body: z.object({ idToken: z.string().min(20), language }) }),
  async (req, res) => {
    if (!env.GOOGLE_CLIENT_ID) throw badRequest('GOOGLE_DISABLED', 'Google sign-in is not configured.');
    let payload;
    try {
      const ticket = await google.verifyIdToken({ idToken: req.body.idToken, audience: env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw unauthorized('Google sign-in failed. Please try again.');
    }
    if (!payload?.sub) throw unauthorized('Google sign-in failed.');

    const existing = await query('SELECT id, status FROM users WHERE google_sub = $1', [payload.sub]);
    let userId = existing.rows[0]?.id;
    if (existing.rows[0]?.status === 'deleted') throw forbidden('ACCOUNT_DELETED', 'This account was deleted.');
    let created = false;
    if (!userId) {
      // We do NOT auto-link to an existing account by email (account takeover risk).
      const email = payload.email_verified ? payload.email : null;
      const emailTaken = email ? (await query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount > 0 : false;
      const { rows } = await query(
        `INSERT INTO users (google_sub, email, email_verified, display_name, language, text_dir)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [payload.sub, emailTaken ? null : email, Boolean(email && !emailTaken), payload.given_name || payload.name || null,
          req.body.language, textDirFor(req.body.language)],
      );
      userId = rows[0].id;
      created = true;
    }
    await audit({ actorId: userId, action: created ? 'auth.signup_google' : 'auth.signin_google', ip: req.ip });
    await respondWithSession(req, res, userId, created ? 201 : 200);
  },
);

// Rotate the refresh cookie and return a fresh access token.
authRouter.post('/refresh', authLimiter, async (req, res) => {
  try {
    const { user, accessToken, refresh } = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE], req);
    setRefreshCookie(res, refresh);
    res.json({ accessToken, user: await serializeMe(await loadUser(user.id)) });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await revokeRefreshFamily(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  res.status(204).end();
});

