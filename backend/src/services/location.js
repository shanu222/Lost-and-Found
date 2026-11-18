// Live location: the device's GPS decides which country a user is in.
//
// * The browser sends its live GPS position; the server reverse-geocodes it
//   (OpenStreetMap) to a country. A VPN changes the IP address, not the GPS.
// * We also look up the country of the IP address (CDN header, or ipinfo.io
//   when a token is set). If IP and GPS countries differ, that's a VPN/proxy
//   signal: blocked, flagged or ignored according to `vpn_policy`.
// * Posting, claiming and changing country need a FRESH check
//   (`location_max_age_hours`, default 24 h) from inside the right country.
import { query } from '../db/pool.js';
import { ApiError, badRequest, forbidden } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { countryAt } from './geocode.js';
import { settings } from './settings.js';

const ipCache = new Map();

function isPrivateIp(ip) {
  return !ip || /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.|fc|fd|fe80)/i.test(ip);
}

/** Country of the request's IP address, or null when unknown. */
export async function ipCountry(req) {
  const header = req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('fly-client-country');
  if (header && /^[A-Z]{2}$/i.test(header) && header.toUpperCase() !== 'XX' && header.toUpperCase() !== 'T1') return header.toUpperCase();
  const ip = req.ip?.replace(/^::ffff:/, '');
  if (isPrivateIp(ip)) return null;
  const s = await settings();
  if (!s.ipinfo_token) return null;
  const hit = ipCache.get(ip);
  if (hit && hit.exp > Date.now()) return hit.cc;
  try {
    const res = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${encodeURIComponent(s.ipinfo_token)}`, { signal: AbortSignal.timeout(4000) });
    const j = res.ok ? await res.json() : {};
    const cc = j.country_code ? String(j.country_code).toUpperCase() : null;
    if (ipCache.size > 5000) ipCache.clear();
    ipCache.set(ip, { cc, exp: Date.now() + 864e5 });
    return cc;
  } catch {
    return null;
  }
}

/**
 * Record a live location check for the user. Returns the GPS country.
 * Throws VPN_DETECTED when the policy is "block" and the IP country differs.
 */
export async function recordLocation(req, { lat, lng, accuracy }) {
  const s = await settings();
  if (accuracy != null && accuracy > s.location_max_accuracy_m) {
    throw badRequest('LOCATION_INACCURATE', 'Your location is not precise enough. Turn on GPS / precise location and try again.');
  }
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) throw badRequest('LOCATION_INVALID', 'Location is not valid.');
  const gps = await countryAt(lat, lng);
  if (!gps) throw badRequest('LOCATION_UNKNOWN', 'We could not tell which country you are in. Try again outdoors or with precise location on.');
  const ipc = s.vpn_policy === 'off' ? null : await ipCountry(req);
  const mismatch = Boolean(ipc && ipc !== gps);

  await query(
    `UPDATE users SET location_lat = $2, location_lng = $3, location_accuracy_m = $4, location_country = $5,
       location_verified_at = CASE WHEN $7 AND $8 = 'block' THEN location_verified_at ELSE now() END,
       ip_country = $6, vpn_flagged_at = CASE WHEN $7 THEN now() ELSE vpn_flagged_at END
     WHERE id = $1`,
    [req.user.id, lat, lng, accuracy != null ? Math.round(accuracy) : null, gps, ipc, mismatch, s.vpn_policy],
  );
  if (mismatch) {
    await audit({ actorId: req.user.id, countryCode: gps, action: 'security.vpn_mismatch', meta: { gps, ip: ipc, policy: s.vpn_policy }, ip: req.ip });
    if (s.vpn_policy === 'block') {
      throw forbidden('VPN_DETECTED', 'Your connection appears to come from another country. Turn off any VPN or proxy and try again.');
    }
  }
  return gps;
}

/**
 * Require a fresh live location inside one of `allowed` countries.
 * No-op when the admin turned live location off.
 */
export async function assertLiveLocation(user, allowed) {
  const s = await settings();
  if (!s.require_live_location) return;
  const fresh = user.location_verified_at && Date.now() - new Date(user.location_verified_at).getTime() < s.location_max_age_hours * 3600_000;
  if (!fresh || !user.location_country) {
    throw new ApiError(428, 'LOCATION_REQUIRED', 'Please share your live location to continue.');
  }
  const list = (Array.isArray(allowed) ? allowed : [allowed]).filter(Boolean).map((c) => c.trim());
  if (list.length && !list.includes(user.location_country.trim())) {
    throw forbidden('LOCATION_COUNTRY_MISMATCH', 'Your live location is not in this country.', { locationCountry: user.location_country.trim() });
  }
}
