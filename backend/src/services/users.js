// User loading, profile serialisation and derived settings.
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { textDirFor } from '../data/languages.js';
import { badRequest } from '../lib/errors.js';
import { countrySummary, getCountry } from './countries.js';
import { settings } from './settings.js';


export async function loadUser(id, db = { query }) {
  const { rows } = await db.query(
    `SELECT u.*,
            ci.name AS city_name, ci.region AS city_region, ci.lat AS city_lat, ci.lng AS city_lng,
            EXISTS (SELECT 1 FROM identity_checks ic WHERE ic.user_id = u.id AND ic.status = 'approved') AS identity_verified
     FROM users u LEFT JOIN cities ci ON ci.id = u.city_id
     WHERE u.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Settings derived from country + language (stored on the profile). */
export function deriveSettings(country, language, browserTimezone) {
  const timezone =
    browserTimezone && country.timezones.includes(browserTimezone) ? browserTimezone : country.default_timezone;
  return {
    currency: country.currency,
    units: country.distance_unit,
    timezone,
    locale: `${language}-${country.code}`,
    text_dir: textDirFor(language),
  };
}

export function trustLevel(user) {
  if (user.returns_count >= 3) return 'trusted_returner';
  if (user.identity_verified) return 'identity_verified';
  if (user.email_verified) return 'email_verified';
  return 'new';
}

export function nextCountryChangeAt(user, cooldownDays = 30) {
  if (!user.country_changed_at) return null;
  return new Date(new Date(user.country_changed_at).getTime() + cooldownDays * 864e5);
}

/** The signed-in user's own profile (GET /api/me). */
export async function serializeMe(user) {
  const country = await getCountry(user.country_code);
  const s = await settings();
  const locationFresh = Boolean(
    user.location_verified_at && Date.now() - new Date(user.location_verified_at).getTime() < s.location_max_age_hours * 3600_000,
  );
  const steps = {
    country: Boolean(user.country_code),
    city: Boolean(user.city_id),
    profile: Boolean(user.display_name),
  };
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    signInMethods: { email: Boolean(user.email && user.email_verified), google: Boolean(user.google_sub) },
    countryCode: user.country_code?.trim() ?? null,
    country: country ? countrySummary(country) : null,
    city: user.city_id ? { id: Number(user.city_id), name: user.city_name, region: user.city_region, lat: user.city_lat, lng: user.city_lng } : null,
    home: user.home_lat != null ? { lat: user.home_lat, lng: user.home_lng, radiusKm: Number(user.home_radius_km) } : null,
    language: user.language,
    timezone: user.timezone,
    currency: user.currency?.trim() ?? null,
    units: user.units,
    locale: user.locale,
    textDir: user.text_dir,
    role: user.role,
    trust: {
      level: trustLevel(user),
      score: user.trust_score,
      emailVerified: Boolean(user.email_verified),
      identityVerified: Boolean(user.identity_verified),
    },
    returnsCount: user.returns_count,
    points: user.points,
    notificationPrefs: user.notification_prefs,
    onboarding: { completed: Boolean(user.onboarding_completed_at), steps },
    travel:
      user.travel_country_code && user.travel_until && new Date(user.travel_until) > new Date()
        ? { countryCode: user.travel_country_code.trim(), until: user.travel_until }
        : null,
    countryChangedAt: user.country_changed_at,
    nextCountryChangeAt: nextCountryChangeAt(user, s.country_change_cooldown_days),
    location: {
      countryCode: user.location_country?.trim() ?? null,
      verifiedAt: user.location_verified_at ?? null,
      fresh: locationFresh,
      required: s.require_live_location,
    },
    hasPassword: Boolean(user.password_hash),
    createdAt: user.created_at,
  };
}

// ---------------------------------------------------------------------------
// Signed city references. City search results from Nominatim are returned to
// the client with a signed `ref`; when the user picks one we verify the
// signature, so the server never trusts client-supplied names/coordinates.
// ---------------------------------------------------------------------------
const refKey = () => crypto.createHmac('sha256', env.HASH_PEPPER).update('city-ref').digest();

export function signCityRef(place) {
  const payload = Buffer.from(JSON.stringify(place)).toString('base64url');
  const sig = crypto.createHmac('sha256', refKey()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyCityRef(ref) {
  const [payload, sig] = String(ref).split('.');
  const expected = crypto.createHmac('sha256', refKey()).update(payload ?? '').digest('base64url');
  if (!payload || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw badRequest('CITY_INVALID', 'Please pick a city from the list.');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
