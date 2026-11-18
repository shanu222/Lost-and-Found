// Inserts any ISO 3166 country that is missing from `countries` together with
// its suggested languages. Existing rows are never updated, so admin edits
// survive restarts.
import { buildCountryDefaults } from '../data/countries.js';

export async function syncCountries(client) {
  const defaults = buildCountryDefaults();
  const { rows } = await client.query('SELECT code FROM countries');
  const existing = new Set(rows.map((r) => r.code.trim()));
  const missing = defaults.filter((c) => !existing.has(c.code));
  if (!missing.length) return 0;

  await client.query('BEGIN');
  try {
    for (const c of missing) {
      await client.query(
        `INSERT INTO countries (code, name, native_name, flag, dial_codes, currency, distance_unit,
           timezones, default_timezone, emergency_number, authority_name, national_id_name,
           id_mask_pattern, guidance, safe_place_types)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (code) DO NOTHING`,
        [c.code, c.name, c.native_name, c.flag, c.dial_codes, c.currency, c.distance_unit,
          c.timezones, c.default_timezone, c.emergency_number, c.authority_name, c.national_id_name,
          c.id_mask_pattern, c.guidance, c.safe_place_types],
      );
      for (const [i, lang] of c.languages.entries()) {
        await client.query(
          `INSERT INTO country_languages (country_code, language, position) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [c.code, lang, i],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return missing.length;
}
