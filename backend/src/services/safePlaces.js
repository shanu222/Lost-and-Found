// Suggested safe public handover places from OpenStreetMap (Overpass API):
// police stations, banks, malls and transit stations near a point, restricted
// to the user's country, cached for 7 days.
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { ApiError } from '../lib/errors.js';
import { haversine } from '../lib/geo.js';

const TYPES = {
  police: '["amenity"="police"]',
  bank: '["amenity"="bank"]',
  mall: '["shop"="mall"]',
  station: '["public_transport"="station"]',
};

let fetchImpl = (...a) => fetch(...a);
export const setOverpassFetch = (fn) => {
  fetchImpl = fn;
};

export async function findSafePlaces({ lat, lng, countryCode, types, radiusM = 3000 }) {
  const wanted = types.filter((t) => TYPES[t]);
  const rl = lat.toFixed(3);
  const rg = lng.toFixed(3);
  const key = crypto.createHash('sha1').update(`overpass|${countryCode}|${rl}|${rg}|${radiusM}|${wanted.join(',')}`).digest('hex');
  const cached = await query('SELECT response FROM geocode_cache WHERE cache_key = $1 AND expires_at > now()', [key]);
  let elements;
  if (cached.rows[0]) {
    elements = cached.rows[0].response;
  } else {
    const parts = wanted.map((t) => `nwr${TYPES[t]}(area.country)(around:${radiusM},${rl},${rg});`).join('');
    const q = `[out:json][timeout:20];area["ISO3166-1"="${countryCode}"][admin_level=2]->.country;(${parts});out center 60;`;
    let res;
    try {
      res = await fetchImpl(env.OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': `FoundBack/1.0 (${env.NOMINATIM_EMAIL || 'contact'})` },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new ApiError(503, 'PLACES_UNAVAILABLE', 'Safe place search is temporarily unavailable.');
    }
    if (!res.ok) throw new ApiError(503, 'PLACES_UNAVAILABLE', 'Safe place search is temporarily unavailable.');
    const json = await res.json();
    elements = (json.elements ?? []).map((e) => ({
      osmId: `${e.type}/${e.id}`,
      name: e.tags?.name || e.tags?.['name:en'] || null,
      lat: e.lat ?? e.center?.lat,
      lng: e.lon ?? e.center?.lon,
      type: e.tags?.amenity === 'police' ? 'police' : e.tags?.amenity === 'bank' ? 'bank' : e.tags?.shop === 'mall' ? 'mall' : 'station',
    })).filter((p) => p.lat != null && p.name);
    await query(
      `INSERT INTO geocode_cache (cache_key, response, expires_at) VALUES ($1,$2, now() + interval '7 days')
       ON CONFLICT (cache_key) DO UPDATE SET response = EXCLUDED.response, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(elements)],
    );
  }
  return elements
    .map((p) => ({ ...p, distanceM: Math.round(haversine(lat, lng, p.lat, p.lng)) }))
    .sort((a, b) => (a.type === 'police' ? -1 : 0) - (b.type === 'police' ? -1 : 0) || a.distanceM - b.distanceM)
    .slice(0, 25);
}
