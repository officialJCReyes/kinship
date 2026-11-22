// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The photo pipeline (ADR 0034). A picture goes in; two re-encoded variants and a suggested date taken come out.
//   * The type is decided by the first bytes (JPEG, PNG, WebP), never by the name or the content type.
//   * The picture is decoded once with a pixel limit (50 megapixels) and turned upright by its EXIF orientation.
//   * Both variants are encoded from the decoded pixels, so no metadata survives: no GPS, no camera, no software, no thumbnail.
//     The only thing read from the original's EXIF is the calendar date (exif.ts), before it is dropped.
//   * One picture at a time (a 50 megapixel picture needs about 150 MB while it is decoded).
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { PHOTO_LIMITS } from '@kinship/shared';
import type { PhotoMime } from '@kinship/shared';
import { ApiError } from '../errors.js';
import { exifTakenOn } from './exif.js';

export interface ProcessedImage {
  mime: PhotoMime;
  /** The full-size variant (at most 2400 px on the long side), and its pixel size. */
  full: Buffer;
  width: number;
  height: number;
  /** The 192 px square avatar. */
  avatar: Buffer;
  /** From EXIF DateTimeOriginal, else CreateDate: YYYY-MM-DD, or null. */
  suggestedTakenOn: string | null;
}

/** The type from the first bytes, or null. */
export function sniffMime(head: Buffer): PhotoMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

sharp.cache(false);
sharp.concurrency(1);

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;
/** More than this many uploads waiting for their turn are told to try again soon. */
export const MAX_WAITING = 4;

/** Runs `job` after the ones before it. Refuses (429) when too many are already waiting. */
function oneAtATime<T>(job: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) return Promise.reject(new ApiError(429, 'rate_limited', { retryAfterSeconds: 5 }));
  waiting++;
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    waiting--;
  });
}

const encode = (pipeline: Sharp, mime: PhotoMime): Sharp =>
  mime === 'image/jpeg'
    ? pipeline.jpeg({ quality: 85, progressive: true })
    : mime === 'image/png'
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.webp({ quality: 85 });

async function process(input: Buffer): Promise<ProcessedImage> {
  const mime = sniffMime(input);
  if (!mime) throw new ApiError(415, 'unsupported_image');
  if (input.length > PHOTO_LIMITS.maxBytes) throw new ApiError(413, 'image_too_large');
  try {
    const source = sharp(input, { limitInputPixels: PHOTO_LIMITS.maxPixels, failOn: 'error' });
    const meta = await source.metadata();
    // The date comes from the original, before anything is dropped.
    const suggestedTakenOn = exifTakenOn(meta.exif);
    const upright = source.rotate();
    const [full, avatar] = await Promise.all([
      encode(
        upright.clone().resize({
          width: PHOTO_LIMITS.fullPx,
          height: PHOTO_LIMITS.fullPx,
          fit: 'inside',
          withoutEnlargement: true,
        }),
        mime,
      ).toBuffer({ resolveWithObject: true }),
      encode(
        upright.clone().resize(PHOTO_LIMITS.avatarPx, PHOTO_LIMITS.avatarPx, { fit: 'cover', position: 'attention' }),
        mime,
      ).toBuffer(),
    ]);
    return {
      mime,
      full: full.data,
      width: full.info.width,
      height: full.info.height,
      avatar,
      suggestedTakenOn,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw new ApiError(413, 'image_too_many_pixels');
    throw new ApiError(400, 'invalid_image');
  }
}

export function processImage(input: Buffer): Promise<ProcessedImage> {
  return oneAtATime(() => process(input));
}
