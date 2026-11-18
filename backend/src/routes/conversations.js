// /api/conversations — masked in-app chat between finder and claimant.
// Phone numbers, emails, links and ID numbers are masked automatically.
// Clients poll for new messages (?after=<iso>), which keeps hosting simple.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { isSupportedLanguage } from '../data/languages.js';
import { badRequest, notFound, tooMany } from '../lib/errors.js';
import { maskSensitive } from '../lib/textGuard.js';
import { validate } from '../lib/validate.js';
import { requireAuth, requireOnboarded } from '../middleware/auth.js';
import { getCountry } from '../services/countries.js';
import { notify } from '../services/notifications.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth, requireOnboarded);

const OPEN_CLAIM = ['pending', 'follow_up', 'approved'];

async function loadConversation(id, user) {
  const { rows } = await query(
    `SELECT cv.*, c.status AS claim_status, c.found_item_id, f.category, f.description,
            h.completed_at AS returned_at
     FROM conversations cv JOIN claims c ON c.id = cv.claim_id JOIN found_items f ON f.id = c.found_item_id
     LEFT JOIN handovers h ON h.claim_id = c.id WHERE cv.id = $1`,
    [id],
  );
  const cv = rows[0];
  if (!cv || (cv.finder_id !== user.id && cv.claimant_id !== user.id)) throw notFound('Conversation not found.');
  return cv;
}

const canWrite = (cv) =>
  OPEN_CLAIM.includes(cv.claim_status) && (!cv.returned_at || Date.now() - new Date(cv.returned_at).getTime() < 14 * 864e5);

conversationsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT cv.id, cv.claim_id, cv.finder_id, cv.claimant_id, cv.last_message_at, cv.created_at,
            c.status AS claim_status, f.category, f.description, f.id AS item_id,
            uf.display_name AS finder_name, uc.display_name AS claimant_name,
            (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY created_at DESC LIMIT 1) AS last_body,
            (SELECT count(*)::int FROM messages m WHERE m.conversation_id = cv.id AND m.sender_id <> $1
               AND m.created_at > COALESCE(CASE WHEN cv.finder_id = $1 THEN cv.finder_read_at ELSE cv.claimant_read_at END, 'epoch')) AS unread
     FROM conversations cv JOIN claims c ON c.id = cv.claim_id JOIN found_items f ON f.id = c.found_item_id
     JOIN users uf ON uf.id = cv.finder_id JOIN users uc ON uc.id = cv.claimant_id
     WHERE cv.finder_id = $1 OR cv.claimant_id = $1
     ORDER BY COALESCE(cv.last_message_at, cv.created_at) DESC LIMIT 100`,
    [req.user.id],
  );
  res.json({
    conversations: rows.map((r) => ({
      id: r.id,
      claimId: r.claim_id,
      itemId: r.item_id,
      role: r.finder_id === req.user.id ? 'finder' : 'claimant',
      otherName: r.finder_id === req.user.id ? r.claimant_name : r.finder_name,
      category: r.category,
      description: r.description,
      claimStatus: r.claim_status,
      lastMessage: r.last_body,
      lastMessageAt: r.last_message_at,
      unread: r.unread,
    })),
  });
});

conversationsRouter.get(
  '/:id/messages',
  validate({ params: z.object({ id: z.string().uuid() }), query: z.object({ after: z.coerce.date().optional() }) }),
  async (req, res) => {
    const cv = await loadConversation(req.validParams.id, req.user);
    const { rows } = await query(
      `SELECT id, sender_id, body, original_language, was_masked, created_at FROM messages
       WHERE conversation_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2) ORDER BY created_at LIMIT 500`,
      [cv.id, req.validQuery.after ?? null],
    );
    const col = cv.finder_id === req.user.id ? 'finder_read_at' : 'claimant_read_at';
    await query(`UPDATE conversations SET ${col} = now() WHERE id = $1`, [cv.id]);
    const isFinder = cv.finder_id === req.user.id;
    res.json({
      conversation: {
        id: cv.id,
        claimId: cv.claim_id,
        itemId: cv.found_item_id,
        role: isFinder ? 'finder' : 'claimant',
        category: cv.category,
        description: cv.description,
        claimStatus: cv.claim_status,
        canWrite: canWrite(cv),
      },
      messages: rows.map((m) => ({
        id: m.id,
        mine: m.sender_id === req.user.id,
        body: m.body,
        language: m.original_language,
        masked: m.was_masked,
        createdAt: m.created_at,
      })),
    });
  },
);

conversationsRouter.post(
  '/:id/messages',
  validate({
    params: z.object({ id: z.string().uuid() }),
    body: z.object({ body: z.string().trim().min(1).max(1000), language: z.string().max(8).optional() }),
  }),
  async (req, res) => {
    const cv = await loadConversation(req.validParams.id, req.user);
    if (!canWrite(cv)) throw badRequest('CONVERSATION_CLOSED', 'This conversation is closed.');
    const recent = await query("SELECT count(*)::int AS n FROM messages WHERE sender_id = $1 AND created_at > now() - interval '1 minute'", [req.user.id]);
    if (recent.rows[0].n >= 20) throw tooMany('You are sending messages too quickly.');
    const country = await getCountry(cv.country_code);
    const { text, masked } = maskSensitive(req.body.body, country);
    const lang = isSupportedLanguage(req.body.language) ? req.body.language : req.user.language;
    const { rows } = await query(
      `INSERT INTO messages (conversation_id, country_code, sender_id, body, original_language, was_masked)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, body, original_language, was_masked, created_at`,
      [cv.id, cv.country_code, req.user.id, text, lang, masked],
    );
    await query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [cv.id]);
    // One "new message" notification per 10 minutes per conversation.
    const other = cv.finder_id === req.user.id ? cv.claimant_id : cv.finder_id;
    const already = await query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'new_message' AND data->>'conversationId' = $2
         AND created_at > now() - interval '10 minutes'`,
      [other, cv.id],
    );
    if (!already.rowCount) {
      await notify({ userId: other, countryCode: cv.country_code.trim(), type: 'new_message', data: { category: cv.category, conversationId: cv.id }, url: `/messages/${cv.id}` });
    }
    const m = rows[0];
    res.status(201).json({ message: { id: m.id, mine: true, body: m.body, language: m.original_language, masked: m.was_masked, createdAt: m.created_at } });
  },
);
