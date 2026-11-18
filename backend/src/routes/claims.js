// Claims, verification, handover and ratings — the core flow.
//
//   owner claims (answers + proof) → finder reviews side-by-side
//   → approve / ask follow-up / reject → both agree to hand over
//   → choose method + safe place → owner shows 6-digit code / QR
//   → finder enters it → item "Returned" → both rate each other.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { proofRequirements } from '../lib/categories.js';
import { blindIndex, decrypt, encrypt, randomDigits, safeEqual } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../lib/errors.js';
import { maskSensitive } from '../lib/textGuard.js';
import { filesOf, multipartData, upload } from '../lib/upload.js';
import { latitude, longitude, validate } from '../lib/validate.js';
import { requireAuth, requireOnboarded } from '../middleware/auth.js';
import { getCountry } from '../services/countries.js';
import { storeImage } from '../services/images.js';
import { loadVisibleItem, serializeItems } from '../services/items.js';
import { notify } from '../services/notifications.js';
import { signedUrl } from '../services/storage.js';
import { trustLevel } from '../services/users.js';
import { canClaim } from './foundItems.js';

export const claimsRouter = Router();
claimsRouter.use(requireAuth, requireOnboarded);

export const MAX_CLAIMS_PER_DAY = 3;
const CLAIM_TTL = "interval '7 days'";
const uuidParam = validate({ params: z.object({ id: z.string().uuid() }) });

// ---------------------------------------------------------------------------
// Create a claim: POST /api/found-items/:id/claims  (multipart)
//   data = { answers: [{questionId, answer}], proof: { identifier?, contents?, text? } }
//   files: proofImages (0..5), selfie (0..1)
// ---------------------------------------------------------------------------
const claimSchema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().trim().min(1).max(300) })).min(1).max(4),
  proof: z
    .object({
      identifier: z.string().trim().min(3).max(64).optional(), // ID number, card number, IMEI or serial
      contents: z.string().trim().max(600).optional(),
      text: z.string().trim().max(1000).optional(),
    })
    .default({}),
});

export async function createClaim(req, res) {
  const user = req.user;
  const item = await loadVisibleItem(req.params.id, user);
  if (!canClaim(item, user)) throw forbidden('CANNOT_CLAIM', 'You cannot claim this item.');
  const b = multipartData(req, claimSchema);
  const proofImages = filesOf(req, 'proofImages').slice(0, 5);
  const selfie = filesOf(req, 'selfie')[0];

  const history = await query(
    `SELECT status, created_at FROM claims WHERE claimant_id = $1 AND created_at > now() - interval '30 days'`,
    [user.id],
  );
  const forItem = await query('SELECT status FROM claims WHERE claimant_id = $1 AND found_item_id = $2', [user.id, item.id]);
  if (forItem.rows.some((c) => c.status === 'rejected')) throw forbidden('CLAIM_REJECTED_BEFORE', 'Your earlier claim for this item was rejected.');
  if (forItem.rows.some((c) => ['pending', 'follow_up', 'approved'].includes(c.status))) throw conflict('CLAIM_EXISTS', 'You already have a claim for this item.');
  const today = history.rows.filter((c) => new Date(c.created_at) > new Date(Date.now() - 864e5)).length;
  if (today >= MAX_CLAIMS_PER_DAY) throw tooMany('You can make up to 3 claims per day.');

  // Every hidden question must be answered.
  const qs = await query('SELECT id FROM hidden_questions WHERE found_item_id = $1', [item.id]);
  const answered = new Map(b.answers.map((a) => [a.questionId, a.answer]));
  if (qs.rows.some((q) => !answered.get(q.id))) throw badRequest('ANSWERS_REQUIRED', 'Please answer every question.');
  if (b.answers.some((a) => !qs.rows.find((q) => q.id === a.questionId))) throw badRequest('VALIDATION_FAILED', 'Unknown question.');

  // Category-specific proof.
  const need = proofRequirements(item.category);
  const missing = [];
  if (need.idNumber && !b.proof.identifier) missing.push('identifier');
  if (need.selfie && !selfie) missing.push('selfie');
  if (need.serialOrImage && !b.proof.identifier && !proofImages.length) missing.push('identifier_or_images');
  if (need.text && !b.proof.contents && !b.proof.text) missing.push('contents');
  if (need.textOrImage && !b.proof.text && !b.proof.contents && !proofImages.length) missing.push('text_or_images');
  if (missing.length) throw badRequest('PROOF_REQUIRED', 'Some proof is missing.', { missing });

  // Server-side comparison of the identifier — never displayed to anyone.
  let idMatch = null;
  if (b.proof.identifier && item.private_id_hash) idMatch = blindIndex(b.proof.identifier, 'identifier') === item.private_id_hash;

  // Suspicious-pattern flags (shown to admins/moderators).
  const flags = [];
  if (idMatch === false) flags.push('identifier_mismatch');
  if (Date.now() - new Date(user.created_at).getTime() < 864e5) flags.push('new_account');
  const rejected30 = history.rows.filter((c) => c.status === 'rejected' && new Date(c.created_at) > new Date(Date.now() - 30 * 864e5)).length;
  if (rejected30 >= 2) flags.push('repeated_rejections');
  const week = history.rows.filter((c) => new Date(c.created_at) > new Date(Date.now() - 7 * 864e5)).length;
  if (week >= 5) flags.push('many_claims');

  const stored = [];
  for (const f of proofImages) stored.push({ kind: 'photo', ...(await storeImage(f.buffer, item.country_code.trim(), { blurFaces: false })) });
  if (selfie) stored.push({ kind: 'selfie', ...(await storeImage(selfie.buffer, item.country_code.trim(), { blurFaces: false })) });

  const claim = await tx(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO claims (country_code, found_item_id, claimant_id, id_number_match, flagged, flag_reasons, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ${CLAIM_TTL}) RETURNING *`,
      [item.country_code, item.id, user.id, idMatch, flags.length > 0, flags],
    );
    const c = rows[0];
    for (const a of b.answers) {
      await db.query('INSERT INTO claim_answers (claim_id, question_id, answer_enc) VALUES ($1,$2,$3)', [c.id, a.questionId, encrypt(a.answer)]);
    }
    const textProofs = [
      ['id_number', b.proof.identifier],
      ['contents', b.proof.contents],
      ['text', b.proof.text],
    ].filter(([, v]) => v);
    for (const [kind, v] of textProofs) {
      await db.query('INSERT INTO claim_proofs (claim_id, country_code, kind, text_enc) VALUES ($1,$2,$3,$4)', [c.id, item.country_code, kind, encrypt(v)]);
    }
    for (const s of stored) {
      await db.query('INSERT INTO claim_proofs (claim_id, country_code, kind, r2_key) VALUES ($1,$2,$3,$4)', [c.id, item.country_code, s.kind, s.key]);
    }
    await db.query(
      'INSERT INTO conversations (country_code, claim_id, finder_id, claimant_id) VALUES ($1,$2,$3,$4)',
      [item.country_code, c.id, item.finder_id, user.id],
    );
    await db.query("UPDATE found_items SET status = 'under_review', updated_at = now() WHERE id = $1 AND status = 'waiting'", [item.id]);
    await audit({ actorId: user.id, countryCode: item.country_code.trim(), action: 'claim.create', targetType: 'claim', targetId: c.id, meta: { item: item.id, flags }, ip: req.ip }, db);
    return c;
  });

  await notify({ userId: item.finder_id, countryCode: item.country_code.trim(), type: 'new_claim', data: { category: item.category, itemId: item.id, claimId: claim.id }, url: `/my/found/${item.id}/claims` });
  res.status(201).json({ claim: { id: claim.id, status: claim.status, expiresAt: claim.expires_at } });
}

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------
async function loadClaim(id, db = { query }) {
  const { rows } = await db.query(
    `SELECT c.*, f.finder_id, f.category, f.status AS item_status, f.country_code AS item_country, f.private_id_hash
     FROM claims c JOIN found_items f ON f.id = c.found_item_id WHERE c.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Claim not found.');
  return rows[0];
}

function roleIn(claim, user) {
  if (claim.finder_id === user.id) return 'finder';
  if (claim.claimant_id === user.id) return 'claimant';
  return null;
}

async function requireParty(id, user) {
  const claim = await loadClaim(id);
  const role = roleIn(claim, user);
  if (!role) throw notFound('Claim not found.');
  return { claim, role };
}

async function proofsFor(claimId) {
  const { rows } = await query('SELECT id, kind, text_enc, r2_key FROM claim_proofs WHERE claim_id = $1 ORDER BY created_at', [claimId]);
  return Promise.all(
    rows.map(async (p) => ({
      id: p.id,
      kind: p.kind,
      // ID / card numbers and serials are compared by the server and never shown.
      text: p.text_enc && (p.kind === 'contents' || p.kind === 'text') ? decrypt(p.text_enc) : undefined,
      provided: p.kind === 'id_number' ? true : undefined,
      url: p.r2_key ? await signedUrl(p.r2_key) : undefined,
      thumbUrl: p.r2_key ? await signedUrl(p.r2_key.replace(/\.jpg$/, '_thumb.jpg')) : undefined,
    })),
  );
}

// ---------------------------------------------------------------------------
// Finder: review all claims for an item, side-by-side with the hidden answers.
// GET /api/found-items/:id/claims
// ---------------------------------------------------------------------------
export async function listItemClaims(req, res) {
  const item = await loadVisibleItem(req.params.id, req.user);
  const staff = ['admin', 'moderator'].includes(req.user.role);
  if (item.finder_id !== req.user.id && !staff) throw forbidden();
  const questions = await query('SELECT id, question, answer_enc FROM hidden_questions WHERE found_item_id = $1 ORDER BY position', [item.id]);
  const { rows } = await query(
    `SELECT c.*, u.display_name, u.created_at AS member_since, u.returns_count, u.phone_verified_at, u.trust_score,
            EXISTS (SELECT 1 FROM identity_checks ic WHERE ic.user_id = u.id AND ic.status = 'approved') AS identity_verified
     FROM claims c JOIN users u ON u.id = c.claimant_id WHERE c.found_item_id = $1 ORDER BY c.created_at`,
    [item.id],
  );
  const claims = await Promise.all(
    rows.map(async (c) => {
      const answers = await query('SELECT question_id, answer_enc FROM claim_answers WHERE claim_id = $1', [c.id]);
      const byQ = new Map(answers.rows.map((a) => [a.question_id, decrypt(a.answer_enc)]));
      return {
        id: c.id,
        status: c.status,
        createdAt: c.created_at,
        expiresAt: c.expires_at,
        decidedAt: c.decided_at,
        rejectReason: c.reject_reason,
        followUp: c.follow_up_question ? { question: c.follow_up_question, answer: c.follow_up_answer_enc ? decrypt(c.follow_up_answer_enc) : null } : null,
        identifierMatch: c.id_number_match,
        flags: staff ? c.flag_reasons : undefined,
        flagged: c.flagged,
        claimant: {
          displayName: c.display_name,
          memberSince: c.member_since,
          returnsCount: c.returns_count,
          trustLevel: trustLevel(c),
        },
        comparison: questions.rows.map((q) => ({ questionId: q.id, question: q.question, expected: decrypt(q.answer_enc), answer: byQ.get(q.id) ?? null })),
        proofs: await proofsFor(c.id),
      };
    }),
  );
  await audit({ actorId: req.user.id, countryCode: item.country_code.trim(), action: 'claim.review_view', targetType: 'found_item', targetId: item.id, ip: req.ip });
  const [itemOut] = await serializeItems([item], req.user, { full: true });
  res.json({ item: itemOut, claims });
}

// ---------------------------------------------------------------------------
// Finder decision
// ---------------------------------------------------------------------------
claimsRouter.post(
  '/:id/decision',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.discriminatedUnion('action', [
      z.object({ action: z.literal('approve') }),
      z.object({ action: z.literal('reject'), reason: z.enum(['answers_wrong', 'proof_insufficient', 'suspicious', 'other']), note: z.string().trim().max(300).optional() }),
      z.object({ action: z.literal('ask'), question: z.string().trim().min(3).max(300) }),
    ]),
  }),
  async (req, res) => {
    const { claim, role } = await requireParty(req.validParams.id, req.user);
    if (role !== 'finder') throw forbidden();
    if (!['pending', 'follow_up'].includes(claim.status)) throw badRequest('CLAIM_CLOSED', 'This claim is no longer open.');
    const cc = claim.country_code.trim();
    const b = req.body;

    if (b.action === 'approve') {
      const others = await tx(async (db) => {
        const item = await db.query('SELECT status FROM found_items WHERE id = $1 FOR UPDATE', [claim.found_item_id]);
        if (!['waiting', 'under_review'].includes(item.rows[0].status)) throw conflict('ITEM_LOCKED', 'Another claim was already approved.');
        await db.query("UPDATE claims SET status = 'approved', decided_at = now(), updated_at = now() WHERE id = $1", [claim.id]);
        const rej = await db.query(
          `UPDATE claims SET status = 'rejected', reject_reason = 'another_claim_approved', decided_at = now(), updated_at = now()
           WHERE found_item_id = $1 AND id <> $2 AND status IN ('pending','follow_up') RETURNING claimant_id`,
          [claim.found_item_id, claim.id],
        );
        await db.query("UPDATE found_items SET status = 'approved', updated_at = now() WHERE id = $1", [claim.found_item_id]);
        await db.query(
          `INSERT INTO handovers (country_code, claim_id, found_item_id, owner_id, finder_id) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (claim_id) DO NOTHING`,
          [cc, claim.id, claim.found_item_id, claim.claimant_id, claim.finder_id],
        );
        await audit({ actorId: req.user.id, countryCode: cc, action: 'claim.approve', targetType: 'claim', targetId: claim.id, ip: req.ip }, db);
        return rej.rows;
      });
      await notify({ userId: claim.claimant_id, countryCode: cc, type: 'claim_approved', data: { category: claim.category, claimId: claim.id }, url: `/claims/${claim.id}` });
      for (const o of others) await notify({ userId: o.claimant_id, countryCode: cc, type: 'claim_rejected', data: { category: claim.category }, url: '/my/claims' });
    } else if (b.action === 'reject') {
      await tx(async (db) => {
        await db.query(
          "UPDATE claims SET status = 'rejected', reject_reason = $2, admin_note = $3, decided_at = now(), updated_at = now() WHERE id = $1",
          [claim.id, b.reason, b.note ?? null],
        );
        await db.query(
          `UPDATE found_items SET status = 'waiting', updated_at = now() WHERE id = $1 AND status = 'under_review'
             AND NOT EXISTS (SELECT 1 FROM claims WHERE found_item_id = $1 AND status IN ('pending','follow_up'))`,
          [claim.found_item_id],
        );
        await audit({ actorId: req.user.id, countryCode: cc, action: 'claim.reject', targetType: 'claim', targetId: claim.id, meta: { reason: b.reason }, ip: req.ip }, db);
      });
      await notify({ userId: claim.claimant_id, countryCode: cc, type: 'claim_rejected', data: { category: claim.category, reason: b.reason }, url: '/my/claims' });
    } else {
      const country = await getCountry(cc);
      await query(
        `UPDATE claims SET status = 'follow_up', follow_up_question = $2, follow_up_answer_enc = NULL, expires_at = now() + ${CLAIM_TTL}, updated_at = now()
         WHERE id = $1`,
        [claim.id, maskSensitive(b.question, country).text],
      );
      await audit({ actorId: req.user.id, countryCode: cc, action: 'claim.follow_up', targetType: 'claim', targetId: claim.id, ip: req.ip });
      await notify({ userId: claim.claimant_id, countryCode: cc, type: 'claim_follow_up', data: { category: claim.category, claimId: claim.id }, url: `/claims/${claim.id}` });
    }
    res.json({ claim: await claimView(claim.id, req.user) });
  },
);

claimsRouter.post(
  '/:id/follow-up',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ answer: z.string().trim().min(1).max(600) }) }),
  async (req, res) => {
    const { claim, role } = await requireParty(req.validParams.id, req.user);
    if (role !== 'claimant') throw forbidden();
    if (claim.status !== 'follow_up') throw badRequest('CLAIM_CLOSED', 'There is no open question.');
    await query(
      `UPDATE claims SET status = 'pending', follow_up_answer_enc = $2, expires_at = now() + ${CLAIM_TTL}, updated_at = now() WHERE id = $1`,
      [claim.id, encrypt(req.body.answer)],
    );
    await notify({ userId: claim.finder_id, countryCode: claim.country_code.trim(), type: 'follow_up_answered', data: { category: claim.category, claimId: claim.id }, url: `/my/found/${claim.found_item_id}/claims` });
    res.json({ claim: await claimView(claim.id, req.user) });
  },
);

claimsRouter.post('/:id/withdraw', uuidParam, async (req, res) => {
  const { claim, role } = await requireParty(req.validParams.id, req.user);
  if (role !== 'claimant') throw forbidden();
  if (!['pending', 'follow_up'].includes(claim.status)) throw badRequest('CLAIM_CLOSED', 'This claim is no longer open.');
  await tx(async (db) => {
    await db.query("UPDATE claims SET status = 'withdrawn', updated_at = now() WHERE id = $1", [claim.id]);
    await db.query(
      `UPDATE found_items SET status = 'waiting' WHERE id = $1 AND status = 'under_review'
         AND NOT EXISTS (SELECT 1 FROM claims WHERE found_item_id = $1 AND status IN ('pending','follow_up'))`,
      [claim.found_item_id],
    );
  });
  res.json({ claim: await claimView(claim.id, req.user) });
});

// ---------------------------------------------------------------------------
// Claim detail + timeline (claimant or finder)
// ---------------------------------------------------------------------------
async function claimView(id, user) {
  const claim = await loadClaim(id);
  const role = roleIn(claim, user);
  const { rows: items } = await query('SELECT f.*, c.name AS city_name FROM found_items f LEFT JOIN cities c ON c.id = f.city_id WHERE f.id = $1', [claim.found_item_id]);
  const [item] = await serializeItems(items, user);
  const h = await query('SELECT * FROM handovers WHERE claim_id = $1', [claim.id]);
  const conv = await query('SELECT id FROM conversations WHERE claim_id = $1', [claim.id]);
  const handover = h.rows[0];
  const timeline = [{ event: 'submitted', at: claim.created_at }];
  if (claim.follow_up_question) timeline.push({ event: 'follow_up', at: claim.updated_at });
  if (claim.decided_at) timeline.push({ event: claim.status === 'approved' ? 'approved' : 'rejected', at: claim.decided_at });
  if (['expired', 'withdrawn'].includes(claim.status)) timeline.push({ event: claim.status, at: claim.updated_at });
  if (handover?.finder_agreed_at && handover?.owner_agreed_at) timeline.push({ event: 'handover_agreed', at: new Date(Math.max(handover.finder_agreed_at, handover.owner_agreed_at)) });
  if (handover?.completed_at) timeline.push({ event: 'returned', at: handover.completed_at });
  return {
    id: claim.id,
    role,
    status: claim.status,
    rejectReason: claim.reject_reason,
    followUpQuestion: claim.status === 'follow_up' ? claim.follow_up_question : null,
    createdAt: claim.created_at,
    expiresAt: claim.expires_at,
    item,
    conversationId: conv.rows[0]?.id ?? null,
    handover: handover ? { id: handover.id, completed: Boolean(handover.completed_at) } : null,
    timeline,
  };
}

claimsRouter.get('/mine', async (req, res) => {
  const { rows } = await query('SELECT id FROM claims WHERE claimant_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json({ claims: await Promise.all(rows.map((r) => claimView(r.id, req.user))) });
});

claimsRouter.get('/:id', uuidParam, async (req, res) => {
  await requireParty(req.validParams.id, req.user);
  res.json({ claim: await claimView(req.validParams.id, req.user) });
});

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------
async function loadHandover(claimId, user) {
  const { claim, role } = await requireParty(claimId, user);
  if (claim.status !== 'approved') throw badRequest('CLAIM_NOT_APPROVED', 'The claim has not been approved yet.');
  const { rows } = await query('SELECT * FROM handovers WHERE claim_id = $1', [claim.id]);
  if (!rows[0]) throw notFound('Handover not found.');
  return { claim, role, h: rows[0] };
}

async function handoverView(claimId, user) {
  const { claim, role, h } = await loadHandover(claimId, user);
  const both = Boolean(h.finder_agreed_at && h.owner_agreed_at);
  const phonesShared = h.finder_shares_phone && h.owner_shares_phone;
  let phones = null;
  if (phonesShared) {
    const { rows } = await query('SELECT id, phone_enc FROM users WHERE id IN ($1,$2)', [h.finder_id, h.owner_id]);
    const other = rows.find((r) => r.id !== user.id);
    phones = { other: other?.phone_enc ? decrypt(other.phone_enc) : null };
  }
  const item = await query('SELECT current_location, current_location_note, approx_lat, approx_lng FROM found_items WHERE id = $1', [claim.found_item_id]);
  const rating = await query('SELECT stars FROM ratings WHERE handover_id = $1 AND rater_id = $2', [h.id, user.id]);
  // Suggested centre for safe places: halfway between both people's home areas
  // (or cities); never revealed as such — only used to search nearby places.
  const spots = await query(
    `SELECT COALESCE(u.home_lat, ci.lat) AS lat, COALESCE(u.home_lng, ci.lng) AS lng
     FROM users u LEFT JOIN cities ci ON ci.id = u.city_id WHERE u.id IN ($1,$2)`,
    [h.finder_id, h.owner_id],
  );
  const pts = spots.rows.filter((p) => p.lat != null);
  const meetingCenter = pts.length
    ? { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length }
    : { lat: item.rows[0].approx_lat, lng: item.rows[0].approx_lng };
  return {
    id: h.id,
    claimId: claim.id,
    role,
    category: claim.category,
    finderAgreed: Boolean(h.finder_agreed_at),
    ownerAgreed: Boolean(h.owner_agreed_at),
    bothAgreed: both,
    method: h.method,
    place: h.place_name ? { name: h.place_name, lat: h.place_lat, lng: h.place_lng, osmId: h.place_osm_id } : null,
    scheduledFor: h.scheduled_for,
    sharePhone: role === 'finder' ? h.finder_shares_phone : h.owner_shares_phone,
    otherSharesPhone: role === 'finder' ? h.owner_shares_phone : h.finder_shares_phone,
    phones,
    // Only the OWNER ever receives the code; the finder must get it from them in person.
    code: role === 'claimant' && both && h.code_enc && !h.completed_at ? decrypt(h.code_enc) : null,
    completedAt: h.completed_at,
    itemLocation: { current: item.rows[0].current_location, note: item.rows[0].current_location_note, approx: { lat: item.rows[0].approx_lat, lng: item.rows[0].approx_lng } },
    rated: rating.rowCount > 0,
    meetingCenter,
  };
}

claimsRouter.get('/:id/handover', uuidParam, async (req, res) => {
  res.json({ handover: await handoverView(req.validParams.id, req.user) });
});

claimsRouter.post('/:id/handover/agree', uuidParam, async (req, res) => {
  const { claim, role, h } = await loadHandover(req.validParams.id, req.user);
  const col = role === 'finder' ? 'finder_agreed_at' : 'owner_agreed_at';
  const { rows } = await query(`UPDATE handovers SET ${col} = COALESCE(${col}, now()) WHERE id = $1 RETURNING *`, [h.id]);
  const u = rows[0];
  if (u.finder_agreed_at && u.owner_agreed_at && !u.code_hash) {
    const code = randomDigits(6);
    await query('UPDATE handovers SET code_hash = $2, code_enc = $3 WHERE id = $1', [h.id, blindIndex(code, `handover:${h.id}`), encrypt(code)]);
    for (const uid of [h.finder_id, h.owner_id]) {
      await notify({ userId: uid, countryCode: claim.country_code.trim(), type: 'handover_ready', data: { category: claim.category, claimId: claim.id }, url: `/claims/${claim.id}/handover` });
    }
  }
  await audit({ actorId: req.user.id, countryCode: claim.country_code.trim(), action: 'handover.agree', targetType: 'handover', targetId: h.id, ip: req.ip });
  res.json({ handover: await handoverView(claim.id, req.user) });
});

claimsRouter.put(
  '/:id/handover',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      method: z.enum(['meet', 'courier', 'collect']).optional(),
      place: z.object({ name: z.string().trim().min(2).max(120), lat: latitude, lng: longitude, osmId: z.string().max(40).optional() }).nullable().optional(),
      scheduledFor: z.coerce.date().nullable().optional(),
      sharePhone: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const { claim, role, h } = await loadHandover(req.validParams.id, req.user);
    if (!(h.finder_agreed_at && h.owner_agreed_at)) throw badRequest('HANDOVER_NOT_AGREED', 'Both of you must agree to the handover first.');
    if (h.completed_at) throw badRequest('HANDOVER_DONE', 'This item has already been returned.');
    const b = req.body;
    if (b.place) {
      const { isPointInCountry } = await import('../services/geocode.js');
      if (!(await isPointInCountry(b.place.lat, b.place.lng, await getCountry(claim.country_code)))) {
        throw badRequest('LOCATION_OUTSIDE_COUNTRY', 'The place must be inside your country.');
      }
    }
    const phoneCol = role === 'finder' ? 'finder_shares_phone' : 'owner_shares_phone';
    await query(
      `UPDATE handovers SET method = COALESCE($2, method),
         place_name = CASE WHEN $3::boolean THEN $4 ELSE place_name END,
         place_lat = CASE WHEN $3::boolean THEN $5 ELSE place_lat END,
         place_lng = CASE WHEN $3::boolean THEN $6 ELSE place_lng END,
         place_osm_id = CASE WHEN $3::boolean THEN $7 ELSE place_osm_id END,
         scheduled_for = CASE WHEN $8::boolean THEN $9 ELSE scheduled_for END,
         ${phoneCol} = COALESCE($10, ${phoneCol}), reminder_sent_at = CASE WHEN $8::boolean THEN NULL ELSE reminder_sent_at END
       WHERE id = $1`,
      [h.id, b.method ?? null, b.place !== undefined, b.place?.name ?? null, b.place?.lat ?? null, b.place?.lng ?? null, b.place?.osmId ?? null,
        b.scheduledFor !== undefined, b.scheduledFor ?? null, b.sharePhone ?? null],
    );
    if (b.sharePhone !== undefined) {
      await audit({ actorId: req.user.id, countryCode: claim.country_code.trim(), action: b.sharePhone ? 'handover.share_phone' : 'handover.unshare_phone', targetType: 'handover', targetId: h.id, ip: req.ip });
    }
    const otherId = role === 'finder' ? h.owner_id : h.finder_id;
    if (b.method || b.place || b.scheduledFor) {
      await notify({ userId: otherId, countryCode: claim.country_code.trim(), type: 'handover_updated', data: { category: claim.category, claimId: claim.id }, url: `/claims/${claim.id}/handover` });
    }
    res.json({ handover: await handoverView(claim.id, req.user) });
  },
);

// Finder enters / scans the owner's code → item returned.
claimsRouter.post(
  '/:id/handover/complete',
  validate({ params: z.object({ id: z.string().uuid() }), body: z.object({ code: z.string().regex(/^\d{6}$/) }) }),
  async (req, res) => {
    const { claim, role, h } = await loadHandover(req.validParams.id, req.user);
    if (role !== 'finder') throw forbidden('FINDER_ONLY', 'Only the finder enters the handover code.');
    if (!h.code_hash) throw badRequest('HANDOVER_NOT_AGREED', 'Both of you must agree to the handover first.');
    if (h.completed_at) throw badRequest('HANDOVER_DONE', 'This item has already been returned.');
    if (h.code_attempts >= 5) throw tooMany('Too many wrong codes. Ask the owner to contact support.');
    await query('UPDATE handovers SET code_attempts = code_attempts + 1 WHERE id = $1', [h.id]);
    if (!safeEqual(h.code_hash, blindIndex(req.body.code, `handover:${h.id}`))) throw badRequest('HANDOVER_CODE_INVALID', 'That code is not correct.');

    const cc = claim.country_code.trim();
    await tx(async (db) => {
      await db.query('UPDATE handovers SET completed_at = now(), code_enc = NULL WHERE id = $1', [h.id]);
      await db.query("UPDATE found_items SET status = 'returned', returned_at = now(), updated_at = now() WHERE id = $1", [claim.found_item_id]);
      await db.query("UPDATE lost_reports SET status = 'found', updated_at = now() WHERE owner_id = $1 AND status = 'open' AND category = $2 AND id IN (SELECT lost_report_id FROM matches WHERE found_item_id = $3)", [claim.claimant_id, claim.category, claim.found_item_id]);
      await db.query('UPDATE users SET returns_count = returns_count + 1, points = points + 50, trust_score = trust_score + 5 WHERE id = $1', [claim.finder_id]);
      await db.query('UPDATE users SET trust_score = trust_score + 1 WHERE id = $1', [claim.claimant_id]);
      await audit({ actorId: req.user.id, countryCode: cc, action: 'handover.complete', targetType: 'handover', targetId: h.id, meta: { item: claim.found_item_id }, ip: req.ip }, db);
    });
    for (const uid of [claim.finder_id, claim.claimant_id]) {
      await notify({ userId: uid, countryCode: cc, type: 'item_returned', data: { category: claim.category, claimId: claim.id }, url: `/claims/${claim.id}/handover` });
    }
    res.json({ handover: await handoverView(claim.id, req.user) });
  },
);

// Rating, thank-you note, optional reward record and story consent.
claimsRouter.post(
  '/:id/rating',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({
      stars: z.number().int().min(1).max(5),
      note: z.string().trim().max(500).optional(),
      shareStory: z.boolean().default(false),
      reward: z.number().min(0).max(100_000_000).optional(),
    }),
  }),
  async (req, res) => {
    const { claim, role, h } = await loadHandover(req.validParams.id, req.user);
    if (!h.completed_at) throw badRequest('HANDOVER_NOT_DONE', 'You can rate after the item is returned.');
    const country = await getCountry(claim.country_code);
    const note = req.body.note ? maskSensitive(req.body.note, country).text : null;
    const ratee = role === 'finder' ? h.owner_id : h.finder_id;
    try {
      await query(
        `INSERT INTO ratings (country_code, handover_id, rater_id, ratee_id, stars, note, share_story, reward_amount, reward_currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [claim.country_code, h.id, req.user.id, ratee, req.body.stars, note, req.body.shareStory, role === 'claimant' ? req.body.reward ?? null : null, country.currency],
      );
    } catch (err) {
      if (err.code === '23505') throw conflict('ALREADY_RATED', 'You have already rated this handover.');
      throw err;
    }
    // Trust: good ratings add, poor ratings subtract.
    await query('UPDATE users SET trust_score = trust_score + $2 WHERE id = $1', [ratee, req.body.stars >= 4 ? 2 : req.body.stars <= 2 ? -3 : 0]);
    if (role === 'claimant' && req.body.stars >= 4) await query('UPDATE users SET points = points + 10 WHERE id = $1', [ratee]);
    res.status(201).json({ ok: true });
  },
);
