// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos in the browser: where a picture is, what the file input accepts, and one clear sentence for each way an upload can fail.
import { PHOTO_LIMITS, PHOTO_MIME_TYPES } from '@kinship/shared';
import type { MessageKey } from '@kinship/shared';
import { ApiError } from '../api.js';
import { t } from '../i18n.js';
import { errorMessage } from './errors.js';

/** The file input's `accept`: exactly the three types the API takes. */
export const PHOTO_ACCEPT = PHOTO_MIME_TYPES.join(',');

/** The URL of a stored picture: the small square one, or the full-size one. Same origin, so the session cookie goes with it. */
export const photoUrl = (mediaId: string, variant: 'avatar' | 'full'): string =>
  `/api/media/${encodeURIComponent(mediaId)}/${variant}`;

/** A problem with a chosen file that can be seen without asking the server, or null. */
export function checkPhotoFile(file: { type: string; size: number }): MessageKey | null {
  if (file.type && !(PHOTO_MIME_TYPES as readonly string[]).includes(file.type)) return 'photo.error.unsupported';
  if (file.size > PHOTO_LIMITS.maxBytes) return 'photo.error.tooBig';
  return null;
}

/** The sentence for a failed upload or photo change. */
export function photoErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return t('photo.error.generic');
  switch (error.code) {
    case 'image_too_large':
    case 'payload_too_large':
      return t('photo.error.tooBig');
    case 'image_too_many_pixels':
      return t('photo.error.tooManyPixels');
    case 'unsupported_image':
      return t('photo.error.unsupported');
    case 'invalid_image':
      return t('photo.error.invalid');
    case 'photo_not_found':
      return t('photo.error.notFound');
    case 'forbidden':
      return t('photo.error.notAllowed');
    case 'files_unavailable': {
      const reason = error.details.reason;
      return t(
        reason === 'key_mismatch'
          ? 'photo.error.keyMismatch'
          : reason === 'files_unavailable'
            ? 'photo.error.folder'
            : 'photo.error.keyMissing',
      );
    }
    default:
      break;
  }
  // nginx refuses a body over 12 MB itself, with a page and no code.
  if (error.status === 413) return t('photo.error.tooBig');
  if (error.status === 415) return t('photo.error.unsupported');
  if (error.status === 429) return t('photo.error.limit', { seconds: error.retryAfterSeconds ?? 60 });
  // Everything else (the api cannot be reached, the server broke) reads as it does elsewhere.
  return error.status === undefined || error.status >= 500 ? errorMessage(error) : t('photo.error.generic');
}
