// Centralised, validated configuration. The process refuses to start with a
// bad config rather than failing later at request time.
import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
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


  // Return OTP codes in API responses (dev SMS provider, never in production).
  OTP_DEV_ECHO: bool,

  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_EMAIL: z.string().optional().default(''),

  // Note: API keys and integrations (R2, Resend, Twilio, Google, AI, VAPID…)
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

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProd && (process.env.SMS_PROVIDER ?? 'dev') === 'dev') {
  console.warn('[config] SMS_PROVIDER=dev in production — OTP codes are only logged, not sent (change it in Admin → Settings).');
}
