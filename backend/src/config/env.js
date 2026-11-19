// Centralised, validated configuration. The process refuses to start with a
// bad config rather than failing later at request time.
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

// Railway: accept DATABASE_URL, or the other names a Postgres service exposes,
// or the individual PG* variables. An unresolved "${{...}}" reference counts as
// missing (it means the referenced service name doesn't exist).
function resolveDatabaseUrl() {
  const usable = (v) => (v && !v.includes('${{') ? v : '');
  const direct = usable(process.env.DATABASE_URL) || usable(process.env.DATABASE_PRIVATE_URL) || usable(process.env.DATABASE_PUBLIC_URL) || usable(process.env.POSTGRES_URL);
  if (direct) return direct;
  const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;
  if (PGHOST && PGUSER && PGDATABASE) {
    const auth = PGPASSWORD ? `${encodeURIComponent(PGUSER)}:${encodeURIComponent(PGPASSWORD)}` : encodeURIComponent(PGUSER);
    return `postgresql://${auth}@${PGHOST}:${PGPORT || 5432}/${PGDATABASE}`;
  }
  return '';
}
process.env.DATABASE_URL = resolveDatabaseUrl();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  // Empty is allowed so the server can still start and explain the problem at /api/health.
  DATABASE_URL: z.string().default(''),
  DATABASE_SSL: bool,

  // Comma-separated list of allowed browser origins (Vercel domain + previews).
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  // Public URL of the web app, used in emails.
  APP_URL: z.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  // 'lax' when the web app proxies /api through Vercel (recommended, first-party
  // cookie); 'none' when the browser calls the Railway domain directly.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  // 32-byte keys, base64-encoded. Generate with: openssl rand -base64 32
  ENCRYPTION_KEY: z.string().min(40, 'ENCRYPTION_KEY must be 32 bytes base64'),
  HASH_PEPPER: z.string().min(32, 'HASH_PEPPER must be at least 32 chars'),


  // Return sign-in codes in API responses when no email key is set (tests/dev only, never in production).
  OTP_DEV_ECHO: bool,

  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_EMAIL: z.string().optional().default(''),

  // Note: API keys and integrations (R2, Resend, Firebase, AI, VAPID…)
  // are read by services/settings.js so the admin panel can change them live.
  SIGNED_URL_TTL_SECONDS: z.coerce.number().default(300),
  // Public base URL of this API (used for locally stored file URLs).
  API_PUBLIC_URL: z.string().default(''),

  // --- Safe handover places (OpenStreetMap Overpass API)
  OVERPASS_URL: z.string().default('https://overpass-api.de/api/interpreter'),

  // Background jobs (claim expiry, reminders, alert expiry). Disable on extra replicas.
  JOBS_ENABLED: z.string().optional().default('true').transform((v) => v !== 'false'),

  // First admin account (created on start if it doesn't exist yet). The
  // password is only used to create the account; change it in the admin panel.
  ADMIN_EMAIL: z.string().optional().default(''),
  ADMIN_INITIAL_PASSWORD: z.string().optional().default(''),

  TRUST_PROXY: z.coerce.number().default(1),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const DATABASE_MISSING_HELP =
  'DATABASE_URL is empty. On Railway: open this service → Variables → New Variable → name DATABASE_URL → Add Reference → pick your Postgres service → DATABASE_URL. Then redeploy.';

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
