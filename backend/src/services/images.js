// Image pipeline for uploads:
//   1. decode + auto-rotate, re-encode as JPEG → EXIF/GPS and all metadata are dropped
//   2. optional face blur (pluggable: FACE_BLUR_PROVIDER)
//   3. optional moderation (pluggable: IMAGE_MODERATION_PROVIDER)
//   4. store full image (max 1600 px) + thumbnail (480 px) under {country}/{yyyy-mm}/{uuid}
import sharp from 'sharp';
import { DetectFacesCommand, DetectModerationLabelsCommand, RekognitionClient } from '@aws-sdk/client-rekognition';
import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { newKeyBase, putObject } from './storage.js';

const ALLOWED = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);
const rekognition =
  env.FACE_BLUR_PROVIDER === 'rekognition' || env.IMAGE_MODERATION_PROVIDER === 'rekognition'
    ? new RekognitionClient({
        region: env.AWS_REGION,
        ...(env.AWS_ACCESS_KEY_ID ? { credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } } : {}),
      })
    : null;

/** Bounding boxes (fractions 0..1) of faces. */
async function detectFaces(jpeg) {
  if (env.FACE_BLUR_PROVIDER !== 'rekognition') return [];
  const out = await rekognition.send(new DetectFacesCommand({ Image: { Bytes: jpeg } }));
  return (out.FaceDetails ?? []).map((f) => f.BoundingBox);
}

async function blurRegions(jpeg, boxes) {
  if (!boxes.length) return jpeg;
  const img = sharp(jpeg);
  const { width, height } = await img.metadata();
  const overlays = [];
  for (const b of boxes) {
    // Pad the box a little so hair/edges are covered too.
    const left = Math.max(0, Math.floor((b.Left - b.Width * 0.15) * width));
    const top = Math.max(0, Math.floor((b.Top - b.Height * 0.2) * height));
    const w = Math.min(width - left, Math.ceil(b.Width * 1.3 * width));
    const h = Math.min(height - top, Math.ceil(b.Height * 1.4 * height));
    if (w < 4 || h < 4) continue;
    const patch = await sharp(jpeg).extract({ left, top, width: w, height: h }).blur(Math.max(12, Math.round(w / 6))).toBuffer();
    overlays.push({ input: patch, left, top });
  }
  return sharp(jpeg).composite(overlays).jpeg({ quality: 82 }).toBuffer();
}

/** 'approved' | 'rejected' | 'pending' */
async function moderate(jpeg) {
  if (env.IMAGE_MODERATION_PROVIDER !== 'rekognition') return 'approved';
  try {
    const out = await rekognition.send(new DetectModerationLabelsCommand({ Image: { Bytes: jpeg }, MinConfidence: 80 }));
    return (out.ModerationLabels ?? []).length ? 'rejected' : 'approved';
  } catch (err) {
    logger.warn({ err }, 'image moderation failed — queued for manual review');
    return 'pending';
  }
}

/**
 * Process and store one uploaded image.
 * @returns {{ key, thumbKey, width, height, moderation }}
 */
export async function storeImage(buffer, countryCode, { blurFaces = true } = {}) {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw badRequest('IMAGE_INVALID', 'That file is not a supported image.');
  }
  if (!ALLOWED.has(meta.format)) throw badRequest('IMAGE_INVALID', 'That file is not a supported image.');

  // Re-encoding drops EXIF (incl. GPS), ICC and XMP metadata.
  let full = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  if (blurFaces) {
    try {
      full = await blurRegions(full, await detectFaces(full));
    } catch (err) {
      logger.warn({ err }, 'face blur failed');
    }
  }
  const moderation = await moderate(full);
  const thumb = await sharp(full).resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 76 }).toBuffer();
  const { width, height } = await sharp(full).metadata();

  const base = newKeyBase(countryCode);
  const key = `${base}.jpg`;
  const thumbKey = `${base}_thumb.jpg`;
  await putObject(key, full);
  await putObject(thumbKey, thumb);
  return { key, thumbKey, width, height, moderation };
}
