// Access + refresh tokens.
//
// * Access token: short-lived JWT (15 min), sent as `Authorization: Bearer`.
//   Kept in memory by the web app, never in localStorage.
// * Refresh token: opaque random string in an httpOnly cookie scoped to
//   /api/auth. Stored hashed. Every refresh ROTATES it; presenting an already
//   rotated token means it was stolen → the whole family is revoked.
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env, isProd } from '../config/env.js';
import { query, tx } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const ISSUER = 'foundback';
const AUDIENCE = 'foundback-web';
export const REFRESH_COOKIE = 'fb_rt';
const GRACE_MS = 10_000;

export function signAccessToken(user) {
  return jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Your session has expired.');
  }
}

async function insertRefreshToken(db, { userId, familyId, req }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 864e5);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, familyId, sha256(token), expiresAt, req?.get?.('user-agent')?.slice(0, 300) ?? null, req?.ip ?? null],
  );
  return { token, expiresAt };
}

/** New session (sign-in): a new token family. */
export async function issueSession(user, req) {
  const refresh = await insertRefreshToken({ query }, { userId: user.id, familyId: crypto.randomUUID(), req });
  return { accessToken: signAccessToken(user), refresh };
}

/** Rotate a refresh token. Returns the user id and a new session. */
export async function rotateRefreshToken(rawToken, req) {
  if (!rawToken) throw unauthorized();
  const hash = sha256(rawToken);
  const result = await tx(async (db) => {
    const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [hash]);
    const row = rows[0];
    if (!row) throw unauthorized();
    // Two tabs refreshing at the same moment both present the same token; a
    // short grace window avoids logging the user out for that.
    const inGrace = row.rotated_at && !row.revoked_at && Date.now() - row.rotated_at.getTime() < GRACE_MS;
    if ((row.rotated_at && !inGrace) || row.revoked_at) {
      // Re-use of an old token: assume theft and kill the family.
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      await audit({ actorId: row.user_id, action: 'auth.refresh_reuse_detected', meta: { familyId: row.family_id }, ip: req?.ip }, db);
      // Return (not throw) so the revocation is committed.
      return { reuse: true };
    }
    if (row.expires_at < new Date()) throw unauthorized('Your session has expired.');
    const { rows: users } = await db.query("SELECT * FROM users WHERE id = $1 AND status = 'active'", [row.user_id]);
    if (!users[0]) throw unauthorized();
    if (!row.rotated_at) await db.query('UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1', [row.id]);
    const refresh = await insertRefreshToken(db, { userId: row.user_id, familyId: row.family_id, req });
    return { user: users[0], accessToken: signAccessToken(users[0]), refresh };
  });
  if (result.reuse) throw unauthorized('Your session was ended for security reasons. Please sign in again.');
  return result;
}

export async function revokeRefreshFamily(rawToken) {
  if (!rawToken) return;
  await query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
    [sha256(rawToken)],
  );
}

export const revokeAllForUser = (userId, db = { query }) =>
  db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);

export function setRefreshCookie(res, refresh) {
  res.cookie(REFRESH_COOKIE, refresh.token, {
    httpOnly: true,
    secure: isProd || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
    expires: refresh.expiresAt,
  });
}

export const clearRefreshCookie = (res) =>
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth', httpOnly: true, sameSite: env.COOKIE_SAMESITE, secure: isProd || env.COOKIE_SAMESITE === 'none' });
