// Lost ↔ found matching, always within ONE country.
// Score (0–100) = category gate + distance (40) + date window (25) + keywords (35).
// An identical serial/IMEI/ID (blind index) is an automatic 100.
// Matches ≥ MIN_SCORE are stored and both sides are notified.
// Saved alerts are checked whenever a new item is found.
import { query } from '../db/pool.js';
import { boundingBox, haversine } from '../lib/geo.js';
import { notify } from './notifications.js';

export const MIN_SCORE = 55;
const STOP = new Set(['the', 'a', 'an', 'and', 'with', 'of', 'in', 'on', 'my', 'near', 'at', 'for', 'to', 'is', 'it', 'was']);

export const tokens = (s) =>
  new Set(
    String(s || '')
      .toLowerCase()
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );

function keywordScore(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / Math.min(A.size, B.size); // overlap coefficient 0..1
}

/** Score one found item against one lost report. */
export function scorePair(found, lost) {
  if (found.category !== lost.category) return null;
  if (found.private_id_hash && lost.private_details_hash && found.private_id_hash === lost.private_details_hash) {
    return { score: 100, breakdown: { identifier: true } };
  }
  const meters = haversine(found.lat, found.lng, lost.lat, lost.lng);
  const reach = (lost.radius_m || 2000) + 500;
  const distance = meters <= reach ? 1 : Math.max(0, 1 - (meters - reach) / (reach * 3));

  const f = new Date(found.found_at).getTime();
  const from = new Date(lost.lost_from).getTime();
  const to = new Date(lost.lost_to).getTime();
  const DAY = 864e5;
  let date;
  if (f >= from - DAY && f <= to + 3 * DAY) date = 1; // found shortly after it was lost
  else if (f < from - DAY) date = 0; // found before it was lost
  else date = Math.max(0, 1 - (f - (to + 3 * DAY)) / (30 * DAY));

  const keywords = keywordScore(found.description, lost.description);
  const score = Math.round(distance * 40 + date * 25 + keywords * 35);
  return { score, breakdown: { distanceM: Math.round(meters), distance, date, keywords: Math.round(keywords * 100) / 100 } };
}

async function saveMatch(found, lost, result) {
  const { rows } = await query(
    `INSERT INTO matches (country_code, found_item_id, lost_report_id, score, breakdown)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (found_item_id, lost_report_id) DO NOTHING RETURNING id`,
    [found.country_code, found.id, lost.id, result.score, result.breakdown],
  );
  if (!rows[0]) return null;
  const data = { category: found.category, score: result.score };
  await notify({ userId: lost.owner_id, countryCode: lost.country_code, type: 'match_for_owner', data: { ...data, itemId: found.id }, url: `/items/${found.id}` });
  await notify({ userId: found.finder_id, countryCode: found.country_code, type: 'match_for_finder', data: { ...data, itemId: found.id }, url: `/my/found` });
  await query('UPDATE matches SET notified_at = now() WHERE id = $1', [rows[0].id]);
  return rows[0].id;
}

/** New found item → compare with open lost reports in the same country (incl. travellers). */
export async function matchFoundItem(found) {
  const box = boundingBox(found.lat, found.lng, 60_000);
  const { rows } = await query(
    `SELECT * FROM lost_reports
     WHERE country_code = $1 AND category = $2 AND status = 'open' AND owner_id <> $3
       AND (is_travel = false OR travel_until > now())
       AND ((lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7) OR private_details_hash = $8)`,
    [found.country_code, found.category, found.finder_id, box.minLat, box.maxLat, box.minLng, box.maxLng, found.private_id_hash ?? '-'],
  );
  let n = 0;
  for (const lost of rows) {
    const r = scorePair(found, lost);
    if (r && r.score >= MIN_SCORE && (await saveMatch(found, lost, r))) n += 1;
  }
  await checkAlerts(found);
  return n;
}

/** New lost report → compare with waiting found items in its country. */
export async function matchLostReport(lost) {
  const box = boundingBox(lost.lat, lost.lng, 60_000);
  const { rows } = await query(
    `SELECT * FROM found_items
     WHERE country_code = $1 AND category = $2 AND status IN ('waiting','under_review') AND finder_id <> $3
       AND ((lat BETWEEN $4 AND $5 AND lng BETWEEN $6 AND $7) OR private_id_hash = $8)`,
    [lost.country_code, lost.category, lost.owner_id, box.minLat, box.maxLat, box.minLng, box.maxLng, lost.private_details_hash ?? '-'],
  );
  let n = 0;
  for (const found of rows) {
    const r = scorePair(found, lost);
    if (r && r.score >= MIN_SCORE && (await saveMatch(found, lost, r))) n += 1;
  }
  return n;
}

/** Saved alerts: "notify me if a black wallet is found within 3 km of X". */
export async function checkAlerts(found) {
  const { rows } = await query(
    `SELECT * FROM saved_alerts
     WHERE country_code = $1 AND active_until > now() AND user_id <> $2 AND (category IS NULL OR category = $3)`,
    [found.country_code, found.finder_id, found.category],
  );
  for (const a of rows) {
    if (haversine(a.lat, a.lng, found.approx_lat, found.approx_lng) > a.radius_m + 500) continue;
    if (a.keywords) {
      const want = tokens(a.keywords);
      const have = tokens(found.description);
      if ([...want].some((w) => !have.has(w))) continue;
    }
    await notify({ userId: a.user_id, countryCode: a.country_code, type: 'alert_match', data: { category: found.category, itemId: found.id, alertId: a.id }, url: `/items/${found.id}` });
  }
}
