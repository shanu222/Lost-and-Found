// Shared helpers for found items: access rules and serialisation.
// Exact coordinates, private photos and private identifiers are only ever
// returned to the finder; everyone else gets the approximate ~500 m circle.
import { query } from '../db/pool.js';
import { PRIVATE_PHOTO_CATEGORIES } from '../lib/categories.js';
import { notFound } from '../lib/errors.js';
import { haversine } from '../lib/geo.js';
import { signedUrl } from './storage.js';

/** Countries a user may view/claim items in: home + active travel country. */
export function viewableCountries(user) {
  const list = [user.country_code?.trim()].filter(Boolean);
  if (user.travel_country_code && user.travel_until && new Date(user.travel_until) > new Date()) list.push(user.travel_country_code.trim());
  return list;
}

const PUBLIC_STATUS = { waiting: 'waiting', under_review: 'under_review', approved: 'under_review', returned: 'returned', closed: 'closed', removed: 'removed' };

/** Load a found item the user is allowed to see, or 404 (never reveal other countries' items). */
export async function loadVisibleItem(id, user, db = { query }) {
  const { rows } = await db.query('SELECT * FROM found_items WHERE id = $1', [id]);
  const item = rows[0];
  if (!item) throw notFound('Item not found.');
  const mine = item.finder_id === user.id;
  const staff = user.role === 'admin';
  if (!mine && !staff && (!viewableCountries(user).includes(item.country_code.trim()) || item.status === 'removed')) {
    throw notFound('Item not found.');
  }
  return item;
}

async function photosFor(itemIds, { includePrivate }) {
  if (!itemIds.length) return new Map();
  const { rows } = await query(
    `SELECT id, found_item_id, r2_key, thumb_key, is_public, moderation_status, position FROM item_photos
     WHERE found_item_id = ANY($1) ORDER BY position`,
    [itemIds],
  );
  const map = new Map();
  for (const p of rows) {
    const visible = includePrivate.has(p.found_item_id) || (p.is_public && p.moderation_status === 'approved');
    if (!visible) continue;
    const list = map.get(p.found_item_id) ?? [];
    list.push(p);
    map.set(p.found_item_id, list);
  }
  return map;
}

/**
 * Serialise found items for a viewer.
 * @param {object[]} items rows from found_items (optionally with city_name, distance_m, claim_count)
 * @param {object} viewer user row
 * @param {{ full?: boolean }} opts full = all photos (item page) instead of the first thumbnail
 */
export async function serializeItems(items, viewer, { full = false, origin = null } = {}) {
  const mineIds = new Set(items.filter((i) => i.finder_id === viewer.id).map((i) => i.id));
  const photos = await photosFor(items.map((i) => i.id), { includePrivate: mineIds });
  return Promise.all(
    items.map(async (i) => {
      const mine = mineIds.has(i.id);
      const list = photos.get(i.id) ?? [];
      const shown = full ? list : list.slice(0, 1);
      const signed = await Promise.all(
        shown.map(async (p) => ({
          id: p.id,
          thumbUrl: await signedUrl(p.thumb_key),
          url: full ? await signedUrl(p.r2_key) : undefined,
          isPublic: p.is_public,
          moderation: mine ? p.moderation_status : undefined,
        })),
      );
      const distanceM = i.distance_m ?? (origin ? haversine(origin.lat, origin.lng, i.approx_lat, i.approx_lng) : null);
      return {
        id: i.id,
        countryCode: i.country_code.trim(),
        category: i.category,
        description: i.description,
        descriptionLang: i.description_lang,
        area: { lat: i.approx_lat, lng: i.approx_lng, radiusM: i.approx_radius_m, label: i.area_label, city: i.city_name ?? null },
        foundAt: i.found_at,
        status: PUBLIC_STATUS[i.status] ?? i.status,
        currentLocation: i.current_location,
        currentLocationNote: i.current_location_note,
        noReward: i.no_reward,
        illustration: PRIVATE_PHOTO_CATEGORIES.has(i.category) && !mine,
        photos: signed,
        distanceM: distanceM != null ? Math.round(distanceM) : null,
        isMine: mine,
        createdAt: i.created_at,
        ...(mine
          ? {
              exact: { lat: i.lat, lng: i.lng },
              rawStatus: i.status,
              claimCount: i.claim_count ?? undefined,
              pendingClaimCount: i.pending_claim_count ?? undefined,
              hasPrivateIdentifier: Boolean(i.private_id_hash),
            }
          : {}),
      };
    }),
  );
}

/** SQL fragment: haversine distance (metres) from ($lat,$lng) params to approx point. */
export const distanceSql = (latParam, lngParam) =>
  `(6371000 * 2 * asin(sqrt(power(sin(radians(f.approx_lat - ${latParam}) / 2), 2) +
    cos(radians(${latParam})) * cos(radians(f.approx_lat)) * power(sin(radians(f.approx_lng - ${lngParam}) / 2), 2))))`;
