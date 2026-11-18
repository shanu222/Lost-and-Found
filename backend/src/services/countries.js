// Read access to per-country configuration with a short in-process cache.
// Admin edits (stage 6) call invalidateCountries().
import { query } from '../db/pool.js';
import { GENERIC_GUIDANCE } from '../data/countries.js';

let cache = null;
let cacheAt = 0;
const TTL = 60_000;

async function load() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const { rows } = await query(`
    SELECT c.*, COALESCE(array_agg(cl.language ORDER BY cl.position) FILTER (WHERE cl.language IS NOT NULL), '{}') AS languages
    FROM countries c LEFT JOIN country_languages cl ON cl.country_code = c.code
    GROUP BY c.code ORDER BY c.name`);
  cache = new Map(rows.map((r) => [r.code.trim(), { ...r, code: r.code.trim() }]));
  cacheAt = Date.now();
  return cache;
}

export const invalidateCountries = () => {
  cache = null;
};

export async function getCountry(code) {
  if (!code) return null;
  return (await load()).get(String(code).trim().toUpperCase()) ?? null;
}

export async function listCountries({ includeDisabled = false } = {}) {
  return [...(await load()).values()].filter((c) => includeDisabled || c.enabled);
}

/** Small public summary used by pickers. */
export const countrySummary = (c) => ({
  code: c.code,
  name: c.name,
  nativeName: c.native_name,
  flag: c.flag,
  dialCodes: c.dial_codes,
  languages: c.languages,
});

/** Guidance in the requested language, falling back to English then generic. */
export function guidanceFor(country, language = 'en') {
  const g = country.guidance ?? {};
  return { ...GENERIC_GUIDANCE.en, ...(g.en ?? {}), ...(g[language] ?? {}) };
}

/** Public per-country configuration (no admin-only fields). */
export const countryConfig = (c, language) => ({
  ...countrySummary(c),
  currency: c.currency,
  distanceUnit: c.distance_unit,
  timezones: c.timezones,
  defaultTimezone: c.default_timezone,
  emergencyNumber: c.emergency_number,
  authorityName: c.authority_name,
  nationalIdName: c.national_id_name,
  safePlaceTypes: c.safe_place_types,
  guidance: guidanceFor(c, language),
});
