// Nominatim (OpenStreetMap) geocoding with:
//   * country filter (countrycodes=xx) on every search,
//   * a global rate limit of 1 request/second (Nominatim usage policy),
//   * a two-level cache: in-process LRU + `geocode_cache` table (30 days),
//   * an identifying User-Agent (set NOMINATIM_EMAIL).
// For heavy production traffic, point NOMINATIM_URL at a self-hosted
// instance or a commercial Nominatim provider.
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';

const CACHE_TTL_MS = 30 * 864e5;
const MIN_INTERVAL_MS = 1100;
const memory = new Map(); // key -> { value, expires }
const MEMORY_MAX = 1000;

let fetchImpl = (...args) => fetch(...args);
let throttle = true;
/** Tests replace the HTTP layer with a fake (and skip the 1 req/s wait). */
export const setGeocoderFetch = (fn) => {
  fetchImpl = fn;
  throttle = false;
  memory.clear();
};

// Serialise upstream calls so we never exceed 1 req/s per instance.
let queue = Promise.resolve();
let lastCall = 0;
function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0 && throttle) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

async function cached(key, loader) {
  const hit = memory.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const { rows } = await query('SELECT response FROM geocode_cache WHERE cache_key = $1 AND expires_at > now()', [key]);
  if (rows[0]) {
    remember(key, rows[0].response);
    return rows[0].response;
  }
  const value = await loader();
  remember(key, value);
  await query(
    `INSERT INTO geocode_cache (cache_key, response, expires_at) VALUES ($1,$2,$3)
     ON CONFLICT (cache_key) DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at`,
    [key, JSON.stringify(value), new Date(Date.now() + CACHE_TTL_MS)],
  );
  return value;
}

function remember(key, value) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value);
  memory.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

async function upstream(pathAndQuery) {
  return throttled(async () => {
    let res;
    try {
      res = await fetchImpl(`${env.NOMINATIM_URL}${pathAndQuery}`, {
        headers: {
          'User-Agent': `FoundBack/1.0 (${env.NOMINATIM_EMAIL || 'contact: set NOMINATIM_EMAIL'})`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ApiError(503, 'GEOCODER_UNAVAILABLE', 'Location search is temporarily unavailable.');
    }
    if (!res.ok) throw new ApiError(503, 'GEOCODER_UNAVAILABLE', 'Location search is temporarily unavailable.');
    return res.json();
  });
}

const key = (...parts) => crypto.createHash('sha1').update(parts.join('|')).digest('hex');

/** Search towns/cities inside ONE country. */
export async function searchPlaces(text, countryCode, language = 'en') {
  const cc = countryCode.toLowerCase();
  const q = text.trim().toLowerCase();
  return cached(key('search', cc, language, q), async () => {
    const params = new URLSearchParams({
      q,
      countrycodes: cc,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '8',
      featureType: 'settlement',
      'accept-language': language,
    });
    const results = await upstream(`/search?${params}`);
    return results
      .filter((r) => r.address?.country_code?.toLowerCase() === cc)
      .map((r) => ({
        name: r.name || r.display_name.split(',')[0],
        region: r.address?.state || r.address?.province || r.address?.region || r.address?.county || null,
        lat: Number(r.lat),
        lng: Number(r.lon),
        externalId: `osm:${r.osm_type}:${r.osm_id}`,
        countryCode: countryCode.toUpperCase(),
      }));
  });
}

/** ISO country code at a point, or null (sea / unknown). */
export async function countryAt(lat, lng) {
  // ~1 km rounding keeps the cache effective without losing border accuracy.
  const rl = lat.toFixed(2);
  const rg = lng.toFixed(2);
  const result = await cached(key('reverse', rl, rg), async () => {
    const params = new URLSearchParams({ lat: rl, lon: rg, format: 'jsonv2', zoom: '5', addressdetails: '1' });
    const r = await upstream(`/reverse?${params}`);
    return { countryCode: r?.address?.country_code?.toUpperCase() ?? null };
  });
  return result.countryCode;
}

/**
 * True if (lat, lng) is inside `country`. Uses the optional bounding box as a
 * fast reject, then reverse geocoding for the exact answer.
 */
export async function isPointInCountry(lat, lng, country) {
  if (country.bbox?.length === 4) {
    const [minLat, minLng, maxLat, maxLng] = country.bbox;
    if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return false;
  }
  return (await countryAt(lat, lng)) === country.code.trim();
}
