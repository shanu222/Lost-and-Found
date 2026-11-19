// Live location: the device's GPS decides which country a user is in.
//
// * The browser sends its live GPS position; the server reverse-geocodes it
//   (OpenStreetMap) to a country. A VPN changes the IP address, not the GPS.
// * We also look up the country of the IP address (CDN header, ipinfo.io
//   when a token is set, otherwise the free country.is service). If IP and GPS countries differ, that's a VPN/proxy
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

/**
 * The visitor's real IP address. The web app reaches the API through Vercel's
 * /api rewrite, and Vercel overwrites X-Forwarded-For with the visitor's IP
 * (its first entry); Railway's edge then appends Vercel's own address. So for
 * requests that came through Vercel the first entry is the visitor; otherwise
 * Express's trusted-proxy logic (TRUST_PROXY) applies.
 */
export function clientIp(req) {
  const xff = req.get('x-forwarded-for');
  if (xff && (req.get('x-vercel-id') || req.get('x-vercel-forwarded-for'))) {
    const first = (req.get('x-vercel-forwarded-for') || xff).split(',')[0].trim();
    if (first) return first.replace(/^::ffff:/, '');
  }
  return req.ip?.replace(/^::ffff:/, '');
}

/** Country of the request's IP address, or null when unknown. */
export async function ipCountry(req) {
  const header = req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('fly-client-country');
  if (header && /^[A-Z]{2}$/i.test(header) && header.toUpperCase() !== 'XX' && header.toUpperCase() !== 'T1') return header.toUpperCase();
  const ip = clientIp(req);
  if (isPrivateIp(ip)) return null;
  const s = await settings();
  const hit = ipCache.get(ip);
  if (hit && hit.exp > Date.now()) return hit.cc;
  // ipinfo.io when a token is set; otherwise country.is (free, no key).
  const lookups = [
    s.ipinfo_token && (async () => {
      const res = await fetch(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${encodeURIComponent(s.ipinfo_token)}`, { signal: AbortSignal.timeout(4000) });
      const j = res.ok ? await res.json() : {};
      return j.country_code;
    }),
    async () => {
      const res = await fetch(`https://api.country.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(4000) });
      const j = res.ok ? await res.json() : {};
      return j.country;
    },
  ].filter(Boolean);
  for (const lookup of lookups) {
    try {
      const raw = await lookup();
      if (raw && /^[A-Z]{2}$/i.test(raw)) {
        const cc = String(raw).toUpperCase();
        if (ipCache.size > 5000) ipCache.clear();
        ipCache.set(ip, { cc, exp: Date.now() + 864e5 });
        return cc;
      }
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/**
 * When the device can't share its location (permission blocked, no GPS), the
 * country of the internet connection decides instead — a VPN still can't fake
 * it, because the chosen country must match the connection. Only when the
 * connection's country is unknown may the user pick their country themselves.
 * Returns { countryCode, method }.
 */
export async function recordFallbackLocation(req, chosen) {
  const ipc = await ipCountry(req);
  let countryCode;
  let method;
  if (ipc) {
    if (chosen && chosen !== ipc) {
      throw forbidden('COUNTRY_NOT_CONNECTION', 'You can only choose the country you are connected from.', { connectionCountry: ipc });
    }
    countryCode = ipc;
    method = 'ip';
  } else {
    if (!chosen) throw badRequest('COUNTRY_REQUIRED', 'Choose your country.');
    countryCode = chosen;
    method = 'manual';
  }
  await query(
    `UPDATE users SET location_lat = NULL, location_lng = NULL, location_accuracy_m = NULL, location_country = $2,
            location_verified_at = now(), location_method = $3, ip_country = $4 WHERE id = $1`,
    [req.user.id, countryCode, method, ipc],
  );
  await audit({ actorId: req.user.id, countryCode, action: `security.location_${method}`, ip: clientIp(req) });
  return { countryCode, method };
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
       location_verified_at = CASE WHEN $7 AND $8 = 'block' THEN location_verified_at ELSE now() END, location_method = 'gps',
       ip_country = $6, vpn_flagged_at = CASE WHEN $7 THEN now() ELSE vpn_flagged_at END
     WHERE id = $1`,
    [req.user.id, lat, lng, accuracy != null ? Math.round(accuracy) : null, gps, ipc, mismatch, s.vpn_policy],
  );
  if (mismatch) {
    await audit({ actorId: req.user.id, countryCode: gps, action: 'security.vpn_mismatch', meta: { gps, ip: ipc, policy: s.vpn_policy }, ip: clientIp(req) });
    if (s.vpn_policy === 'block') {
      throw forbidden('VPN_DETECTED', 'Your location and your internet connection are in different countries.', { locationCountry: gps, connectionCountry: ipc });
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
