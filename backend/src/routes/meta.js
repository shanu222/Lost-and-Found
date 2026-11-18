// /api/meta — countries, languages, country suggestion, city search, counters.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { LANGUAGES, isSupportedLanguage } from '../data/languages.js';
import { notFound } from '../lib/errors.js';
import { countryCode, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { geocodeLimiter } from '../middleware/rateLimit.js';
import { countryConfig, countrySummary, getCountry, listCountries } from '../services/countries.js';
import { searchPlaces } from '../services/geocode.js';
import { signCityRef } from '../services/users.js';

export const metaRouter = Router();

metaRouter.get('/languages', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ default: 'en', languages: LANGUAGES });
});

metaRouter.get('/countries', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ countries: (await listCountries()).map(countrySummary) });
});

metaRouter.get(
  '/countries/:code',
  validate({ params: z.object({ code: countryCode }), query: z.object({ lang: z.string().optional() }) }),
  async (req, res) => {
    const country = await getCountry(req.validParams.code);
    if (!country || !country.enabled) throw notFound('Country not found.');
    const lang = isSupportedLanguage(req.validQuery.lang) ? req.validQuery.lang : 'en';
    res.json({ country: countryConfig(country, lang) });
  },
);

/**
 * Suggest a country for onboarding: CDN geo headers first (Cloudflare,
 * Vercel, Fly), then the region of the browser locale (e.g. "ur-PK").
 * Only a suggestion — the user always confirms.
 */
metaRouter.get('/suggest-country', validate({ query: z.object({ locale: z.string().max(35).optional() }) }), async (req, res) => {
  const fromHeader = req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('fly-client-country');
  const fromLocale = req.validQuery.locale?.match(/[-_]([A-Za-z]{2})\b/)?.[1];
  for (const [source, code] of [['ip', fromHeader], ['locale', fromLocale]]) {
    const country = code && (await getCountry(code));
    if (country?.enabled) return res.json({ countryCode: country.code, source });
  }
  res.json({ countryCode: null, source: null });
});

/**
 * City search, always inside the signed-in user's country (server-side).
 * Local DB first (seeded popular cities + previously picked places), then
 * Nominatim. Nominatim results carry a signed `ref` the client sends back.
 */
metaRouter.get(
  '/cities',
  requireAuth,
  geocodeLimiter,
  validate({ query: z.object({ q: z.string().trim().max(80).default('') }) }),
  async (req, res) => {
    const cc = req.countryCode;
    if (!cc) return res.json({ cities: [] });
    const q = req.validQuery.q;
    const { rows } = await query(
      `SELECT id, name, region, lat, lng FROM cities
       WHERE country_code = $1 AND ($2 = '' OR lower(name) LIKE lower($2) || '%')
       ORDER BY population DESC NULLS LAST, name LIMIT 12`,
      [cc, q.replace(/[\\%_]/g, '\\$&')],
    );
    const cities = rows.map((r) => ({ id: Number(r.id), name: r.name, region: r.region, lat: r.lat, lng: r.lng }));

    if (q.length >= 2 && cities.length < 5) {
      try {
        const places = await searchPlaces(q, cc, req.user.language);
        const known = new Set(cities.map((c) => `${c.name.toLowerCase()}|${(c.region || '').toLowerCase()}`));
        for (const p of places) {
          const k = `${p.name.toLowerCase()}|${(p.region || '').toLowerCase()}`;
          if (known.has(k)) continue;
          known.add(k);
          cities.push({ id: null, name: p.name, region: p.region, lat: p.lat, lng: p.lng, ref: signCityRef(p) });
        }
      } catch (err) {
        // Local results are still useful when the geocoder is down.
        if (!cities.length) throw err;
      }
    }
    res.json({ cities });
  },
);

/** Home-screen counter: items returned in the user's country. */
metaRouter.get('/stats', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE status = 'returned')::int AS returned,
            count(*) FILTER (WHERE status IN ('waiting','under_review'))::int AS waiting
     FROM found_items WHERE country_code = $1`,
    [req.countryCode],
  );
  res.json({ countryCode: req.countryCode, ...rows[0] });
});
