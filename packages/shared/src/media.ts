// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos (ADR 0033, ADR 0034): what the API sends and accepts, and the limits both sides know.

import type { RelPerson } from './relationship.js';

/** What an upload may be. Decided by the file's first bytes, never by its name or the content type the browser sends. */
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMime = (typeof PHOTO_MIME_TYPES)[number];

/** The limits. The file input says the same in its `accept`; the API enforces all of them. */
export const PHOTO_LIMITS = {
  /** Bytes of the picture itself. */
  maxBytes: 10 * 1024 * 1024,
  /** Width times height. A bigger picture is refused before it is decoded. */
  maxPixels: 50_000_000,
  /** The long side of the stored full-size variant. */
  fullPx: 2400,
  /** The side of the square avatar variant. */
  avatarPx: 192,
} as const;

/** One photo, as the API shows it. */
export interface MediaInfo {
  id: string;
  mime: PhotoMime;
  /** Pixels of the stored full-size variant. */
  width: number;
  height: number;
  /** The date taken as typed: YYYY, YYYY-MM or YYYY-MM-DD, or null. */
  takenOn: string | null;
  createdAt: string;
  /** The account that uploaded it; null after that account was deleted. */
  uploadedBy: string | null;
  /** The people it shows. */
  people: string[];
  /** What the signed-in account may do with it. */
  permissions: { edit: boolean; delete: boolean };
}

/** One photo in the family-wide list: the photo, and the people it shows (names, for display). */
export interface MediaListItem extends MediaInfo {
  shows: RelPerson[];
}

/** GET /api/media: newest first, MEDIA_PAGE_SIZE at a time. `person` limits it to the photos that show one person. */
export interface MediaPage {
  items: MediaListItem[];
  nextCursor: string | null;
}

/** Photos per page of GET /api/media. */
export const MEDIA_PAGE_SIZE = 60;

/** POST /api/people/:id/photos: the photo, and the date its EXIF says it was taken (a suggestion, not saved). */
export interface PhotoUploadResponse {
  photo: MediaInfo;
  suggestedTakenOn: string | null;
}

/** GET /api/people/:id/photos */
export interface PersonPhotos {
  items: MediaInfo[];
}

/** PATCH /api/media/:id */
export interface MediaPatch {
  takenOn: string | null;
}

/** Error codes for photos. Every one has an `error.<code>` message. */
export const MEDIA_ERROR_CODES = [
  /** No key, no folder, or a key that does not match: photos cannot be stored or shown right now (503). */
  'files_unavailable',
  'photo_not_found',
  /** The file is not a JPEG, PNG or WebP (415). */
  'unsupported_image',
  /** The file is damaged or cannot be read as a picture (400). */
  'invalid_image',
  /** More than 10 MB (413). */
  'image_too_large',
  /** More than 50 megapixels (413). */
  'image_too_many_pixels',
  /** The photo is not linked to this person, so it cannot be their profile photo (409). */
  'photo_not_linked',
] as const;
export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export const MEDIA_ROUTES = [
  { method: 'GET', path: '/api/media', access: 'signed-in' },
  { method: 'GET', path: '/api/people/:id/photos', access: 'signed-in' },
  { method: 'POST', path: '/api/people/:id/photos', access: 'edit-person' },
  { method: 'DELETE', path: '/api/people/:id/photos/:mediaId', access: 'edit-person' },
  { method: 'PATCH', path: '/api/media/:id', access: 'uploader-or-edit-person' },
  { method: 'DELETE', path: '/api/media/:id', access: 'admin-or-uploader' },
  /** :variant is `avatar` (192 px square) or `full` (at most 2400 px). One route, so every picture shares one rate-limit bucket. */
  { method: 'GET', path: '/api/media/:id/:variant', access: 'signed-in' },
] as const;
