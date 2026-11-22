// SPDX-License-Identifier: AGPL-3.0-or-later
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { dateOfExifText, exifTakenOn } from '../src/media/exif.js';
import { makeImage } from './helpers/images.js';

const exifOf = async (jpeg: Buffer): Promise<Buffer | undefined> => (await sharp(jpeg).metadata()).exif;

/** A hand-made EXIF block: one IFD0 entry pointing at an Exif IFD that holds the given ASCII tags. */
function tiff(order: 'II' | 'MM', tags: Array<[number, string]>, prefix = true): Buffer {
  const little = order === 'II';
  const w16 = (b: Buffer, at: number, v: number) => (little ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at));
  const w32 = (b: Buffer, at: number, v: number) => (little ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at));
  const exifIfdAt = 8 + 2 + 12 + 4;
  const dataAt = exifIfdAt + 2 + tags.length * 12 + 4;
  const buffer = Buffer.alloc(dataAt + tags.length * 24);
  buffer.write(order, 0, 'latin1');
  w16(buffer, 2, 42);
  w32(buffer, 4, 8);
  w16(buffer, 8, 1);
  w16(buffer, 10, 0x8769);
  w16(buffer, 12, 4);
  w32(buffer, 14, 1);
  w32(buffer, 18, exifIfdAt);
  w16(buffer, exifIfdAt, tags.length);
  tags.forEach(([tag, text], i) => {
    const entry = exifIfdAt + 2 + i * 12;
    const at = dataAt + i * 24;
    w16(buffer, entry, tag);
    w16(buffer, entry + 2, 2);
    w32(buffer, entry + 4, text.length + 1);
    w32(buffer, entry + 8, at);
    buffer.write(`${text}\0`, at, 'latin1');
  });
  return prefix ? Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buffer]) : buffer;
}

describe('dateOfExifText', () => {
  it('keeps only the calendar date', () => {
    expect(dateOfExifText('2019:07:04 10:11:12')).toBe('2019-07-04');
    expect(dateOfExifText('2019:07:04')).toBe('2019-07-04');
  });
  it('refuses zeroed, impossible and unreadable dates', () => {
    for (const bad of [
      '0000:00:00 00:00:00',
      '2019:13:01 00:00:00',
      '2019:02:30 00:00:00',
      '    :  :     ',
      '',
      'last Tuesday',
    ])
      expect(dateOfExifText(bad), bad).toBeNull();
  });
});

describe('exifTakenOn', () => {
  it('reads DateTimeOriginal from a real picture', async () => {
    const jpeg = await makeImage({ taken: '2019:07:04 10:11:12' });
    expect(exifTakenOn(await exifOf(jpeg))).toBe('2019-07-04');
  });

  it('prefers DateTimeOriginal, and falls back to CreateDate', async () => {
    const both = await makeImage({ taken: '2019:07:04 10:11:12', created: '2020:01:02 00:00:00' });
    expect(exifTakenOn(await exifOf(both))).toBe('2019-07-04');
    const only = await makeImage({ created: '2020:01:02 03:04:05' });
    expect(exifTakenOn(await exifOf(only))).toBe('2020-01-02');
  });

  it('gives null for a picture with no date, or no EXIF at all', async () => {
    expect(exifTakenOn(await exifOf(await makeImage()))).toBeNull();
    expect(exifTakenOn(undefined)).toBeNull();
    expect(exifTakenOn(Buffer.alloc(0))).toBeNull();
  });

  it('reads both byte orders, with and without the Exif prefix', () => {
    for (const order of ['II', 'MM'] as const)
      for (const prefix of [true, false])
        expect(exifTakenOn(tiff(order, [[0x9003, '2001:02:03 04:05:06']], prefix)), `${order} ${prefix}`).toBe(
          '2001-02-03',
        );
  });

  it('falls back to CreateDate when DateTimeOriginal is zeroed', () => {
    expect(
      exifTakenOn(
        tiff('II', [
          [0x9003, '0000:00:00 00:00:00'],
          [0x9004, '1999:12:31 23:59:59'],
        ]),
      ),
    ).toBe('1999-12-31');
  });

  it('never throws on damaged or hostile data', () => {
    const good = tiff('II', [[0x9003, '2001:02:03 04:05:06']]);
    // Every truncation, and every single byte flipped to every kind of value: a null, a date, never an exception.
    for (let cut = 0; cut < good.length; cut++) expect(() => exifTakenOn(good.subarray(0, cut))).not.toThrow();
    for (let i = 0; i < good.length; i++)
      for (const v of [0x00, 0x7f, 0xff]) {
        const bad = Buffer.from(good);
        bad[i] = v;
        expect(() => exifTakenOn(bad)).not.toThrow();
      }
    expect(exifTakenOn(Buffer.from('not exif at all, just some text'))).toBeNull();
    // A directory that claims thousands of entries, and an offset far outside the buffer.
    const huge = Buffer.from(good);
    huge.writeUInt16LE(60000, 6 + 8);
    expect(exifTakenOn(huge)).toBeNull();
  });
});
