// /api/found-items — posting (finder), browsing and item pages (everyone in the country).
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { CATEGORIES, IDENTIFIER_CATEGORIES, PRIVATE_PHOTO_CATEGORIES } from '../lib/categories.js';
import { blindIndex, decrypt, encrypt } from '../lib/crypto.js';
import { badRequest, forbidden, tooMany } from '../lib/errors.js';
import { approximate } from '../lib/geo.js';
import { findSensitive } from '../lib/textGuard.js';
import { filesOf, multipartData, upload } from '../lib/upload.js';
import { latitude, longitude, validate } from '../lib/validate.js';
import { requireAuth, requireOnboarded } from '../middleware/auth.js';
import { getCountry } from '../services/countries.js';
import { isPointInCountry } from '../services/geocode.js';
import { storeImage } from '../services/images.js';
import { distanceSql, loadVisibleItem, serializeItems, viewableCountries } from '../services/items.js';
import { matchFoundItem } from '../services/matching.js';
import { deleteObject } from '../services/storage.js';
import { assertLiveLocation } from '../services/location.js';
import { settings } from '../services/settings.js';

export const foundItemsRouter = Router();
foundItemsRouter.use(requireAuth, requireOnboarded);


const createSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(3).max(140),
  descriptionLang: z.string().max(8).default('en'),
  questions: z
    .array(z.object({ question: z.string().trim().min(3).max(160), answer: z.string().trim().min(1).max(200) }))
    .min(2)
    .max(4),
  privateIdentifier: z.string().trim().min(3).max(64).optional(),
  location: z.object({ lat: latitude, lng: longitude, label: z.string().trim().max(80).optional() }),
  foundAt: z.coerce.date(),
  currentLocation: z.enum(['with_me', 'police', 'shop_office']),
  currentLocationNote: z.string().trim().max(120).optional(),
  noReward: z.boolean().default(false),
  guidanceAccepted: z.literal(true),
});

/** Reject public text that contains phone numbers, emails, links or ID numbers. */
function assertCleanPublicText(text, country, field) {
  const found = findSensitive(text, country);
  if (found.length) throw badRequest('CONTACT_DETAILS_BLOCKED', 'Public text cannot contain phone numbers, emails, links or ID numbers.', { field, found });
}

// ---------------------------------------------------------------------------
// Post a found item (multipart: data=<json>, photos=<1..5 images>)
// ---------------------------------------------------------------------------
foundItemsRouter.post('/', upload.any(), async (req, res) => {
  const b = multipartData(req, createSchema);
  const user = req.user;
  await assertLiveLocation(user, req.countryCode);
  const country = await getCountry(req.countryCode);
  const photos = filesOf(req, 'photos');
  if (photos.length < 1 || photos.length > 5) throw badRequest('PHOTOS_REQUIRED', 'Add between 1 and 5 photos.');
  if (b.foundAt > new Date(Date.now() + 5 * 60_000)) throw badRequest('DATE_IN_FUTURE', 'The date cannot be in the future.');
  if (IDENTIFIER_CATEGORIES.has(b.category) && ['national_id', 'vehicle_documents'].includes(b.category) && !b.privateIdentifier) {
    throw badRequest('IDENTIFIER_REQUIRED', `Enter the ${country.national_id_name} number privately so we can verify the owner.`);
  }
  assertCleanPublicText(b.description, country, 'description');
  if (b.location.label) assertCleanPublicText(b.location.label, country, 'location.label');
  for (const [i, q] of b.questions.entries()) assertCleanPublicText(q.question, country, `questions.${i}.question`);

  const { rows: counts } = await query(
    "SELECT count(*)::int AS n FROM found_items WHERE finder_id = $1 AND created_at > now() - interval '1 day'",
    [user.id],
  );
  if (counts[0].n >= (await settings()).max_posts_per_day) throw tooMany('You have reached the daily posting limit.');
  if (!(await isPointInCountry(b.location.lat, b.location.lng, country))) {
    throw badRequest('LOCATION_OUTSIDE_COUNTRY', `The pin must be inside ${country.name}.`);
  }

  // Images first (outside the transaction: they can take a few seconds).
  const isPublic = !PRIVATE_PHOTO_CATEGORIES.has(b.category);
  const stored = [];
  for (const f of photos) stored.push(await storeImage(f.buffer, req.countryCode, { moderateImage: isPublic }));

  const approx = approximate(b.location.lat, b.location.lng, 500);
  const item = await tx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO found_items (country_code, finder_id, city_id, category, description, description_lang, lat, lng,
         approx_lat, approx_lng, area_label, found_at, current_location, current_location_note, no_reward,
         private_id_enc, private_id_hash, search_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [req.countryCode, user.id, user.city_id, b.category, b.description, b.descriptionLang, b.location.lat, b.location.lng,
        approx.lat, approx.lng, b.location.label ?? null, b.foundAt, b.currentLocation, b.currentLocationNote ?? null, b.noReward,
        b.privateIdentifier ? encrypt(b.privateIdentifier) : null, b.privateIdentifier ? blindIndex(b.privateIdentifier, 'identifier') : null,
        b.description.toLowerCase()],
    );
    const it = rows[0];
    for (const [i, q] of b.questions.entries()) {
      await db.query('INSERT INTO hidden_questions (found_item_id, country_code, question, answer_enc, position) VALUES ($1,$2,$3,$4,$5)', [
        it.id, req.countryCode, q.question, encrypt(q.answer), i,
      ]);
    }
    for (const [i, s] of stored.entries()) {
      await db.query(
        `INSERT INTO item_photos (country_code, found_item_id, r2_key, thumb_key, is_public, position, width, height, moderation_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.countryCode, it.id, s.key, s.thumbKey, isPublic, i, s.width, s.height, s.moderation],
      );
    }
    await audit({ actorId: user.id, countryCode: req.countryCode, action: 'found_item.create', targetType: 'found_item', targetId: it.id, ip: req.ip }, db);
    return it;
  });

  const matches = await matchFoundItem(item).catch(() => 0);
  const [out] = await serializeItems([item], user, { full: true });
  res.status(201).json({ item: out, matches });
});

// ---------------------------------------------------------------------------
// Browse: list + map, filters, sort by newest/nearest. Always the user's country.
// ---------------------------------------------------------------------------
foundItemsRouter.get(
  '/',
  validate({
    query: z.object({
      category: z.enum(CATEGORIES).optional(),
      q: z.string().trim().max(60).optional(),
      lat: latitude.optional(),
      lng: longitude.optional(),
      radiusKm: z.coerce.number().min(0.5).max(500).optional(),
      cityId: z.coerce.number().int().positive().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z.enum(['open', 'returned', 'all']).default('open'),
      sort: z.enum(['newest', 'nearest']).default('newest'),
      page: z.coerce.number().int().min(1).max(200).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  async (req, res) => {
    const f = req.validQuery;
    const params = [req.countryCode];
    const where = ['f.country_code = $1', "f.status <> 'removed'"];
    const add = (sql, v) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (f.status === 'open') where.push("f.status IN ('waiting','under_review','approved')");
    if (f.status === 'returned') where.push("f.status = 'returned'");
    if (f.category) add('f.category = ?', f.category);
    if (f.q) add("f.search_text LIKE '%' || ? || '%'", f.q.toLowerCase().replace(/[\\%_]/g, '\\$&'));
    if (f.cityId) add('f.city_id = ?', f.cityId);
    if (f.from) add('f.found_at >= ?', f.from);
    if (f.to) add('f.found_at <= ?', f.to);

    const origin = f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null;
    let distance = 'NULL';
    if (origin) {
      params.push(origin.lat, origin.lng);
      distance = distanceSql(`$${params.length - 1}`, `$${params.length}`);
      if (f.radiusKm) {
        params.push(f.radiusKm * 1000);
        where.push(`${distance} <= $${params.length}`);
      }
    }
    const order = f.sort === 'nearest' && origin ? 'distance_m ASC NULLS LAST' : 'f.created_at DESC';
    params.push(f.limit + 1, (f.page - 1) * f.limit);
    const { rows } = await query(
      `SELECT f.*, c.name AS city_name, ${distance} AS distance_m
       FROM found_items f LEFT JOIN cities c ON c.id = f.city_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const hasMore = rows.length > f.limit;
    res.json({ items: await serializeItems(rows.slice(0, f.limit), req.user), page: f.page, hasMore });
  },
);

// My found posts, with claim counts.
foundItemsRouter.get('/mine', async (req, res) => {
  const { rows } = await query(
    `SELECT f.*, c.name AS city_name,
       (SELECT count(*)::int FROM claims WHERE found_item_id = f.id) AS claim_count,
       (SELECT count(*)::int FROM claims WHERE found_item_id = f.id AND status IN ('pending','follow_up')) AS pending_claim_count,
       (SELECT count(*)::int FROM matches m JOIN lost_reports l ON l.id = m.lost_report_id
          WHERE m.found_item_id = f.id AND l.status = 'open' AND NOT m.dismissed_by_finder) AS match_count,
       (SELECT cl.id FROM claims cl WHERE cl.found_item_id = f.id AND cl.status = 'approved' LIMIT 1) AS approved_claim_id
     FROM found_items f LEFT JOIN cities c ON c.id = f.city_id
     WHERE f.finder_id = $1 AND f.status <> 'removed' ORDER BY f.created_at DESC LIMIT 100`,
    [req.user.id],
  );
  const items = await serializeItems(rows, req.user);
  res.json({ items: items.map((it, i) => ({ ...it, matchCount: rows[i].match_count, approvedClaimId: rows[i].approved_claim_id })) });
});

// ---------------------------------------------------------------------------
// Item page
// ---------------------------------------------------------------------------
foundItemsRouter.get('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const item = await loadVisibleItem(req.validParams.id, req.user);
  const { rows } = await query(
    `SELECT f.*, c.name AS city_name,
       (SELECT count(*)::int FROM claims WHERE found_item_id = f.id) AS claim_count,
       (SELECT count(*)::int FROM claims WHERE found_item_id = f.id AND status IN ('pending','follow_up')) AS pending_claim_count
     FROM found_items f LEFT JOIN cities c ON c.id = f.city_id WHERE f.id = $1`,
    [item.id],
  );
  const [out] = await serializeItems(rows, req.user, { full: true });
  const myClaim = await query(
    'SELECT id, status FROM claims WHERE found_item_id = $1 AND claimant_id = $2 ORDER BY created_at DESC LIMIT 1',
    [item.id, req.user.id],
  );
  const finder = await query('SELECT display_name, returns_count, phone_verified_at, trust_score FROM users WHERE id = $1', [item.finder_id]);
  res.json({
    item: {
      ...out,
      myClaim: myClaim.rows[0] ?? null,
      canClaim: canClaim(item, req.user) && !myClaim.rows.some((c) => ['pending', 'follow_up', 'approved', 'rejected'].includes(c.status)),
      finder: { displayName: finder.rows[0]?.display_name ?? null, returnsCount: finder.rows[0]?.returns_count ?? 0 },
    },
  });
});

export function canClaim(item, user) {
  return (
    item.finder_id !== user.id &&
    ['waiting', 'under_review'].includes(item.status) &&
    viewableCountries(user).includes(item.country_code.trim())
  );
}

// Finder: update where the item is now, or close/remove the post.
foundItemsRouter.patch(
  '/:id',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      currentLocation: z.enum(['with_me', 'police', 'shop_office']).optional(),
      currentLocationNote: z.string().trim().max(120).nullable().optional(),
      status: z.enum(['closed']).optional(),
    }),
  }),
  async (req, res) => {
    const item = await loadVisibleItem(req.validParams.id, req.user);
    if (item.finder_id !== req.user.id) throw forbidden();
    const country = await getCountry(item.country_code);
    if (req.body.currentLocationNote) assertCleanPublicText(req.body.currentLocationNote, country, 'currentLocationNote');
    if (req.body.status === 'closed' && ['approved', 'returned'].includes(item.status)) throw badRequest('ITEM_LOCKED', 'This item is already being returned.');
    const { rows } = await query(
      `UPDATE found_items SET current_location = COALESCE($2, current_location),
         current_location_note = CASE WHEN $3::boolean THEN $4 ELSE current_location_note END,
         status = COALESCE($5, status), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [item.id, req.body.currentLocation ?? null, req.body.currentLocationNote !== undefined, req.body.currentLocationNote ?? null, req.body.status ?? null],
    );
    if (req.body.status === 'closed') {
      await query("UPDATE claims SET status = 'rejected', reject_reason = 'post_closed', decided_at = now() WHERE found_item_id = $1 AND status IN ('pending','follow_up')", [item.id]);
    }
    const [out] = await serializeItems(rows, req.user, { full: true });
    res.json({ item: out });
  },
);

foundItemsRouter.delete('/:id', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const item = await loadVisibleItem(req.validParams.id, req.user);
  if (item.finder_id !== req.user.id) throw forbidden();
  if (['approved', 'returned'].includes(item.status)) throw badRequest('ITEM_LOCKED', 'This item is already being returned.');
  const photos = await query('SELECT r2_key, thumb_key FROM item_photos WHERE found_item_id = $1', [item.id]);
  await tx(async (db) => {
    await db.query("UPDATE found_items SET status = 'removed', updated_at = now() WHERE id = $1", [item.id]);
    await db.query("UPDATE claims SET status = 'rejected', reject_reason = 'post_removed', decided_at = now() WHERE found_item_id = $1 AND status IN ('pending','follow_up')", [item.id]);
    await db.query('DELETE FROM item_photos WHERE found_item_id = $1', [item.id]);
    await audit({ actorId: req.user.id, countryCode: req.countryCode, action: 'found_item.remove', targetType: 'found_item', targetId: item.id, ip: req.ip }, db);
  });
  for (const p of photos.rows) {
    await deleteObject(p.r2_key).catch(() => {});
    await deleteObject(p.thumb_key).catch(() => {});
  }
  res.status(204).end();
});

// Questions a claimant must answer (never the answers).
foundItemsRouter.get('/:id/questions', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const item = await loadVisibleItem(req.validParams.id, req.user);
  if (!canClaim(item, req.user)) throw forbidden('CANNOT_CLAIM', 'You cannot claim this item.');
  const { rows } = await query('SELECT id, question FROM hidden_questions WHERE found_item_id = $1 ORDER BY position', [item.id]);
  res.json({ questions: rows, category: item.category });
});

// Finder: see their own hidden answers and private identifier (for reference).
foundItemsRouter.get('/:id/private', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const item = await loadVisibleItem(req.validParams.id, req.user);
  if (item.finder_id !== req.user.id) throw forbidden();
  const { rows } = await query('SELECT id, question, answer_enc FROM hidden_questions WHERE found_item_id = $1 ORDER BY position', [item.id]);
  res.json({
    questions: rows.map((q) => ({ id: q.id, question: q.question, answer: decrypt(q.answer_enc) })),
    hasPrivateIdentifier: Boolean(item.private_id_hash),
  });
});
