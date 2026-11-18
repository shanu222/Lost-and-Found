// File storage.
// * Production: Cloudflare R2 (S3 API), PRIVATE bucket, objects served only via
//   short-lived presigned URLs (SIGNED_URL_TTL_SECONDS, default 5 minutes).
//   Credentials come from live settings (Admin → Settings → Storage) or env.
// * Development/tests (no R2 credentials): files live in the `local_files`
//   table and are served by GET /api/files/<key>?exp&sig (HMAC-signed, same TTL).
import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { settings } from './settings.js';

let client = null;
let clientSig = null;

/** S3 client for the current R2 settings, or null when R2 isn't configured. */
async function r2() {
  const s = await settings();
  if (!(s.r2_account_id && s.r2_access_key_id && s.r2_secret_access_key && s.r2_bucket)) return null;
  const sig = `${s.r2_account_id}|${s.r2_access_key_id}|${s.r2_secret_access_key}`;
  if (sig !== clientSig) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${s.r2_account_id}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: s.r2_access_key_id, secretAccessKey: s.r2_secret_access_key },
    });
    clientSig = sig;
  }
  return { s3: client, bucket: s.r2_bucket };
}

export async function usingR2() {
  return Boolean(await r2());
}

/** `{country}/{yyyy-mm}/{uuid}` — callers append the suffix. */
export function newKeyBase(countryCode) {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${countryCode.toLowerCase()}/${ym}/${crypto.randomUUID()}`;
}

export async function putObject(key, body, contentType = 'image/jpeg') {
  const r = await r2();
  if (r) {
    await r.s3.send(new PutObjectCommand({ Bucket: r.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=300' }));
  } else {
    await query(
      `INSERT INTO local_files (key, content_type, data) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type`,
      [key, contentType, body],
    );
  }
}

export async function deleteObject(key) {
  if (!key) return;
  const r = await r2();
  if (r) await r.s3.send(new DeleteObjectCommand({ Bucket: r.bucket, Key: key }));
  else await query('DELETE FROM local_files WHERE key = $1', [key]);
}

const localSig = (key, exp) => crypto.createHmac('sha256', env.HASH_PEPPER).update(`file:${key}:${exp}`).digest('base64url');

/** Short-lived URL for a private object. */
export async function signedUrl(key) {
  if (!key) return null;
  const r = await r2();
  if (r) return getSignedUrl(r.s3, new GetObjectCommand({ Bucket: r.bucket, Key: key }), { expiresIn: env.SIGNED_URL_TTL_SECONDS });
  const exp = Math.floor(Date.now() / 1000) + env.SIGNED_URL_TTL_SECONDS;
  return `${env.API_PUBLIC_URL}/api/files/${key}?exp=${exp}&sig=${localSig(key, exp)}`;
}

/** Used by the local file route. */
export async function readLocal(key, exp, sig) {
  const e = Number(exp);
  if (!e || e < Date.now() / 1000) return null;
  const expected = localSig(key, e);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const { rows } = await query('SELECT content_type, data FROM local_files WHERE key = $1', [key]);
  return rows[0] ?? null;
}
