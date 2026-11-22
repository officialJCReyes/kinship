// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stored files (photos): what Admin shows about the file key and the files folder. Never the key itself.

/**
 * ready: photos can be uploaded and shown.
 * key_missing: no FILE_ENCRYPTION_KEY (or _FILE) is set. KinShip runs; uploads and photos answer 503.
 * files_unavailable: the files folder is not mounted or cannot be written, or it lost its marker while photos exist.
 * key_mismatch: stored photos were encrypted with a different key. New uploads are refused.
 */
export const FILES_STATES = ['ready', 'key_missing', 'files_unavailable', 'key_mismatch'] as const;
export type FilesState = (typeof FILES_STATES)[number];

/** Whether photos can be used, and with which key. */
export interface FilesHealth {
  state: FilesState;
  /** The non-secret id of the configured key (16 hex characters), to compare with another install or your notes. */
  keyId: string | null;
}

/** GET /api/admin/files (SuperAdmin only). */
export interface FilesStatus extends FilesHealth {
  /** How many photos there are, and the bytes their stored files take (full size and avatar). For the backup size estimate. */
  photos: number;
  photoBytes: number;
}

export const FILES_ROUTES = [{ method: 'GET', path: '/api/admin/files', access: 'superadmin' }] as const;
