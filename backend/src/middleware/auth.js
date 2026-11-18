// Authentication & authorisation middleware.
// The user row is re-loaded on every request so bans, deletions and country
// changes take effect immediately — the JWT only proves identity.
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyAccessToken } from '../services/tokens.js';
import { loadUser } from '../services/users.js';

export async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    const payload = verifyAccessToken(token);
    const user = await loadUser(payload.sub);
    if (!user || user.status === 'deleted') throw unauthorized();
    if (user.status === 'banned') throw forbidden('ACCOUNT_BANNED', 'This account has been suspended.');
    req.user = user;
    // The ONLY source of truth for country scoping. Never read a country from
    // the request body/query for authorisation decisions.
    req.countryCode = user.country_code?.trim() ?? null;
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires a completed profile (country, city, verified phone). */
export function requireOnboarded(req, _res, next) {
  if (!req.user?.onboarding_completed_at || !req.countryCode) {
    return next(forbidden('ONBOARDING_REQUIRED', 'Please finish setting up your profile first.'));
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());
