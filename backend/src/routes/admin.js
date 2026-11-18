// /api/admin — admin and country-moderator tools.
// * Admins see every country (optionally filtered with ?country=XX).
// * Moderators only ever see the countries assigned to them; any request for
//   another country is refused.
// * Country configuration and moderator assignment are admin-only.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { LANGUAGE_CODES } from '../data/languages.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { countryCode, validate } from '../lib/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { invalidateCountries } from '../services/countries.js';
import { notify } from '../services/notifications.js';
import { signedUrl } from '../services/storage.js';
import { revokeAllForUser } from '../services/tokens.js';
import { listItemClaims } from './claims.js';
import { adminView, updateSettings, settings as liveSettings } from '../services/settings.js';
import { sendEmail } from '../services/email.js';
import { complete } from '../services/ai.js';
import { hashPassword, strongPassword, verifyPassword } from '../lib/password.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'moderator'));

// Resolve which countries this staff member may act on.
adminRouter.use(async (req, _res, next) => {
  try {
    if (req.user.role === 'admin') {
      req.staffCountries = null; // all
    } else {
      const { rows } = await query('SELECT country_codes FROM moderators WHERE user_id = $1', [req.user.id]);
      req.staffCountries = (rows[0]?.country_codes ?? []).map((c) => c.trim());
      if (!req.staffCountries.length) throw forbidden('NO_COUNTRIES', 'No countries are assigned to you yet.');
    }
    next();
  } catch (err) {
    next(err);
  }
});

const adminOnly = requireRole('admin');

/** Countries to filter by for this request (array), honouring ?country=. */
function scope(req) {
  const wanted = req.query.country ? String(req.query.country).toUpperCase() : null;
  if (req.staffCountries === null) return wanted ? [wanted] : null;
  if (wanted) {
    if (!req.staffCountries.includes(wanted)) throw forbidden('COUNTRY_NOT_ASSIGNED', 'You do not moderate this country.');
    return [wanted];
  }
  return req.staffCountries;
}

function assertCountry(req, cc) {
  if (req.staffCountries !== null && !req.staffCountries.includes(String(cc).trim())) throw notFound();
}

/** SQL "country_code = ANY($n)" helper; returns [sql, params]. */
const countryFilter = (countries, col, params) => {
  if (!countries) return 'TRUE';
  params.push(countries);
  return `${col} = ANY($${params.length})`;
};

adminRouter.get('/me', (req, res) => res.json({ role: req.user.role, countries: req.staffCountries }));

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------
adminRouter.get('/dashboard', async (req, res) => {
  const countries = scope(req);
  const params = [];
  const where = countryFilter(countries, 'f.country_code', params);
  const { rows } = await query(
    `SELECT f.country_code,
            count(*)::int AS found,
            count(*) FILTER (WHERE f.status = 'returned')::int AS returned,
            count(*) FILTER (WHERE f.status IN ('waiting','under_review','approved'))::int AS open,
            avg(EXTRACT(EPOCH FROM (f.returned_at - f.created_at)) / 86400) FILTER (WHERE f.status = 'returned') AS avg_days
     FROM found_items f WHERE ${where} AND f.status <> 'removed' GROUP BY f.country_code ORDER BY found DESC`,
    params,
  );
  const p2 = [];
  const w2 = (col) => countryFilter(countries, col, p2);
  const counts = await query(
    `SELECT
       (SELECT count(*)::int FROM lost_reports WHERE status = 'open' AND ${w2('country_code')}) AS open_lost_reports,
       (SELECT count(*)::int FROM claims WHERE status IN ('pending','follow_up') AND ${countries ? `country_code = ANY($1)` : 'TRUE'}) AS open_claims,
       (SELECT count(*)::int FROM claims WHERE flagged AND NOT reviewed_by_admin AND ${countries ? `country_code = ANY($1)` : 'TRUE'}) AS flagged_claims,
       (SELECT count(*)::int FROM reports WHERE status = 'open' AND ${countries ? `country_code = ANY($1)` : 'TRUE'}) AS open_reports,
       (SELECT count(*)::int FROM identity_checks WHERE status = 'pending' AND ${countries ? `country_code = ANY($1)` : 'TRUE'}) AS pending_identity,
       (SELECT count(*)::int FROM item_photos WHERE moderation_status = 'pending' AND ${countries ? `country_code = ANY($1)` : 'TRUE'}) AS pending_photos,
       (SELECT count(*)::int FROM users WHERE status = 'active' AND ${countries ? `country_code = ANY($1)` : 'TRUE'}) AS users`,
    p2,
  );
  const perCountry = rows.map((r) => ({
    countryCode: r.country_code.trim(),
    found: r.found,
    returned: r.returned,
    open: r.open,
    returnRate: r.found ? Math.round((r.returned / r.found) * 1000) / 10 : 0,
    avgDaysToReturn: r.avg_days != null ? Math.round(Number(r.avg_days) * 10) / 10 : null,
  }));
  const total = perCountry.reduce((a, r) => ({ found: a.found + r.found, returned: a.returned + r.returned, open: a.open + r.open }), { found: 0, returned: 0, open: 0 });
  res.json({
    scope: countries,
    totals: { ...total, returnRate: total.found ? Math.round((total.returned / total.found) * 1000) / 10 : 0, ...counts.rows[0] },
    perCountry,
  });
});

// ---------------------------------------------------------------------------
// Moderation queue: user reports
// ---------------------------------------------------------------------------
adminRouter.get('/reports', validate({ query: z.object({ status: z.enum(['open', 'actioned', 'dismissed']).default('open'), country: z.string().optional() }) }), async (req, res) => {
  const params = [req.validQuery.status];
  const where = countryFilter(scope(req), 'r.country_code', params);
  const { rows } = await query(
    `SELECT r.*, u.display_name AS reporter_name FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.status = $1 AND ${where} ORDER BY r.created_at DESC LIMIT 200`,
    params,
  );
  const out = await Promise.all(
    rows.map(async (r) => {
      let target = null;
      if (r.target_type === 'found_item') target = (await query('SELECT id, category, description, status, finder_id AS user_id FROM found_items WHERE id = $1', [r.target_id])).rows[0];
      if (r.target_type === 'lost_report') target = (await query('SELECT id, category, description, status, owner_id AS user_id FROM lost_reports WHERE id = $1', [r.target_id])).rows[0];
      if (r.target_type === 'claim') target = (await query('SELECT id, status, found_item_id, claimant_id AS user_id FROM claims WHERE id = $1', [r.target_id])).rows[0];
      if (r.target_type === 'message') target = (await query('SELECT id, body, sender_id AS user_id FROM messages WHERE id = $1', [r.target_id])).rows[0];
      if (r.target_type === 'user') target = (await query('SELECT id, display_name, status, id AS user_id FROM users WHERE id = $1', [r.target_id])).rows[0];
      return {
        id: r.id,
        countryCode: r.country_code.trim(),
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        reporter: r.reporter_name,
        createdAt: r.created_at,
        target,
      };
    }),
  );
  res.json({ reports: out });
});

adminRouter.post(
  '/reports/:id',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ action: z.enum(['dismiss', 'remove_content', 'ban_user']), note: z.string().trim().max(300).optional() }),
  }),
  async (req, res) => {
    const { rows } = await query('SELECT * FROM reports WHERE id = $1', [req.validParams.id]);
    const r = rows[0];
    if (!r) throw notFound();
    assertCountry(req, r.country_code);
    await tx(async (db) => {
      if (req.body.action === 'remove_content') {
        if (r.target_type === 'found_item') await db.query("UPDATE found_items SET status = 'removed' WHERE id = $1", [r.target_id]);
        if (r.target_type === 'lost_report') await db.query("UPDATE lost_reports SET status = 'closed' WHERE id = $1", [r.target_id]);
        if (r.target_type === 'message') await db.query("UPDATE messages SET body = '[removed by moderator]' WHERE id = $1", [r.target_id]);
        if (r.target_type === 'claim') await db.query("UPDATE claims SET status = 'rejected', reject_reason = 'moderator' WHERE id = $1 AND status IN ('pending','follow_up')", [r.target_id]);
      }
      if (req.body.action === 'ban_user') {
        const owner = {
          found_item: 'SELECT finder_id AS uid FROM found_items WHERE id = $1',
          lost_report: 'SELECT owner_id AS uid FROM lost_reports WHERE id = $1',
          claim: 'SELECT claimant_id AS uid FROM claims WHERE id = $1',
          message: 'SELECT sender_id AS uid FROM messages WHERE id = $1',
          user: 'SELECT id AS uid FROM users WHERE id = $1',
        }[r.target_type];
        const uid = (await db.query(owner, [r.target_id])).rows[0]?.uid;
        if (uid) await banUser(db, uid, req.body.note ?? `report:${r.reason}`, req);
      }
      await db.query(
        'UPDATE reports SET status = $2, handled_by = $3, handled_at = now(), resolution_note = $4 WHERE id = $1',
        [r.id, req.body.action === 'dismiss' ? 'dismissed' : 'actioned', req.user.id, req.body.note ?? null],
      );
      await audit({ actorId: req.user.id, countryCode: r.country_code.trim(), action: `admin.report_${req.body.action}`, targetType: 'report', targetId: r.id, ip: req.ip }, db);
    });
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Photo moderation queue (images the moderation provider could not decide)
// ---------------------------------------------------------------------------
adminRouter.get('/photos', async (req, res) => {
  const params = [];
  const where = countryFilter(scope(req), 'country_code', params);
  const { rows } = await query(`SELECT * FROM item_photos WHERE moderation_status = 'pending' AND ${where} ORDER BY created_at LIMIT 100`, params);
  res.json({
    photos: await Promise.all(rows.map(async (p) => ({ id: p.id, countryCode: p.country_code.trim(), foundItemId: p.found_item_id, lostReportId: p.lost_report_id, url: await signedUrl(p.thumb_key), createdAt: p.created_at }))),
  });
});

adminRouter.post('/photos/:id', validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['approved', 'rejected']) }) }), async (req, res) => {
  const { rows } = await query('SELECT country_code FROM item_photos WHERE id = $1', [req.validParams.id]);
  if (!rows[0]) throw notFound();
  assertCountry(req, rows[0].country_code);
  await query('UPDATE item_photos SET moderation_status = $2 WHERE id = $1', [req.validParams.id, req.body.decision]);
  await audit({ actorId: req.user.id, countryCode: rows[0].country_code.trim(), action: `admin.photo_${req.body.decision}`, targetType: 'item_photo', targetId: req.validParams.id, ip: req.ip });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Identity verification queue
// ---------------------------------------------------------------------------
adminRouter.get('/identity', validate({ query: z.object({ status: z.enum(['pending', 'approved', 'rejected']).default('pending'), country: z.string().optional() }) }), async (req, res) => {
  const params = [req.validQuery.status];
  const where = countryFilter(scope(req), 'ic.country_code', params);
  const { rows } = await query(
    `SELECT ic.id, ic.country_code, ic.status, ic.selfie_key, ic.created_at, ic.review_note, u.id AS user_id, u.display_name, u.created_at AS member_since
     FROM identity_checks ic JOIN users u ON u.id = ic.user_id WHERE ic.status = $1 AND ${where} ORDER BY ic.created_at LIMIT 100`,
    params,
  );
  await audit({ actorId: req.user.id, action: 'admin.identity_queue_view', ip: req.ip });
  res.json({
    checks: await Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        countryCode: c.country_code.trim(),
        status: c.status,
        user: { id: c.user_id, displayName: c.display_name, memberSince: c.member_since },
        selfieUrl: await signedUrl(c.selfie_key), // the ID number itself is never shown
        note: c.review_note,
        submittedAt: c.created_at,
      })),
    ),
  });
});

adminRouter.post(
  '/identity/:id',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() }) }),
  async (req, res) => {
    const { rows } = await query('SELECT * FROM identity_checks WHERE id = $1', [req.validParams.id]);
    const c = rows[0];
    if (!c) throw notFound();
    assertCountry(req, c.country_code);
    if (c.status !== 'pending') throw badRequest('ALREADY_REVIEWED', 'Already reviewed.');
    await query('UPDATE identity_checks SET status = $2, review_note = $3, reviewer_id = $4, reviewed_at = now() WHERE id = $1', [c.id, req.body.decision, req.body.note ?? null, req.user.id]);
    if (req.body.decision === 'approved') await query('UPDATE users SET trust_score = trust_score + 10 WHERE id = $1', [c.user_id]);
    await audit({ actorId: req.user.id, countryCode: c.country_code.trim(), action: `admin.identity_${req.body.decision}`, targetType: 'user', targetId: c.user_id, ip: req.ip });
    await notify({ userId: c.user_id, countryCode: c.country_code.trim(), type: req.body.decision === 'approved' ? 'identity_approved' : 'identity_rejected', url: '/settings' });
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Disputes: flagged or reported claims
// ---------------------------------------------------------------------------
adminRouter.get('/claims', async (req, res) => {
  const params = [];
  const where = countryFilter(scope(req), 'c.country_code', params);
  const { rows } = await query(
    `SELECT c.id, c.country_code, c.status, c.flag_reasons, c.id_number_match, c.created_at, c.found_item_id, c.reviewed_by_admin,
            f.category, f.description, u.display_name AS claimant_name, u.id AS claimant_id,
            (SELECT count(*)::int FROM reports r WHERE r.target_id = c.id) AS report_count
     FROM claims c JOIN found_items f ON f.id = c.found_item_id JOIN users u ON u.id = c.claimant_id
     WHERE ${where} AND ((c.flagged AND NOT c.reviewed_by_admin) OR EXISTS (SELECT 1 FROM reports r WHERE r.target_id = c.id AND r.status = 'open'))
     ORDER BY c.created_at DESC LIMIT 200`,
    params,
  );
  res.json({
    claims: rows.map((c) => ({
      id: c.id,
      countryCode: c.country_code.trim(),
      status: c.status,
      flags: c.flag_reasons,
      identifierMatch: c.id_number_match,
      itemId: c.found_item_id,
      category: c.category,
      description: c.description,
      claimant: { id: c.claimant_id, displayName: c.claimant_name },
      reportCount: c.report_count,
      createdAt: c.created_at,
    })),
  });
});

adminRouter.get('/items/:id/claims', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const { rows } = await query('SELECT country_code FROM found_items WHERE id = $1', [req.validParams.id]);
  if (!rows[0]) throw notFound();
  assertCountry(req, rows[0].country_code);
  req.params.id = req.validParams.id;
  // Reuse the finder review (staff see flags too). Admin role bypasses country checks there;
  // moderators were checked above.
  const original = req.user.role;
  req.user = { ...req.user, role: 'admin' };
  try {
    await listItemClaims(req, res);
  } finally {
    req.user.role = original;
  }
});

adminRouter.post('/claims/:id/review', validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ action: z.enum(['clear', 'reject']), note: z.string().trim().max(300).optional() }) }), async (req, res) => {
  const { rows } = await query('SELECT * FROM claims WHERE id = $1', [req.validParams.id]);
  const c = rows[0];
  if (!c) throw notFound();
  assertCountry(req, c.country_code);
  await query(
    `UPDATE claims SET reviewed_by_admin = true, admin_note = $2,
       status = CASE WHEN $3 AND status IN ('pending','follow_up') THEN 'rejected' ELSE status END,
       reject_reason = CASE WHEN $3 AND status IN ('pending','follow_up') THEN 'moderator' ELSE reject_reason END
     WHERE id = $1`,
    [c.id, req.body.note ?? null, req.body.action === 'reject'],
  );
  await audit({ actorId: req.user.id, countryCode: c.country_code.trim(), action: `admin.claim_${req.body.action}`, targetType: 'claim', targetId: c.id, ip: req.ip });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Users, claim history, bans
// ---------------------------------------------------------------------------
/** a•••@example.com — enough to tell accounts apart without exposing the address. */
const maskEmail = (e) => (e ? String(e).replace(/^(.).*(@.*)$/, '$1•••$2') : null);

adminRouter.get('/users', validate({ query: z.object({ q: z.string().trim().max(60).optional(), status: z.enum(['active', 'banned', 'deleted']).optional(), country: z.string().optional() }) }), async (req, res) => {
  const params = [];
  const where = [countryFilter(scope(req), 'u.country_code', params)];
  if (req.validQuery.q) {
    params.push(`%${req.validQuery.q.toLowerCase()}%`);
    where.push(`(lower(u.display_name) LIKE $${params.length} OR lower(u.email::text) LIKE $${params.length} OR u.id::text = $${params.length + 1})`);
    params.push(req.validQuery.q);
  }
  if (req.validQuery.status) {
    params.push(req.validQuery.status);
    where.push(`u.status = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.country_code, u.role, u.status, u.trust_score, u.returns_count, u.created_at, u.email,
       u.location_country, u.ip_country, u.vpn_flagged_at,
       (SELECT count(*)::int FROM claims c WHERE c.claimant_id = u.id) AS claims,
       (SELECT count(*)::int FROM claims c WHERE c.claimant_id = u.id AND c.status = 'rejected') AS rejected_claims,
       (SELECT count(*)::int FROM reports r WHERE r.target_id = u.id OR r.target_id IN (SELECT id FROM found_items WHERE finder_id = u.id)) AS reports
     FROM users u WHERE ${where.join(' AND ')} ORDER BY u.created_at DESC LIMIT 200`,
    params,
  );
  res.json({
    users: rows.map((u) => ({
      id: u.id, displayName: u.display_name, countryCode: u.country_code?.trim() ?? null, role: u.role, status: u.status,
      trustScore: u.trust_score, returnsCount: u.returns_count, claims: u.claims, rejectedClaims: u.rejected_claims,
      reports: u.reports, email: maskEmail(u.email), createdAt: u.created_at,
      locationCountry: u.location_country?.trim() ?? null, ipCountry: u.ip_country?.trim() ?? null, vpnFlagged: Boolean(u.vpn_flagged_at),
    })),
  });
});

adminRouter.get('/users/:id', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const { rows } = await query('SELECT id, display_name, country_code, role, status, banned_reason, trust_score, returns_count, created_at FROM users WHERE id = $1', [req.validParams.id]);
  const u = rows[0];
  if (!u) throw notFound();
  assertCountry(req, u.country_code);
  const claims = await query(
    `SELECT c.id, c.status, c.flag_reasons, c.id_number_match, c.reject_reason, c.created_at, f.category, f.description, f.id AS item_id
     FROM claims c JOIN found_items f ON f.id = c.found_item_id WHERE c.claimant_id = $1 ORDER BY c.created_at DESC LIMIT 100`,
    [u.id],
  );
  const posts = await query('SELECT id, category, description, status, created_at FROM found_items WHERE finder_id = $1 ORDER BY created_at DESC LIMIT 50', [u.id]);
  await audit({ actorId: req.user.id, countryCode: u.country_code?.trim(), action: 'admin.user_view', targetType: 'user', targetId: u.id, ip: req.ip });
  res.json({
    user: { id: u.id, displayName: u.display_name, countryCode: u.country_code?.trim(), role: u.role, status: u.status, bannedReason: u.banned_reason, trustScore: u.trust_score, returnsCount: u.returns_count, createdAt: u.created_at },
    claims: claims.rows.map((c) => ({ id: c.id, status: c.status, flags: c.flag_reasons, identifierMatch: c.id_number_match, rejectReason: c.reject_reason, createdAt: c.created_at, category: c.category, description: c.description, itemId: c.item_id })),
    foundItems: posts.rows.map((p) => ({ id: p.id, category: p.category, description: p.description, status: p.status, createdAt: p.created_at })),
  });
});

async function banUser(db, userId, reason, req) {
  const target = (await db.query('SELECT role, country_code FROM users WHERE id = $1', [userId])).rows[0];
  if (!target) throw notFound();
  if (target.role === 'admin') throw forbidden('CANNOT_BAN_ADMIN', 'Admins cannot be banned.');
  assertCountry(req, target.country_code);
  await db.query("UPDATE users SET status = 'banned', banned_reason = $2 WHERE id = $1", [userId, reason]);
  await db.query("UPDATE claims SET status = 'withdrawn' WHERE claimant_id = $1 AND status IN ('pending','follow_up')", [userId]);
  await revokeAllForUser(userId, db);
  await audit({ actorId: req.user.id, countryCode: target.country_code?.trim(), action: 'admin.ban', targetType: 'user', targetId: userId, meta: { reason }, ip: req.ip }, db);
}

adminRouter.post('/users/:id/ban', validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ reason: z.string().trim().min(3).max(300) }) }), async (req, res) => {
  await tx((db) => banUser(db, req.validParams.id, req.body.reason, req));
  res.json({ ok: true });
});

adminRouter.post('/users/:id/unban', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const { rows } = await query('SELECT country_code FROM users WHERE id = $1', [req.validParams.id]);
  if (!rows[0]) throw notFound();
  assertCountry(req, rows[0].country_code);
  await query("UPDATE users SET status = 'active', banned_reason = NULL WHERE id = $1 AND status = 'banned'", [req.validParams.id]);
  await audit({ actorId: req.user.id, countryCode: rows[0].country_code?.trim(), action: 'admin.unban', targetType: 'user', targetId: req.validParams.id, ip: req.ip });
  res.json({ ok: true });
});

adminRouter.post('/stories/:id/hide', validate({ params: z.object({ id: z.string().uuid() }) }), async (req, res) => {
  const { rows } = await query('SELECT country_code FROM ratings WHERE id = $1', [req.validParams.id]);
  if (!rows[0]) throw notFound();
  assertCountry(req, rows[0].country_code);
  await query("UPDATE ratings SET story_status = 'hidden' WHERE id = $1", [req.validParams.id]);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Per-country configuration (admin only)
// ---------------------------------------------------------------------------
const countryOut = (c) => ({
  code: c.code.trim(), name: c.name, nativeName: c.native_name, flag: c.flag, enabled: c.enabled, dialCodes: c.dial_codes,
  currency: c.currency?.trim(), distanceUnit: c.distance_unit, timezones: c.timezones, defaultTimezone: c.default_timezone,
  emergencyNumber: c.emergency_number, authorityName: c.authority_name, nationalIdName: c.national_id_name,
  idMaskPattern: c.id_mask_pattern, guidance: c.guidance, safePlaceTypes: c.safe_place_types, bbox: c.bbox, languages: c.languages,
});

adminRouter.get('/countries', adminOnly, async (_req, res) => {
  const { rows } = await query(`
    SELECT c.*, COALESCE(array_agg(cl.language ORDER BY cl.position) FILTER (WHERE cl.language IS NOT NULL), '{}') AS languages
    FROM countries c LEFT JOIN country_languages cl ON cl.country_code = c.code GROUP BY c.code ORDER BY c.name`);
  res.json({ countries: rows.map(countryOut) });
});

const guidanceSchema = z.object({ ids: z.string().max(600), documents: z.string().max(600), cash: z.string().max(600), general: z.string().max(600) }).partial();

adminRouter.patch(
  '/countries/:code',
  adminOnly,
  validate({
    params: z.object({ code: countryCode }),
    body: z.object({
      name: z.string().trim().min(2).max(80).optional(),
      enabled: z.boolean().optional(),
      currency: z.string().length(3).toUpperCase().optional(),
      distanceUnit: z.enum(['km', 'mi']).optional(),
      defaultTimezone: z.string().max(64).optional(),
      emergencyNumber: z.string().trim().min(2).max(20).optional(),
      authorityName: z.string().trim().min(2).max(120).optional(),
      nationalIdName: z.string().trim().min(2).max(80).optional(),
      idMaskPattern: z.string().max(200).nullable().optional(),
      guidance: z.record(z.string(), guidanceSchema).optional(),
      safePlaceTypes: z.array(z.enum(['police', 'bank', 'mall', 'station'])).min(1).optional(),
      languages: z.array(z.string()).max(6).optional(),
    }),
  }),
  async (req, res) => {
    const b = req.body;
    const code = req.validParams.code;
    if (b.idMaskPattern) {
      try {
        new RegExp(b.idMaskPattern);
      } catch {
        throw badRequest('PATTERN_INVALID', 'The ID-number pattern is not a valid regular expression.');
      }
    }
    if (b.languages?.some((l) => !LANGUAGE_CODES.has(l) || l === 'en')) throw badRequest('LANGUAGE_INVALID', 'Unknown language.');
    if (b.guidance && Object.keys(b.guidance).some((l) => !LANGUAGE_CODES.has(l))) throw badRequest('LANGUAGE_INVALID', 'Unknown guidance language.');
    await tx(async (db) => {
      const existing = await db.query('SELECT timezones FROM countries WHERE code = $1 FOR UPDATE', [code]);
      if (!existing.rows[0]) throw notFound();
      if (b.defaultTimezone && !existing.rows[0].timezones.includes(b.defaultTimezone)) throw badRequest('TIMEZONE_INVALID', 'Unknown time zone for this country.');
      await db.query(
        `UPDATE countries SET name = COALESCE($2, name), enabled = COALESCE($3, enabled), currency = COALESCE($4, currency),
           distance_unit = COALESCE($5, distance_unit), default_timezone = COALESCE($6, default_timezone),
           emergency_number = COALESCE($7, emergency_number), authority_name = COALESCE($8, authority_name),
           national_id_name = COALESCE($9, national_id_name),
           id_mask_pattern = CASE WHEN $10::boolean THEN $11 ELSE id_mask_pattern END,
           guidance = COALESCE($12, guidance), safe_place_types = COALESCE($13, safe_place_types), updated_at = now()
         WHERE code = $1`,
        [code, b.name ?? null, b.enabled ?? null, b.currency ?? null, b.distanceUnit ?? null, b.defaultTimezone ?? null, b.emergencyNumber ?? null,
          b.authorityName ?? null, b.nationalIdName ?? null, b.idMaskPattern !== undefined, b.idMaskPattern ?? null, b.guidance ?? null, b.safePlaceTypes ?? null],
      );
      if (b.languages) {
        await db.query('DELETE FROM country_languages WHERE country_code = $1', [code]);
        for (const [i, l] of b.languages.entries()) await db.query('INSERT INTO country_languages (country_code, language, position) VALUES ($1,$2,$3)', [code, l, i]);
      }
      await audit({ actorId: req.user.id, countryCode: code, action: 'admin.country_update', targetType: 'country', targetId: code, meta: { fields: Object.keys(b) }, ip: req.ip }, db);
    });
    invalidateCountries();
    const { rows } = await query(
      `SELECT c.*, COALESCE(array_agg(cl.language ORDER BY cl.position) FILTER (WHERE cl.language IS NOT NULL), '{}') AS languages
       FROM countries c LEFT JOIN country_languages cl ON cl.country_code = c.code WHERE c.code = $1 GROUP BY c.code`,
      [code],
    );
    res.json({ country: countryOut(rows[0]) });
  },
);

// ---------------------------------------------------------------------------
// Moderators (admin only)
// ---------------------------------------------------------------------------
adminRouter.get('/moderators', adminOnly, async (_req, res) => {
  const { rows } = await query(
    `SELECT m.user_id, m.country_codes, m.created_at, u.display_name, u.email, u.country_code
     FROM moderators m JOIN users u ON u.id = m.user_id ORDER BY m.created_at`,
  );
  res.json({ moderators: rows.map((m) => ({ userId: m.user_id, displayName: m.display_name, email: maskEmail(m.email), homeCountry: m.country_code?.trim(), countries: m.country_codes.map((c) => c.trim()), since: m.created_at })) });
});

adminRouter.put(
  '/moderators/:userId',
  adminOnly,
  validate({ params: z.object({ userId: z.string().uuid() }), body: z.object({ countries: z.array(countryCode).min(1).max(50) }) }),
  async (req, res) => {
    const { rows } = await query("SELECT role, status FROM users WHERE id = $1", [req.validParams.userId]);
    if (!rows[0] || rows[0].status !== 'active') throw notFound('User not found.');
    if (rows[0].role === 'admin') throw badRequest('ALREADY_ADMIN', 'This user is an admin.');
    await tx(async (db) => {
      await db.query(
        `INSERT INTO moderators (user_id, country_codes, created_by) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET country_codes = EXCLUDED.country_codes`,
        [req.validParams.userId, req.body.countries, req.user.id],
      );
      await db.query("UPDATE users SET role = 'moderator' WHERE id = $1", [req.validParams.userId]);
      await audit({ actorId: req.user.id, action: 'admin.moderator_set', targetType: 'user', targetId: req.validParams.userId, meta: { countries: req.body.countries }, ip: req.ip }, db);
    });
    res.json({ ok: true });
  },
);

adminRouter.delete('/moderators/:userId', adminOnly, validate({ params: z.object({ userId: z.string().uuid() }) }), async (req, res) => {
  await tx(async (db) => {
    await db.query('DELETE FROM moderators WHERE user_id = $1', [req.validParams.userId]);
    await db.query("UPDATE users SET role = 'user' WHERE id = $1 AND role = 'moderator'", [req.validParams.userId]);
    await audit({ actorId: req.user.id, action: 'admin.moderator_remove', targetType: 'user', targetId: req.validParams.userId, ip: req.ip }, db);
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
adminRouter.get('/audit', validate({ query: z.object({ action: z.string().max(60).optional(), page: z.coerce.number().int().min(1).max(500).default(1), country: z.string().optional() }) }), async (req, res) => {
  const params = [];
  const where = [countryFilter(scope(req), 'a.country_code', params)];
  if (req.validQuery.action) {
    params.push(`${req.validQuery.action}%`);
    where.push(`a.action LIKE $${params.length}`);
  }
  params.push((req.validQuery.page - 1) * 100);
  const { rows } = await query(
    `SELECT a.id, a.country_code, a.action, a.target_type, a.target_id, a.meta, a.created_at, u.display_name AS actor
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where.join(' AND ')}
     ORDER BY a.id DESC LIMIT 100 OFFSET $${params.length}`,
    params,
  );
  res.json({ entries: rows.map((a) => ({ id: Number(a.id), countryCode: a.country_code?.trim() ?? null, action: a.action, targetType: a.target_type, targetId: a.target_id, meta: a.meta, actor: a.actor, at: a.created_at })) });
});

// ---------------------------------------------------------------------------
// Live settings (admin only). Changes apply to the web app and the installed
// app within seconds, without a redeploy. Secrets are write-only.
// ---------------------------------------------------------------------------
adminRouter.get('/settings', adminOnly, async (_req, res) => {
  res.json({ settings: await adminView() });
});

adminRouter.patch(
  '/settings',
  adminOnly,
  validate({ body: z.object({ changes: z.record(z.string().max(60), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])) }) }),
  async (req, res) => {
    const keys = Object.keys(req.body.changes);
    if (!keys.length) throw badRequest('VALIDATION_FAILED', 'Nothing to change.');
    await tx(async (db) => {
      await updateSettings(req.body.changes, req.user.id, db);
      // Never log secret values — only which keys changed.
      await audit({ actorId: req.user.id, action: 'admin.settings_update', meta: { keys }, ip: req.ip }, db);
    });
    res.json({ settings: await adminView() });
  },
);

adminRouter.post('/settings/test-email', adminOnly, async (req, res) => {
  const to = req.user.email;
  if (!to) throw badRequest('NO_EMAIL', 'Your admin account has no email address.');
  if (!(await liveSettings()).resend_api_key) throw badRequest('EMAIL_NOT_CONFIGURED', 'Add a Resend API key first.');
  try {
    await sendEmail({ to, subject: 'FoundBack test email', text: 'Email sending works.', html: '<p>Email sending works. ✅</p>' });
  } catch (err) {
    throw badRequest('EMAIL_FAILED', `Email failed: ${err.message}`);
  }
  res.json({ ok: true, to });
});

adminRouter.post('/settings/test-ai', adminOnly, async (_req, res) => {
  try {
    const r = await complete('Translate the user text into Urdu. Reply with the translation only.', 'Your wallet has been found.');
    res.json({ ok: true, provider: r.provider, sample: r.text.slice(0, 200) });
  } catch {
    throw badRequest('AI_FAILED', 'No AI provider answered. Check the keys and models.');
  }
});

// Staff account: change own password.
adminRouter.post(
  '/account/password',
  validate({ body: z.object({ current: z.string().max(200).optional(), next: z.string().max(200) }) }),
  async (req, res) => {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (rows[0]?.password_hash && !(await verifyPassword(req.body.current ?? '', rows[0].password_hash))) {
      throw badRequest('PASSWORD_WRONG', 'Your current password is not correct.');
    }
    if (!strongPassword(req.body.next)) throw badRequest('PASSWORD_WEAK', 'Use at least 10 characters with upper and lower case letters, a number and a symbol.');
    await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await hashPassword(req.body.next)]);
    // Sign out every other session of this account.
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
    await audit({ actorId: req.user.id, action: 'admin.password_change', ip: req.ip });
    res.json({ ok: true });
  },
);
