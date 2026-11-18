// Smaller endpoints: notifications, web push, reports, identity verification,
// success stories, translation, safe places and locally stored files.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { isSupportedLanguage } from '../data/languages.js';
import { audit } from '../lib/audit.js';
import { blindIndex, encrypt } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { filesOf, multipartData, upload } from '../lib/upload.js';
import { latitude, longitude, validate } from '../lib/validate.js';
import { requireAuth, requireOnboarded } from '../middleware/auth.js';
import { getCountry } from '../services/countries.js';
import { storeImage } from '../services/images.js';
import { loadVisibleItem } from '../services/items.js';
import { vapidPublicKey } from '../services/notifications.js';
import { findSafePlaces } from '../services/safePlaces.js';
import { readLocal } from '../services/storage.js';
import { translate, translationEnabled } from '../services/translate.js';

export const miscRouter = Router();
const authed = [requireAuth, requireOnboarded];

// ---- Notifications --------------------------------------------------------
miscRouter.get('/notifications', ...authed, validate({ query: z.object({ unread: z.coerce.boolean().optional() }) }), async (req, res) => {
  const { rows } = await query(
    `SELECT id, type, data, read_at, created_at FROM notifications
     WHERE user_id = $1 AND ($2::boolean IS NOT TRUE OR read_at IS NULL) ORDER BY created_at DESC LIMIT 100`,
    [req.user.id, req.validQuery.unread ?? null],
  );
  const unread = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ notifications: rows.map((n) => ({ id: n.id, type: n.type, data: n.data, read: Boolean(n.read_at), createdAt: n.created_at })), unread: unread.rows[0].n });
});

miscRouter.post('/notifications/read', ...authed, validate({ body: z.object({ ids: z.array(z.string().uuid()).max(200).optional() }) }), async (req, res) => {
  if (req.body.ids?.length) await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL', [req.user.id, req.body.ids]);
  else await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.status(204).end();
});

miscRouter.get('/push/key', async (_req, res) => res.json({ publicKey: await vapidPublicKey() }));

miscRouter.post(
  '/push/subscribe',
  requireAuth,
  validate({ body: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }) }),
  async (req, res) => {
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys) VALUES ($1,$2,$3)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, keys = EXCLUDED.keys`,
      [req.user.id, req.body.endpoint, req.body.keys],
    );
    res.status(201).json({ ok: true });
  },
);

miscRouter.post('/push/unsubscribe', requireAuth, validate({ body: z.object({ endpoint: z.string().max(1000) }) }), async (req, res) => {
  await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [req.user.id, req.body.endpoint]);
  res.status(204).end();
});

// ---- Reports (scam, fake claim, abusive, wrong category) -------------------
miscRouter.post(
  '/reports',
  ...authed,
  validate({
    body: z.object({
      targetType: z.enum(['found_item', 'lost_report', 'claim', 'message', 'user']),
      targetId: z.string().uuid(),
      reason: z.enum(['scam', 'fake_claim', 'abusive', 'wrong_category', 'other']),
      details: z.string().trim().max(500).optional(),
    }),
  }),
  async (req, res) => {
    const b = req.body;
    // Resolve the target's country and make sure the reporter can see it.
    const lookups = {
      found_item: 'SELECT country_code FROM found_items WHERE id = $1',
      lost_report: 'SELECT country_code FROM lost_reports WHERE id = $1',
      claim: 'SELECT country_code FROM claims WHERE id = $1 AND (claimant_id = $2 OR found_item_id IN (SELECT id FROM found_items WHERE finder_id = $2))',
      message: 'SELECT m.country_code FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = $1 AND (c.finder_id = $2 OR c.claimant_id = $2)',
      user: 'SELECT country_code FROM users WHERE id = $1',
    };
    const needsUser = ['claim', 'message'].includes(b.targetType);
    const { rows } = await query(lookups[b.targetType], needsUser ? [b.targetId, req.user.id] : [b.targetId]);
    if (!rows[0] || rows[0].country_code?.trim() !== req.countryCode) {
      if (b.targetType === 'found_item') await loadVisibleItem(b.targetId, req.user); // allows travel country, else 404
      else throw notFound('Not found.');
    }
    const dup = await query("SELECT 1 FROM reports WHERE reporter_id = $1 AND target_id = $2 AND status = 'open'", [req.user.id, b.targetId]);
    if (dup.rowCount) throw conflict('ALREADY_REPORTED', 'You have already reported this.');
    await query(
      'INSERT INTO reports (country_code, reporter_id, target_type, target_id, reason, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [rows[0]?.country_code ?? req.countryCode, req.user.id, b.targetType, b.targetId, b.reason, b.details ?? null],
    );
    res.status(201).json({ ok: true });
  },
);

// ---- Identity verification (optional) -------------------------------------
miscRouter.get('/me/identity', ...authed, async (req, res) => {
  const { rows } = await query('SELECT status, review_note, created_at, reviewed_at FROM identity_checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [req.user.id]);
  const c = rows[0];
  res.json({ identity: c ? { status: c.status, note: c.review_note, submittedAt: c.created_at, reviewedAt: c.reviewed_at } : null });
});

miscRouter.post('/me/identity', ...authed, upload.any(), async (req, res) => {
  const b = multipartData(req, z.object({ idNumber: z.string().trim().min(5).max(40) }));
  const selfie = filesOf(req, 'selfie')[0];
  if (!selfie) throw badRequest('PROOF_REQUIRED', 'A selfie holding your ID is required.', { missing: ['selfie'] });
  const pending = await query("SELECT 1 FROM identity_checks WHERE user_id = $1 AND status IN ('pending','approved')", [req.user.id]);
  if (pending.rowCount) throw conflict('IDENTITY_EXISTS', 'Your identity check is already submitted or approved.');
  const img = await storeImage(selfie.buffer, req.countryCode, { moderateImage: false });
  await query(
    'INSERT INTO identity_checks (user_id, country_code, id_number_enc, id_number_hash, selfie_key) VALUES ($1,$2,$3,$4,$5)',
    [req.user.id, req.countryCode, encrypt(b.idNumber), blindIndex(b.idNumber, 'identity'), img.key],
  );
  await audit({ actorId: req.user.id, countryCode: req.countryCode, action: 'identity.submit', ip: req.ip });
  res.status(201).json({ identity: { status: 'pending' } });
});

// ---- Success stories (with consent), per country ---------------------------
miscRouter.get('/stories', ...authed, async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.note, r.stars, r.created_at, f.category, c.name AS city_name,
            EXTRACT(EPOCH FROM (h.completed_at - f.created_at)) / 86400 AS days
     FROM ratings r JOIN handovers h ON h.id = r.handover_id JOIN found_items f ON f.id = h.found_item_id
     LEFT JOIN cities c ON c.id = f.city_id
     WHERE r.country_code = $1 AND r.share_story AND r.story_status = 'visible' AND r.note IS NOT NULL
     ORDER BY r.created_at DESC LIMIT 12`,
    [req.countryCode],
  );
  res.json({ stories: rows.map((s) => ({ id: s.id, note: s.note, stars: s.stars, category: s.category, city: s.city_name, days: Math.max(0, Math.round(Number(s.days))), createdAt: s.created_at })) });
});

// ---- Translation of posts and messages -------------------------------------
miscRouter.get('/translate/status', async (_req, res) => res.json({ enabled: await translationEnabled() }));

miscRouter.post(
  '/translate',
  ...authed,
  validate({ body: z.object({ type: z.enum(['found_item', 'message', 'lost_report']), id: z.string().uuid(), target: z.string().refine(isSupportedLanguage) }) }),
  async (req, res) => {
    const { type, id, target } = req.body;
    let text;
    if (type === 'found_item') {
      text = (await loadVisibleItem(id, req.user)).description; // public description only
    } else if (type === 'lost_report') {
      const { rows } = await query('SELECT description FROM lost_reports WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
      if (!rows[0]) throw notFound();
      text = rows[0].description;
    } else {
      const { rows } = await query(
        `SELECT m.body FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = $1 AND (c.finder_id = $2 OR c.claimant_id = $2)`,
        [id, req.user.id],
      );
      if (!rows[0]) throw notFound();
      text = rows[0].body; // already masked
    }
    res.json(await translate(text, target));
  },
);

// ---- Safe handover places --------------------------------------------------
miscRouter.get(
  '/safe-places',
  ...authed,
  validate({ query: z.object({ lat: latitude, lng: longitude, radiusM: z.coerce.number().int().min(500).max(10000).default(3000) }) }),
  async (req, res) => {
    const country = await getCountry(req.countryCode);
    res.json({
      places: await findSafePlaces({ ...req.validQuery, countryCode: req.countryCode, types: country.safe_place_types }),
    });
  },
);

// ---- Locally stored files (only used without R2) ---------------------------
miscRouter.get(/^\/files\/(.+)$/, async (req, res) => {
  const file = await readLocal(req.params[0], req.query.exp, req.query.sig);
  if (!file) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  res.set({ 'Content-Type': file.content_type, 'Cache-Control': 'private, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(file.data);
});
