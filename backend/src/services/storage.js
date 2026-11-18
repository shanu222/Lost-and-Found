// File storage.
// * Production: Cloudflare R2 (S3 API), PRIVATE bucket, objects served only via
//   short-lived presigned URLs (SIGNED_URL_TTL_SECONDS, default 5 minutes).
// * Development/tests (no R2 credentials): files live in the `local_files`
//   table and are served by GET /api/files/<key>?exp&sig (HMAC-signed, same TTL).
import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';

export const usingR2 = Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET);

const s3 = usingR2
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    })
  : null;

/** `{country}/{yyyy-mm}/{uuid}` — callers append the suffix. */
export function newKeyBase(countryCode) {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${countryCode.toLowerCase()}/${ym}/${crypto.randomUUID()}`;
}

export async function putObject(key, body, contentType = 'image/jpeg') {
  if (s3) {
    await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'private, max-age=300' }));
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
  if (s3) await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  else await query('DELETE FROM local_files WHERE key = $1', [key]);
}

const localSig = (key, exp) => crypto.createHmac('sha256', env.HASH_PEPPER).update(`file:${key}:${exp}`).digest('base64url');

/** Short-lived URL for a private object. */
export async function signedUrl(key) {
  if (!key) return null;
  if (s3) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: env.SIGNED_URL_TTL_SECONDS });
  }
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
