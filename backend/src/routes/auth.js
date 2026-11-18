// /api/auth — email-code sign-in, Google sign-in, refresh rotation, logout.
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { isSupportedLanguage, textDirFor } from '../data/languages.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { authLimiter, otpLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import { sendEmailOtp, verifyEmailOtp } from '../services/otp.js';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  issueSession,
  revokeRefreshFamily,
  rotateRefreshToken,
  setRefreshCookie,
} from '../services/tokens.js';
import { loadUser, serializeMe } from '../services/users.js';
import { settings } from '../services/settings.js';

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

const emailField = z.string().trim().toLowerCase().email().max(200);

/** Staff accounts with a password must use /admin/login (password + 2-step code). */
function assertNotStaff(user) {
  if (user && ['admin', 'moderator'].includes(user.role) && user.password_hash) {
    throw forbidden('STAFF_LOGIN_REQUIRED', 'Staff accounts sign in at /admin/login.');
  }
}

// Step 1 of email sign-in: send a 6-digit code.
authRouter.post(
  '/email/request',
  otpLimiter,
  validate({ body: z.object({ email: emailField, language }) }),
  async (req, res) => {
    if (!(await settings()).email_signin_enabled) throw badRequest('EMAIL_SIGNIN_DISABLED', 'Email sign-in is turned off. Please use Google.');
    const result = await sendEmailOtp({ email: req.body.email, language: req.body.language, ip: req.ip });
    res.json({ sent: true, email: req.body.email, ...result });
  },
);

// Step 2: verify the code → sign in (creating the account on first use).
authRouter.post(
  '/email/verify',
  authLimiter,
  validate({ body: z.object({ email: emailField, code: z.string().regex(/^\d{6}$/), language }) }),
  async (req, res) => {
    const { email } = req.body;
    await verifyEmailOtp({ email, code: req.body.code });

    const existing = await query('SELECT id, status, role, password_hash FROM users WHERE email = $1', [email]);
    const found = existing.rows[0];
    if (found?.status === 'deleted') throw forbidden('ACCOUNT_DELETED', 'This account was deleted.');
    assertNotStaff(found);
    let userId = found?.id;
    let created = false;
    if (!userId) {
      if (!(await settings()).registration_open) throw forbidden('REGISTRATION_CLOSED', 'New sign-ups are paused. Please try again later.');
      const { rows } = await query(
        `INSERT INTO users (email, email_verified, email_verified_at, language, text_dir)
         VALUES ($1, true, now(), $2, $3) RETURNING id`,
        [email, req.body.language, textDirFor(req.body.language)],
      );
      userId = rows[0].id;
      created = true;
    } else {
      await query('UPDATE users SET email_verified = true, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [userId]);
    }
    await audit({ actorId: userId, action: created ? 'auth.signup_email' : 'auth.signin_email', ip: req.ip });
    await respondWithSession(req, res, userId, created ? 201 : 200);
  },
);

// Google Identity Services: the web app sends the ID token (credential).
authRouter.post(
  '/google',
  authLimiter,
  validate({ body: z.object({ idToken: z.string().min(20), language }) }),
  async (req, res) => {
    const s = await settings();
    if (!s.google_signin_enabled || !s.google_client_id) throw badRequest('GOOGLE_DISABLED', 'Google sign-in is not configured.');
    let payload;
    try {
      const ticket = await google.verifyIdToken({ idToken: req.body.idToken, audience: s.google_client_id });
      payload = ticket.getPayload();
    } catch {
      throw unauthorized('Google sign-in failed. Please try again.');
    }
    if (!payload?.sub) throw unauthorized('Google sign-in failed.');

    const email = payload.email_verified && payload.email ? String(payload.email).toLowerCase() : null;
    let found = (await query('SELECT id, status, role, password_hash FROM users WHERE google_sub = $1', [payload.sub])).rows[0];
    // Google has verified this mailbox, and our email accounts are verified by
    // a code sent to the same mailbox, so linking the two is safe.
    if (!found && email) {
      found = (await query('SELECT id, status, role, password_hash FROM users WHERE email = $1', [email])).rows[0];
      if (found && found.status !== 'deleted' && !(found.role !== 'user' && found.password_hash)) {
        await query('UPDATE users SET google_sub = $2, email_verified = true, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [found.id, payload.sub]);
      }
    }
    if (found?.status === 'deleted') throw forbidden('ACCOUNT_DELETED', 'This account was deleted.');
    assertNotStaff(found);
    let userId = found?.id;
    let created = false;
    if (!userId) {
      if (!s.registration_open) throw forbidden('REGISTRATION_CLOSED', 'New sign-ups are paused. Please try again later.');
      const { rows } = await query(
        `INSERT INTO users (google_sub, email, email_verified, email_verified_at, display_name, language, text_dir)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [payload.sub, email, Boolean(email), email ? new Date() : null, payload.given_name || payload.name || null,
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
authRouter.post('/refresh', refreshLimiter, async (req, res) => {
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

