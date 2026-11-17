// SPDX-License-Identifier: AGPL-3.0-or-later

/** A media file to carry in the archive, as `files/<name>`. The bytes stay encrypted with the file key. */
export interface MediaFile {
  /** A plain file name (letters, digits, dot, dash, underscore), unique within the archive. */
  name: string;
  /** Where it is on this machine. */
  path: string;
}

/**
 * The media files a backup carries. KinShip 0.2 has no uploads, so there are none; when photos and documents arrive this
 * is the one place that learns about them. The archive format and the restore already have a `files/` slot.
 */
export function listMediaFiles(): Promise<MediaFile[]> {
  return Promise.resolve([]);
}
