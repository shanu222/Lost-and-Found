// /api/me — the signed-in user's profile, onboarding steps and settings.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { isSupportedLanguage, textDirFor } from '../data/languages.js';
import { audit } from '../lib/audit.js';
import { decrypt } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { countryCode, latitude, longitude, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { getCountry } from '../services/countries.js';
import { cityAt, isPointInCountry } from '../services/geocode.js';
import { clearRefreshCookie, revokeAllForUser } from '../services/tokens.js';
import { deriveSettings, loadUser, nextCountryChangeAt, serializeMe, verifyCityRef } from '../services/users.js';
import { assertLiveLocation, recordLocation } from '../services/location.js';
import { settings } from '../services/settings.js';

export const meRouter = Router();
meRouter.use(requireAuth);

const reply = async (req, res) => res.json({ user: await serializeMe(await loadUser(req.user.id)) });

async function requireEnabledCountry(code) {
  const country = await getCountry(code);
  if (!country) throw badRequest('COUNTRY_UNKNOWN', 'Unknown country.');
  if (!country.enabled) throw badRequest('COUNTRY_DISABLED', 'FoundBack is not available in this country yet.');
  return country;
}

meRouter.get('/', reply);

/**
 * Sets the user's city from their last live location (best effort): the city
 * is no longer asked for — it follows from where the user actually is.
 */
async function autoCity(userId, countryCode) {
  const { rows } = await query('SELECT location_lat, location_lng FROM users WHERE id = $1', [userId]);
  const u = rows[0];
  if (u?.location_lat == null) return;
  const place = await cityAt(Number(u.location_lat), Number(u.location_lng));
  if (!place || place.countryCode !== countryCode) return;
  const city = await query(
    `INSERT INTO cities (country_code, name, region, lat, lng, source, external_id)
     VALUES ($1,$2,$3,$4,$5,'osm',$6)
     ON CONFLICT (country_code, external_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [countryCode, place.name, place.region, place.lat, place.lng, place.externalId],
  );
  await query('UPDATE users SET city_id = $2 WHERE id = $1', [userId, city.rows[0].id]);
}

// ---------------------------------------------------------------------------
// Live location check (GPS). Decides the user's country; VPN-checked.
// ---------------------------------------------------------------------------
meRouter.post(
  '/location',
  validate({ body: z.object({ lat: latitude, lng: longitude, accuracy: z.coerce.number().min(0).max(1_000_000).optional() }) }),
  async (req, res) => {
    const countryCode = await recordLocation(req, req.body);
    const user = await loadUser(req.user.id);
    res.json({ countryCode, user: await serializeMe(user) });
  },
);

// ---------------------------------------------------------------------------
// Onboarding step 1 — country. Only while onboarding; afterwards changing
// country goes through POST /me/country (cooldown + confirmation).
// ---------------------------------------------------------------------------
meRouter.post(
  '/onboarding/country',
  validate({ body: z.object({ countryCode: countryCode.optional(), timezone: z.string().max(64).optional() }) }),
  async (req, res) => {
    if (req.user.onboarding_completed_at) {
      throw forbidden('ONBOARDING_DONE', 'Use Settings to change your country.');
    }
    // With live location on (default), the country is the one the GPS says the
    // user is in — it can't be picked by hand or faked with a VPN.
    let code = req.body.countryCode;
    if ((await settings()).require_live_location) {
      await assertLiveLocation(req.user, []);
      code = req.user.location_country.trim();
    }
    if (!code) throw badRequest('COUNTRY_REQUIRED', 'Choose your country first.');
    const country = await requireEnabledCountry(code);
    const s = deriveSettings(country, req.user.language, req.body.timezone);
    const changed = req.countryCode && req.countryCode !== country.code;
    await query(
      `UPDATE users SET country_code = $2, currency = $3, units = $4, timezone = $5, locale = $6,
              city_id = CASE WHEN $7 THEN NULL ELSE city_id END,
              home_lat = CASE WHEN $7 THEN NULL ELSE home_lat END,
              home_lng = CASE WHEN $7 THEN NULL ELSE home_lng END,
              updated_at = now()
       WHERE id = $1`,
      [req.user.id, country.code, s.currency, s.units, s.timezone, s.locale, Boolean(changed)],
    );
    await autoCity(req.user.id, country.code).catch(() => undefined);
    await reply(req, res);
  },
);

// ---------------------------------------------------------------------------
// Step 2 — city (from the user's country only) + optional home area.
// ---------------------------------------------------------------------------
meRouter.post(
  '/onboarding/city',
  validate({
    body: z
      .object({
        cityId: z.coerce.number().int().positive().optional(),
        cityRef: z.string().max(2000).optional(),
        home: z.object({ lat: latitude, lng: longitude, radiusKm: z.coerce.number().min(0.5).max(50).default(5) }).nullable().optional(),
      })
      .refine((b) => b.cityId || b.cityRef, 'cityId or cityRef is required'),
  }),
  async (req, res) => {
    if (!req.countryCode) throw badRequest('COUNTRY_REQUIRED', 'Choose your country first.');
    const country = await getCountry(req.countryCode);
    let cityId = req.body.cityId;

    if (req.body.cityRef) {
      const place = verifyCityRef(req.body.cityRef);
      if (place.countryCode !== req.countryCode) throw forbidden('COUNTRY_MISMATCH', 'That city is not in your country.');
      const { rows } = await query(
        `INSERT INTO cities (country_code, name, region, lat, lng, source, external_id)
         VALUES ($1,$2,$3,$4,$5,'osm',$6)
         ON CONFLICT (country_code, external_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [req.countryCode, place.name, place.region, place.lat, place.lng, place.externalId],
      );
      cityId = rows[0].id;
    } else {
      const { rows } = await query('SELECT country_code FROM cities WHERE id = $1', [cityId]);
      if (!rows[0]) throw notFound('City not found.');
      if (rows[0].country_code.trim() !== req.countryCode) throw forbidden('COUNTRY_MISMATCH', 'That city is not in your country.');
    }

    const home = req.body.home;
    if (home && !(await isPointInCountry(home.lat, home.lng, country))) {
      throw badRequest('LOCATION_OUTSIDE_COUNTRY', `Your home area must be inside ${country.name}.`);
    }
    await query(
      `UPDATE users SET city_id = $2, home_lat = $3, home_lng = $4, home_radius_km = COALESCE($5, home_radius_km), updated_at = now()
       WHERE id = $1`,
      [req.user.id, cityId, home?.lat ?? null, home?.lng ?? null, home?.radiusKm ?? null],
    );
    await reply(req, res);
  },
);

// ---------------------------------------------------------------------------
// Step 4 / Settings — language, display name, units, notifications.
// The language is NEVER changed automatically; only by this endpoint.
// ---------------------------------------------------------------------------
meRouter.patch(
  '/settings',
  validate({
    body: z.object({
      language: z.string().refine(isSupportedLanguage, 'Unsupported language').optional(),
      displayName: z.string().trim().min(2).max(40).optional(),
      units: z.enum(['km', 'mi']).optional(),
      timezone: z.string().max(64).optional(),
      notificationPrefs: z.object({ email: z.boolean(), push: z.boolean(), inapp: z.boolean() }).partial().optional(),
    }),
  }),
  async (req, res) => {
    const b = req.body;
    const u = req.user;
    if (b.displayName && /(\+?\d[\d\s-]{6,}|@|https?:)/i.test(b.displayName)) {
      throw badRequest('DISPLAY_NAME_INVALID', 'Your name cannot contain phone numbers, emails or links.');
    }
    if (b.timezone) {
      const country = await getCountry(u.country_code);
      if (!country?.timezones.includes(b.timezone)) throw badRequest('TIMEZONE_INVALID', 'That time zone is not in your country.');
    }
    const language = b.language ?? u.language;
    await query(
      `UPDATE users SET language = $2, text_dir = $3, locale = CASE WHEN country_code IS NULL THEN locale ELSE $2 || '-' || country_code END,
              display_name = COALESCE($4, display_name), units = COALESCE($5, units), timezone = COALESCE($6, timezone),
              notification_prefs = notification_prefs || COALESCE($7, '{}'::jsonb), updated_at = now()
       WHERE id = $1`,
      [u.id, language, textDirFor(language), b.displayName ?? null, b.units ?? null, b.timezone ?? null, b.notificationPrefs ?? null],
    );
    await reply(req, res);
  },
);

meRouter.post('/onboarding/complete', async (req, res) => {
  const me = await serializeMe(req.user);
  const missing = Object.entries(me.onboarding.steps).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) throw badRequest('ONBOARDING_INCOMPLETE', 'Some profile steps are missing.', { missing });
  if (!req.user.onboarding_completed_at) {
    await query('UPDATE users SET onboarding_completed_at = now() WHERE id = $1', [req.user.id]);
    await audit({ actorId: req.user.id, countryCode: req.countryCode, action: 'user.onboarded', ip: req.ip });
  }
  await reply(req, res);
});

// ---------------------------------------------------------------------------
// Change country (people who moved). Requires explicit confirmation and is
// limited to once every 30 days. City and home area are reset, and the user
// must confirm their live location in the new country again.
// ---------------------------------------------------------------------------
meRouter.post(
  '/country',
  validate({ body: z.object({ countryCode: countryCode.optional(), confirm: z.literal(true), timezone: z.string().max(64).optional() }) }),
  async (req, res) => {
    const u = req.user;
    const s = await settings();
    if (!u.onboarding_completed_at) throw badRequest('ONBOARDING_REQUIRED', 'Finish onboarding first.');
    let code = req.body.countryCode;
    if (s.require_live_location) {
      // You can only move your account to the country you are physically in.
      await assertLiveLocation(u, []);
      code = u.location_country.trim();
    }
    if (!code) throw badRequest('COUNTRY_REQUIRED', 'Choose your country first.');
    const country = await requireEnabledCountry(code);
    if (country.code === req.countryCode) throw badRequest('COUNTRY_SAME', 'That is already your country.');
    const next = nextCountryChangeAt(u, s.country_change_cooldown_days);
    if (next && next > new Date()) {
      throw forbidden('COUNTRY_COOLDOWN', 'You can change your country once every 30 days.', { nextChangeAt: next });
    }
    const derived = deriveSettings(country, u.language, req.body.timezone);
    await tx(async (db) => {
      await db.query(
        `UPDATE users SET country_code = $2, currency = $3, units = $4, timezone = $5, locale = $6,
                city_id = NULL, home_lat = NULL, home_lng = NULL,
                country_changed_at = now(), travel_country_code = NULL, travel_until = NULL, updated_at = now()
         WHERE id = $1`,
        [u.id, country.code, derived.currency, derived.units, derived.timezone, derived.locale],
      );
      await audit({ actorId: u.id, countryCode: country.code, action: 'user.country_change', meta: { from: req.countryCode, to: country.code }, ip: req.ip }, db);
    });
    // The city follows the live location in the new country.
    await autoCity(u.id, country.code).catch(() => undefined);
    await reply(req, res);
  },
);

// ---------------------------------------------------------------------------
// Data export & account deletion (GDPR).
// ---------------------------------------------------------------------------
meRouter.get('/export', async (req, res) => {
  const u = req.user;
  const id = u.id;
  const [found, lost, claims, ratings, notifications] = await Promise.all([
    query('SELECT id, category, description, area_label, found_at, status, created_at FROM found_items WHERE finder_id = $1', [id]),
    query('SELECT id, category, description, lost_from, lost_to, status, is_travel, created_at FROM lost_reports WHERE owner_id = $1', [id]),
    query('SELECT id, found_item_id, status, created_at FROM claims WHERE claimant_id = $1', [id]),
    query('SELECT stars, note, created_at FROM ratings WHERE rater_id = $1', [id]),
    query('SELECT type, data, created_at, read_at FROM notifications WHERE user_id = $1', [id]),
  ]);
  await audit({ actorId: id, countryCode: req.countryCode, action: 'user.data_export', ip: req.ip });
  res.setHeader('Content-Disposition', 'attachment; filename="foundback-my-data.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    profile: { ...(await serializeMe(u)), phone: u.phone_enc ? decrypt(u.phone_enc) : null },
    foundItems: found.rows,
    lostReports: lost.rows,
    claims: claims.rows,
    ratingsGiven: ratings.rows,
    notifications: notifications.rows,
  });
});

meRouter.delete('/', validate({ body: z.object({ confirm: z.literal('DELETE') }) }), async (req, res) => {
  const id = req.user.id;
  await tx(async (db) => {
    // Personal data is erased; the row stays (anonymised) so that items,
    // claims and the audit trail stay consistent for other users.
    await db.query(
      `UPDATE users SET status = 'deleted', deleted_at = now(), display_name = NULL, email = NULL, google_sub = NULL,
              phone_enc = NULL, phone_hash = NULL, phone_last4 = NULL, home_lat = NULL, home_lng = NULL, updated_at = now()
       WHERE id = $1`,
      [id],
    );
    await db.query(`UPDATE found_items SET status = 'removed' WHERE finder_id = $1 AND status IN ('waiting','under_review')`, [id]);
    await db.query(`UPDATE lost_reports SET status = 'closed' WHERE owner_id = $1 AND status = 'open'`, [id]);
    await db.query(`UPDATE claims SET status = 'withdrawn' WHERE claimant_id = $1 AND status IN ('pending','follow_up')`, [id]);
    await db.query('DELETE FROM saved_alerts WHERE user_id = $1', [id]);
    await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [id]);
    await revokeAllForUser(id, db);
    await audit({ actorId: id, countryCode: req.countryCode, action: 'user.deleted', ip: req.ip }, db);
  });
  clearRefreshCookie(res);
  res.status(204).end();
});
