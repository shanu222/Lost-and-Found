// /api/lost-reports — owners report what they lost; /api/alerts — saved alerts;
// /api/me/travel — travel mode (one other country for 30 days).
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { CATEGORIES } from '../lib/categories.js';
import { blindIndex, decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, forbidden, notFound, tooMany } from '../lib/errors.js';
import { findSensitive } from '../lib/textGuard.js';
import { filesOf, multipartData, upload } from '../lib/upload.js';
import { countryCode, latitude, longitude, validate } from '../lib/validate.js';
import { requireAuth, requireOnboarded } from '../middleware/auth.js';
import { getCountry } from '../services/countries.js';
import { isPointInCountry } from '../services/geocode.js';
import { storeImage } from '../services/images.js';
import { serializeItems } from '../services/items.js';
import { matchLostReport } from '../services/matching.js';
import { signedUrl } from '../services/storage.js';
import { assertLiveLocation } from '../services/location.js';
import { settings } from '../services/settings.js';

export const lostReportsRouter = Router();
export const alertsRouter = Router();
export const travelRouter = Router();
for (const r of [lostReportsRouter, alertsRouter, travelRouter]) r.use(requireAuth, requireOnboarded);


const activeTravel = (u) => (u.travel_country_code && u.travel_until && new Date(u.travel_until) > new Date() ? u.travel_country_code.trim() : null);

const createSchema = z
  .object({
    category: z.enum(CATEGORIES),
    description: z.string().trim().min(3).max(300),
    descriptionLang: z.string().max(8).default('en'),
    location: z.object({ lat: latitude, lng: longitude }),
    radiusM: z.coerce.number().int().min(200).max(50_000).default(2000),
    lostFrom: z.coerce.date(),
    lostTo: z.coerce.date(),
    privateDetails: z.string().trim().max(300).optional(),
    identifier: z.string().trim().min(3).max(64).optional(), // IMEI / serial / ID number (exact matching)
    reward: z.coerce.number().min(0).max(100_000_000).optional(),
    travel: z.boolean().default(false),
  })
  .refine((b) => b.lostTo >= b.lostFrom, { message: 'lostTo must be after lostFrom', path: ['lostTo'] });

async function serializeReport(r, { withMatches = false, viewer }) {
  const photos = await query('SELECT id, thumb_key FROM item_photos WHERE lost_report_id = $1 ORDER BY position', [r.id]);
  const out = {
    id: r.id,
    countryCode: r.country_code.trim(),
    category: r.category,
    description: r.description,
    descriptionLang: r.description_lang,
    location: { lat: r.lat, lng: r.lng, radiusM: r.radius_m },
    lostFrom: r.lost_from,
    lostTo: r.lost_to,
    reward: r.reward_amount != null ? { amount: r.reward_amount, currency: r.reward_currency?.trim() } : null,
    isTravel: r.is_travel,
    travelUntil: r.travel_until,
    status: r.status,
    hasPrivateDetails: Boolean(r.private_details_enc),
    photos: await Promise.all(photos.rows.map(async (p) => ({ id: p.id, thumbUrl: await signedUrl(p.thumb_key) }))),
    createdAt: r.created_at,
  };
  if (withMatches) {
    const m = await query(
      `SELECT m.score, m.breakdown, m.created_at AS matched_at, f.*, c.name AS city_name
       FROM matches m JOIN found_items f ON f.id = m.found_item_id LEFT JOIN cities c ON c.id = f.city_id
       WHERE m.lost_report_id = $1 AND NOT m.dismissed_by_owner AND f.status <> 'removed'
       ORDER BY m.score DESC, m.created_at DESC LIMIT 20`,
      [r.id],
    );
    const items = await serializeItems(m.rows, viewer);
    out.matches = items.map((it, i) => ({ score: m.rows[i].score, matchedAt: m.rows[i].matched_at, item: it }));
  }
  return out;
}

lostReportsRouter.post('/', upload.any(), async (req, res) => {
  const b = multipartData(req, createSchema);
  const u = req.user;
  let cc = req.countryCode;
  if (b.travel) {
    cc = activeTravel(u);
    if (!cc) throw badRequest('TRAVEL_INACTIVE', 'Turn on travel mode first.');
  }
  // Home reports need a live location at home. Travel reports were unlocked by a
  // live location inside the travel country when travel mode was turned on.
  await assertLiveLocation(u, b.travel ? [req.countryCode, cc] : [req.countryCode]);
  const country = await getCountry(cc);
  if (findSensitive(b.description, country).length) {
    throw badRequest('CONTACT_DETAILS_BLOCKED', 'Public text cannot contain phone numbers, emails, links or ID numbers.', { field: 'description' });
  }
  if (b.lostFrom > new Date(Date.now() + 5 * 60_000)) throw badRequest('DATE_IN_FUTURE', 'The date cannot be in the future.');
  const recent = await query("SELECT count(*)::int AS n FROM lost_reports WHERE owner_id = $1 AND created_at > now() - interval '1 day'", [u.id]);
  if (recent.rows[0].n >= (await settings()).max_lost_reports_per_day) throw tooMany('You have reached the daily limit for lost reports.');
  if (!(await isPointInCountry(b.location.lat, b.location.lng, country))) {
    throw badRequest('LOCATION_OUTSIDE_COUNTRY', `The area must be inside ${country.name}.`);
  }
  const photos = filesOf(req, 'photos').slice(0, 5);
  const stored = [];
  for (const f of photos) stored.push(await storeImage(f.buffer, cc, { moderateImage: false }));

  const report = await tx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO lost_reports (country_code, owner_id, city_id, category, description, description_lang, lat, lng, radius_m,
         lost_from, lost_to, private_details_enc, private_details_hash, reward_amount, reward_currency, is_travel, travel_until, search_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [cc, u.id, b.travel ? null : u.city_id, b.category, b.description, b.descriptionLang, b.location.lat, b.location.lng, b.radiusM,
        b.lostFrom, b.lostTo,
        b.privateDetails || b.identifier ? encrypt(JSON.stringify({ details: b.privateDetails ?? null, identifier: b.identifier ?? null })) : null,
        b.identifier ? blindIndex(b.identifier, 'identifier') : null,
        b.reward ?? null, b.reward != null ? country.currency : null, b.travel, b.travel ? u.travel_until : null, b.description.toLowerCase()],
    );
    for (const [i, s] of stored.entries()) {
      await db.query(
        `INSERT INTO item_photos (country_code, lost_report_id, r2_key, thumb_key, is_public, position, width, height, moderation_status)
         VALUES ($1,$2,$3,$4,false,$5,$6,$7,$8)`,
        [cc, rows[0].id, s.key, s.thumbKey, i, s.width, s.height, s.moderation],
      );
    }
    await audit({ actorId: u.id, countryCode: cc, action: 'lost_report.create', targetType: 'lost_report', targetId: rows[0].id, meta: { travel: b.travel }, ip: req.ip }, db);
    return rows[0];
  });
  const matches = await matchLostReport(report).catch(() => 0);
  res.status(201).json({ report: await serializeReport(report, { withMatches: true, viewer: u }), matches });
});

lostReportsRouter.get('/mine', async (req, res) => {
  const { rows } = await query("SELECT * FROM lost_reports WHERE owner_id = $1 ORDER BY (status = 'open') DESC, created_at DESC LIMIT 100", [req.user.id]);
  res.json({ reports: await Promise.all(rows.map((r) => serializeReport(r, { withMatches: true, viewer: req.user }))) });
});

async function ownReport(id, user) {
  const { rows } = await query('SELECT * FROM lost_reports WHERE id = $1', [id]);
  if (!rows[0] || rows[0].owner_id !== user.id) throw notFound('Report not found.');
  return rows[0];
}

lostReportsRouter.get('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const r = await ownReport(req.validParams.id, req.user);
  const out = await serializeReport(r, { withMatches: true, viewer: req.user });
  out.privateDetails = r.private_details_enc ? JSON.parse(decrypt(r.private_details_enc)) : null;
  res.json({ report: out });
});

lostReportsRouter.patch(
  '/:id',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ status: z.enum(['found', 'closed']) }) }),
  async (req, res) => {
    const r = await ownReport(req.validParams.id, req.user);
    const { rows } = await query('UPDATE lost_reports SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [r.id, req.body.status]);
    res.json({ report: await serializeReport(rows[0], { viewer: req.user }) });
  },
);

lostReportsRouter.post(
  '/:id/matches/:itemId/dismiss',
  validate({ params: z.object({ id: z.string().uuid(), itemId: z.string().uuid() }) }),
  async (req, res) => {
    const r = await ownReport(req.validParams.id, req.user);
    await query('UPDATE matches SET dismissed_by_owner = true WHERE lost_report_id = $1 AND found_item_id = $2', [r.id, req.validParams.itemId]);
    res.status(204).end();
  },
);

// Finder side: lost reports that match one of my found items (no owner identity shown).
lostReportsRouter.get('/matching/:itemId', validate({ params: z.object({ itemId: z.string().uuid() }) }), async (req, res) => {
  const { rows: items } = await query('SELECT finder_id FROM found_items WHERE id = $1', [req.validParams.itemId]);
  if (!items[0] || items[0].finder_id !== req.user.id) throw notFound('Item not found.');
  const { rows } = await query(
    `SELECT m.score, l.category, l.description, l.lost_from, l.lost_to, l.is_travel, l.created_at
     FROM matches m JOIN lost_reports l ON l.id = m.lost_report_id
     WHERE m.found_item_id = $1 AND NOT m.dismissed_by_finder AND l.status = 'open' ORDER BY m.score DESC LIMIT 20`,
    [req.validParams.itemId],
  );
  res.json({
    matches: rows.map((r) => ({ score: r.score, category: r.category, description: r.description, lostFrom: r.lost_from, lostTo: r.lost_to, isTravel: r.is_travel, createdAt: r.created_at })),
  });
});

// ---------------------------------------------------------------------------
// Saved alerts
// ---------------------------------------------------------------------------
const alertOut = (a) => ({
  id: a.id,
  category: a.category,
  keywords: a.keywords,
  label: a.label,
  location: { lat: a.lat, lng: a.lng, radiusM: a.radius_m },
  activeUntil: a.active_until,
  createdAt: a.created_at,
});

alertsRouter.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM saved_alerts WHERE user_id = $1 AND country_code = $2 ORDER BY created_at DESC', [req.user.id, req.countryCode]);
  res.json({ alerts: rows.map(alertOut) });
});

alertsRouter.post(
  '/',
  validate({
    body: z.object({
      category: z.enum(CATEGORIES).nullable().optional(),
      keywords: z.string().trim().max(80).optional(),
      label: z.string().trim().max(80).optional(),
      location: z.object({ lat: latitude, lng: longitude }),
      radiusM: z.coerce.number().int().min(200).max(50_000).default(3000),
      days: z.coerce.number().int().min(1).max(90).default(30),
    }),
  }),
  async (req, res) => {
    const b = req.body;
    const country = await getCountry(req.countryCode);
    const count = await query('SELECT count(*)::int AS n FROM saved_alerts WHERE user_id = $1 AND active_until > now()', [req.user.id]);
    if (count.rows[0].n >= (await settings()).max_alerts) throw badRequest('ALERT_LIMIT', 'You can have up to 10 active alerts.');
    if (!(await isPointInCountry(b.location.lat, b.location.lng, country))) throw badRequest('LOCATION_OUTSIDE_COUNTRY', 'The area must be inside your country.');
    const { rows } = await query(
      `INSERT INTO saved_alerts (country_code, user_id, category, keywords, label, lat, lng, radius_m, active_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(days => $9)) RETURNING *`,
      [req.countryCode, req.user.id, b.category ?? null, b.keywords || null, b.label || null, b.location.lat, b.location.lng, b.radiusM, b.days],
    );
    res.status(201).json({ alert: alertOut(rows[0]) });
  },
);

alertsRouter.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  await query('DELETE FROM saved_alerts WHERE id = $1 AND user_id = $2', [req.validParams.id, req.user.id]);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Travel mode
// ---------------------------------------------------------------------------
travelRouter.post('/', validate({ body: z.object({ countryCode }) }), async (req, res) => {
  const s = await settings();
  if (!s.travel_mode_enabled) throw forbidden('FEATURE_DISABLED', 'Travel mode is turned off.');
  const cc = req.body.countryCode;
  if (cc === req.countryCode) throw badRequest('TRAVEL_SAME_COUNTRY', 'Travel mode is for another country.');
  const country = await getCountry(cc);
  if (!country?.enabled) throw badRequest('COUNTRY_DISABLED', 'FoundBack is not available in this country yet.');
  const current = activeTravel(req.user);
  if (current && current !== cc) throw forbidden('TRAVEL_ACTIVE', 'You can use travel mode for one country at a time.');
  // You must actually be in the country you're travelling to.
  await assertLiveLocation(req.user, cc);
  const { rows } = await query(
    `UPDATE users SET travel_country_code = $2, travel_until = COALESCE(CASE WHEN travel_country_code = $2 THEN travel_until END, now() + make_interval(days => $3))
     WHERE id = $1 RETURNING travel_country_code, travel_until`,
    [req.user.id, cc, s.travel_days],
  );
  await audit({ actorId: req.user.id, countryCode: req.countryCode, action: 'user.travel_on', meta: { country: cc }, ip: req.ip });
  res.json({ travel: { countryCode: rows[0].travel_country_code.trim(), until: rows[0].travel_until } });
});

travelRouter.delete('/', async (req, res) => {
  await query('UPDATE users SET travel_country_code = NULL, travel_until = NULL WHERE id = $1', [req.user.id]);
  await query("UPDATE lost_reports SET status = 'closed' WHERE owner_id = $1 AND is_travel AND status = 'open'", [req.user.id]);
  res.status(204).end();
});
