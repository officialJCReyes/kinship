// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one thing KinShip keeps from a picture's EXIF: the calendar date it was taken (ADR 0034). Everything else, GPS above all,
// is dropped when the picture is re-encoded; this reads the date from the original BEFORE that happens.
//
// Reads the TIFF structure inside the EXIF block with every offset checked against the buffer, and gives up quietly (null) on
// anything unexpected. DateTimeOriginal (0x9003) wins; CreateDate (0x9004, "DateTimeDigitized") is the fallback. The time of day and the
// time zone are not kept, only YYYY-MM-DD, and only when it is a real date.
import { isValidPartialDate } from '../people/dates.js';

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_ORIGINAL = 0x9003;
const TAG_CREATE_DATE = 0x9004;
const ASCII = 2;
/** More entries than any real directory has: a damaged or hostile file stops here. */
const MAX_ENTRIES = 512;

/** "2019:07:04 10:11:12" to "2019-07-04", or null when it is empty, zeroed or not a real date. */
export function dateOfExifText(text: string): string | null {
  const m = /^\s*(\d{4}):(\d{2}):(\d{2})(?:[ T]|$)/.exec(text);
  if (!m) return null;
  const value = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidPartialDate(value) ? value : null;
}

/** The EXIF block as sharp gives it (the TIFF data, usually after "Exif\0\0"). */
export function exifTakenOn(exif: Buffer | undefined): string | null {
  if (!exif || exif.length < 14) return null;
  const start = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const tiff = exif.subarray(start);
  const order = tiff.subarray(0, 2).toString('latin1');
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number): number | null =>
    at >= 0 && at + 2 <= tiff.length ? (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at)) : null;
  const u32 = (at: number): number | null =>
    at >= 0 && at + 4 <= tiff.length ? (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at)) : null;
  if (u16(2) !== 42) return null;

  /** The entries of one directory: tag -> where its value is and how many bytes. */
  const entries = (ifd: number | null): Map<number, { type: number; count: number; at: number }> => {
    const found = new Map<number, { type: number; count: number; at: number }>();
    if (ifd === null) return found;
    const n = u16(ifd);
    if (n === null || n > MAX_ENTRIES) return found;
    for (let i = 0; i < n; i++) {
      const at = ifd + 2 + i * 12;
      const tag = u16(at);
      const type = u16(at + 2);
      const count = u32(at + 4);
      if (tag === null || type === null || count === null) break;
      found.set(tag, { type, count, at: at + 8 });
    }
    return found;
  };
  const text = (entry: { type: number; count: number; at: number } | undefined): string | null => {
    if (!entry || entry.type !== ASCII || entry.count < 10 || entry.count > 64) return null;
    const from = entry.count <= 4 ? entry.at : u32(entry.at);
    if (from === null || from + entry.count > tiff.length) return null;
    return tiff
      .subarray(from, from + entry.count)
      .toString('latin1')
      .replace(/\0.*$/s, '');
  };

  const ifd0 = entries(u32(4));
  const exifPointer = ifd0.get(TAG_EXIF_IFD);
  const exifIfd = entries(exifPointer ? u32(exifPointer.at) : null);
  for (const tag of [TAG_DATE_ORIGINAL, TAG_CREATE_DATE]) {
    const date = dateOfExifText(text(exifIfd.get(tag)) ?? '');
    if (date) return date;
  }
  return null;
}
