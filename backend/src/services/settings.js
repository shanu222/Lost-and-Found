// Live application settings.
//
// Every setting has a definition below. Its value comes from (in order):
//   1. the admin panel (app_settings table; secrets encrypted with AES-256-GCM)
//   2. the environment variable with the same name in UPPER_CASE
//   3. the default below
// Public settings are sent to the web app / installed mobile app via
// GET /api/meta/app-config. Secrets are never returned in full by any API.
//
// Core secrets (DATABASE_URL, JWT_ACCESS_SECRET, ENCRYPTION_KEY, HASH_PEPPER)
// deliberately stay environment-only: they protect everything else.
import { query } from '../db/pool.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const B = (group, def, extra = {}) => ({ type: 'boolean', group, default: def, ...extra });
const N = (group, def, min, max, extra = {}) => ({ type: 'number', group, default: def, min, max, ...extra });
const S = (group, def = '', extra = {}) => ({ type: 'string', group, default: def, max: 500, ...extra });
const E = (group, def, options, extra = {}) => ({ type: 'enum', group, default: def, options, ...extra });
const K = (group, extra = {}) => ({ type: 'secret', group, default: '', ...extra });

export const DEFINITIONS = {
  // ---- General (shown in the web app and the installed app)
  maintenance_mode: B('general', false, { public: true }),
  maintenance_message: S('general', 'FoundBack is being updated. Please check back soon.', { public: true }),
  announcement: S('general', '', { public: true }),
  announcement_level: E('general', 'info', ['info', 'warning'], { public: true }),
  support_email: S('general', '', { public: true }),
  registration_open: B('general', true, { public: true }),
  min_app_version: S('general', '1.0.0', { public: true, max: 20 }),

  // ---- Features
  email_signin_enabled: B('features', true, { public: true }),
  google_signin_enabled: B('features', true, { public: true }),
  translation_enabled: B('features', true, { public: true }),
  push_enabled: B('features', true, { public: true }),
  travel_mode_enabled: B('features', true, { public: true }),

  // ---- Location & security
  require_live_location: B('security', true, { public: true }),
  location_max_age_hours: N('security', 24, 1, 168, { public: true }),
  location_max_accuracy_m: N('security', 25000, 50, 100000),
  vpn_policy: E('security', 'block', ['block', 'flag', 'off']),
  admin_2fa_enabled: B('security', true),

  // ---- Limits
  max_posts_per_day: N('limits', 10, 1, 100, { public: true }),
  max_lost_reports_per_day: N('limits', 10, 1, 100),
  max_claims_per_day: N('limits', 3, 1, 50, { public: true }),
  claim_expiry_days: N('limits', 7, 1, 60, { public: true }),
  max_alerts: N('limits', 10, 1, 100),
  travel_days: N('limits', 30, 1, 90, { public: true }),
  country_change_cooldown_days: N('limits', 30, 0, 365, { public: true }),

  // ---- Email (sign-in codes + notifications)
  resend_api_key: K('email'),
  email_from: S('email', 'FoundBack <no-reply@example.com>'),

  // ---- Sign-in
  google_client_id: S('signin', '', { public: true }),

  // ---- AI (translation + moderation)
  translate_provider: E('ai', 'none', ['none', 'ai', 'google', 'deepl']),
  moderation_provider: E('ai', 'none', ['none', 'openai']),
  ai_provider_order: S('ai', 'openai,gemini,openrouter'),
  ai_timeout_ms: N('ai', 45000, 2000, 120000),
  ai_max_retries: N('ai', 2, 0, 5),
  openai_api_key: K('ai'),
  openai_model: S('ai', 'gpt-4.1-mini'),
  openai_fallback_model: S('ai', 'gpt-4.1-mini'),
  openai_base_url: S('ai', 'https://api.openai.com/v1'),
  gemini_api_key: K('ai'),
  gemini_model: S('ai', 'gemini-2.5-flash'),
  gemini_fallback_model: S('ai', 'gemini-2.0-flash'),
  openrouter_api_key: K('ai'),
  openrouter_models: S('ai', ''),
  google_translate_api_key: K('ai'),
  deepl_api_key: K('ai'),
  deepl_api_url: S('ai', 'https://api-free.deepl.com'),

  // ---- Location services
  ipinfo_token: K('location'),

  // ---- Push
  vapid_public_key: S('push', '', { public: true, max: 200 }),
  vapid_private_key: K('push'),
  vapid_subject: S('push', 'mailto:admin@example.com'),

  // ---- Storage (Cloudflare R2)
  r2_account_id: S('storage', ''),
  r2_access_key_id: K('storage'),
  r2_secret_access_key: K('storage'),
  r2_bucket: S('storage', ''),
};

const envValue = (key, def) => {
  const raw = process.env[key.toUpperCase()];
  if (raw === undefined || raw === '') return undefined;
  if (def.type === 'boolean') return raw === 'true' || raw === '1';
  if (def.type === 'number') return Number(raw);
  return raw;
};

let cache = null;
let cacheAt = 0;
const TTL = 15_000;

async function load() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  const values = {};
  const source = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    const e = envValue(key, def);
    values[key] = e ?? def.default;
    source[key] = e !== undefined ? 'env' : 'default';
  }
  try {
    const { rows } = await query('SELECT key, value, secret_enc FROM app_settings');
    for (const r of rows) {
      const def = DEFINITIONS[r.key];
      if (!def) continue;
      if (def.type === 'secret') {
        if (r.secret_enc) {
          values[r.key] = decrypt(r.secret_enc);
          source[r.key] = 'admin';
        }
      } else if (r.value !== null && r.value !== undefined) {
        values[r.key] = r.value;
        source[r.key] = 'admin';
      }
    }
  } catch (err) {
    // Table missing during the very first migration — env/defaults still work.
    logger.debug?.({ err }, 'settings table not ready');
  }
  cache = { values, source };
  cacheAt = Date.now();
  return cache;
}

export const invalidateSettings = () => {
  cache = null;
};

/** All current values (secrets decrypted) — server-side use only. */
export async function settings() {
  return (await load()).values;
}

export async function setting(key) {
  return (await load()).values[key];
}

/** Values for the web app / installed app. */
export async function publicConfig() {
  const { values } = await load();
  const out = {};
  for (const [key, def] of Object.entries(DEFINITIONS)) if (def.public) out[key] = values[key];
  out.translation_available = values.translation_enabled && values.translate_provider !== 'none';
  out.google_signin_available = values.google_signin_enabled && Boolean(values.google_client_id);
  out.email_signin_available = values.email_signin_enabled;
  out.push_available = values.push_enabled && Boolean(values.vapid_public_key && values.vapid_private_key);
  return out;
}

const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');

/** Admin view: every setting, secrets masked, with where the value comes from. */
export async function adminView() {
  const { values, source } = await load();
  return Object.entries(DEFINITIONS).map(([key, def]) => ({
    key,
    group: def.group,
    type: def.type,
    options: def.options,
    min: def.min,
    max: def.max,
    public: Boolean(def.public),
    source: source[key],
    ...(def.type === 'secret' ? { isSet: Boolean(values[key]), masked: mask(values[key]) } : { value: values[key] }),
  }));
}

function coerce(key, def, v) {
  switch (def.type) {
    case 'boolean':
      if (typeof v !== 'boolean') throw badRequest('SETTING_INVALID', `${key} must be true or false.`);
      return v;
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n) || n < def.min || n > def.max) throw badRequest('SETTING_INVALID', `${key} must be between ${def.min} and ${def.max}.`);
      return n;
    }
    case 'enum':
      if (!def.options.includes(v)) throw badRequest('SETTING_INVALID', `${key} must be one of ${def.options.join(', ')}.`);
      return v;
    default: {
      const s = String(v ?? '').trim();
      if (s.length > (def.max ?? 500)) throw badRequest('SETTING_INVALID', `${key} is too long.`);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw badRequest('SETTING_INVALID', `${key} contains invalid characters.`);
      return s;
    }
  }
}

/**
 * Apply changes from the admin panel.
 * `null` resets a setting to its environment/default value.
 * For secrets, an empty string also resets.
 */
export async function updateSettings(changes, actorId, db = { query }) {
  const applied = [];
  for (const [key, raw] of Object.entries(changes)) {
    const def = DEFINITIONS[key];
    if (!def) throw badRequest('SETTING_UNKNOWN', `Unknown setting: ${key}`);
    if (raw === null || (def.type === 'secret' && raw === '')) {
      await db.query('DELETE FROM app_settings WHERE key = $1', [key]);
      applied.push(key);
      continue;
    }
    const v = coerce(key, def, raw);
    if (def.type === 'secret') {
      await db.query(
        `INSERT INTO app_settings (key, value, secret_enc, updated_by, updated_at) VALUES ($1, NULL, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = NULL, secret_enc = EXCLUDED.secret_enc, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, encrypt(v), actorId],
      );
    } else {
      await db.query(
        `INSERT INTO app_settings (key, value, secret_enc, updated_by, updated_at) VALUES ($1, $2, NULL, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, secret_enc = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(v), actorId],
      );
    }
    applied.push(key);
  }
  invalidateSettings();
  return applied;
}
