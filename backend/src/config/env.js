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

  GOOGLE_CLIENT_ID: z.string().optional().default(''),

  SMS_PROVIDER: z.enum(['dev', 'twilio']).default('dev'),
  // Return OTP codes in API responses (dev provider only, never in production).
  OTP_DEV_ECHO: bool,
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),

  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('FoundBack <no-reply@foundback.app>'),

  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_EMAIL: z.string().optional().default(''),

  // --- Storage: Cloudflare R2 (S3-compatible). Without R2 credentials files are
  // kept in Postgres (local_files) — fine for development, not for production.
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default(''),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().default(300),
  // Public base URL of this API (used for locally stored file URLs).
  API_PUBLIC_URL: z.string().default(''),

  // --- Pluggable image services
  FACE_BLUR_PROVIDER: z.enum(['none', 'rekognition']).default('none'),
  IMAGE_MODERATION_PROVIDER: z.enum(['none', 'rekognition']).default('none'),
  AWS_REGION: z.string().default('eu-west-1'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),

  // --- Translation of user posts / chat
  TRANSLATE_PROVIDER: z.enum(['none', 'google', 'deepl', 'openai']).default('none'),
  GOOGLE_TRANSLATE_API_KEY: z.string().optional().default(''),
  DEEPL_API_KEY: z.string().optional().default(''),
  DEEPL_API_URL: z.string().default('https://api-free.deepl.com'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // --- Web push (generate with: npx web-push generate-vapid-keys)
  VAPID_PUBLIC_KEY: z.string().optional().default(''),
  VAPID_PRIVATE_KEY: z.string().optional().default(''),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),

  // --- Safe handover places (OpenStreetMap Overpass API)
  OVERPASS_URL: z.string().default('https://overpass-api.de/api/interpreter'),

  // Background jobs (claim expiry, reminders, alert expiry). Disable on extra replicas.
  JOBS_ENABLED: z.string().optional().default('true').transform((v) => v !== 'false'),

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

if (isProd && env.SMS_PROVIDER === 'dev') {
  console.warn('[config] SMS_PROVIDER=dev in production — OTP codes are only logged, not sent.');
}
