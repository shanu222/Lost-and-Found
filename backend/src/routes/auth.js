// /api/auth — Firebase sign-in (Google / email), refresh rotation, logout.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { isSupportedLanguage, textDirFor } from '../data/languages.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { authLimiter, refreshLimiter } from '../middleware/rateLimit.js';
import { verifyFirebaseToken } from '../services/firebase.js';
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

/** Staff accounts with a password must use /admin/login (password + 2-step code). */
function assertNotStaff(user) {
  if (user && ['admin', 'moderator'].includes(user.role) && user.password_hash) {
    throw forbidden('STAFF_LOGIN_REQUIRED', 'Staff accounts sign in at /admin/login.');
  }
}

// Firebase Authentication (Google or email + password). The web app signs in
// with Firebase, then sends the Firebase ID token here; we verify it and start
// our own session (short access token + rotating refresh cookie).
authRouter.post(
  '/firebase',
  authLimiter,
  validate({ body: z.object({ idToken: z.string().min(20).max(4096), language }) }),
  async (req, res) => {
    const s = await settings();
    if (!s.firebase_project_id) throw badRequest('SIGNIN_NOT_CONFIGURED', 'Sign-in is not set up yet.');
    const fb = await verifyFirebaseToken(req.body.idToken, s.firebase_project_id);

    const isGoogle = fb.provider === 'google.com';
    const isPassword = fb.provider === 'password';
    if (!isGoogle && !isPassword) throw badRequest('PROVIDER_NOT_ALLOWED', 'Please sign in with Google or email.');
    if (isGoogle && !s.google_signin_enabled) throw badRequest('GOOGLE_DISABLED', 'Google sign-in is turned off.');
    if (isPassword && !s.email_signin_enabled) throw badRequest('EMAIL_SIGNIN_DISABLED', 'Email sign-in is turned off. Please use Google.');
    if (!fb.email) throw badRequest('EMAIL_REQUIRED', 'Your account needs an email address.');
    if (!fb.emailVerified) throw forbidden('EMAIL_NOT_VERIFIED', 'Please verify your email address first.');

    const cols = 'id, status, role, password_hash, firebase_uid';
    let found = (await query(`SELECT ${cols} FROM users WHERE firebase_uid = $1`, [fb.uid])).rows[0];
    if (!found) {
      // Same verified mailbox = same person, so link an existing account.
      found = (await query(`SELECT ${cols} FROM users WHERE email = $1`, [fb.email])).rows[0];
      if (found && found.firebase_uid && found.firebase_uid !== fb.uid) {
        throw forbidden('ACCOUNT_CONFLICT', 'This email is linked to a different sign-in. Please contact support.');
      }
    }
    if (found?.status === 'deleted') throw forbidden('ACCOUNT_DELETED', 'This account was deleted.');
    assertNotStaff(found);

    let userId = found?.id;
    let created = false;
    if (!userId) {
      if (!s.registration_open) throw forbidden('REGISTRATION_CLOSED', 'New sign-ups are paused. Please try again later.');
      const { rows } = await query(
        `INSERT INTO users (firebase_uid, email, email_verified, email_verified_at, display_name, language, text_dir)
         VALUES ($1,$2,true,now(),$3,$4,$5) RETURNING id`,
        [fb.uid, fb.email, fb.name ? fb.name.slice(0, 40) : null, req.body.language, textDirFor(req.body.language)],
      );
      userId = rows[0].id;
      created = true;
    } else {
      await query(
        `UPDATE users SET firebase_uid = $2, email = $3, email_verified = true,
                email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`,
        [userId, fb.uid, fb.email],
      );
    }
    await audit({ actorId: userId, action: `auth.${created ? 'signup' : 'signin'}_${isGoogle ? 'google' : 'email'}`, ip: req.ip });
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

