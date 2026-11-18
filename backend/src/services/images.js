// Image pipeline for uploads:
//   1. validate it's a real image, auto-rotate, re-encode as JPEG — this drops
//      EXIF/GPS and all other metadata
//   2. optional AI moderation (Admin → Settings → moderation_provider = openai),
//      using OpenAI's free omni-moderation model; unclear results go to the
//      admin photo queue
//   3. store the full image (max 1600 px) + a 480 px thumbnail under
//      {country}/{yyyy-mm}/{uuid}
// Photos are NOT blurred: found items are shown clearly so owners can
// recognise them. (IDs, cards, documents and cash are kept private instead.)
import sharp from 'sharp';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { settings } from './settings.js';
import { newKeyBase, putObject } from './storage.js';

const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);

/** 'approved' | 'rejected' | 'pending' */
async function moderate(jpeg) {
  const s = await settings();
  if (s.moderation_provider !== 'openai' || !s.openai_api_key) return 'approved';
  try {
    const small = await sharp(jpeg).resize({ width: 768, height: 768, fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
    const res = await fetch(`${s.openai_base_url}/moderations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.openai_api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${small.toString('base64')}` } }],
      }),
      signal: AbortSignal.timeout(Math.min(s.ai_timeout_ms, 20000)),
    });
    if (!res.ok) throw new Error(`moderation ${res.status}`);
    const r = (await res.json()).results?.[0];
    return r?.flagged ? 'rejected' : 'approved';
  } catch (err) {
    logger.warn({ err: err.message }, 'image moderation unavailable — queued for manual review');
    return 'pending';
  }
}

/**
 * Process and store one uploaded image.
 * @returns {{ key, thumbKey, width, height, moderation }}
 */
export async function storeImage(buffer, countryCode, { moderateImage = true } = {}) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw badRequest('IMAGE_INVALID', 'That file is not a supported image.');
  }
  if (!ALLOWED.has(meta.format)) throw badRequest('IMAGE_INVALID', 'That file is not a supported image.');
  if ((meta.width ?? 0) * (meta.height ?? 0) > 60_000_000) throw badRequest('IMAGE_INVALID', 'That image is too large.');

  const full = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  const moderation = moderateImage ? await moderate(full) : 'approved';
  const thumb = await sharp(full).resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
  const { width, height } = await sharp(full).metadata();

  const base = newKeyBase(countryCode);
  const key = `${base}.jpg`;
  const thumbKey = `${base}_thumb.jpg`;
  await putObject(key, full);
  await putObject(thumbKey, thumb);
  return { key, thumbKey, width, height, moderation };
}
