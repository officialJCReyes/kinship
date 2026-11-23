// SPDX-License-Identifier: AGPL-3.0-or-later
// Pictures made in test code (nothing real ever goes in this repo): a small PNG, optionally with the EXIF date a camera would write.
import { deflateSync } from 'node:zlib';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, check]);
}

/** A big-endian TIFF block: IFD0 points at an Exif IFD that holds DateTimeOriginal ("2019:07:04 10:11:12"). */
function exifWithDate(date: string): Buffer {
  const text = Buffer.from(`${date}\0`, 'latin1');
  const exifIfd = 8 + 2 + 12 + 4;
  const dataAt = exifIfd + 2 + 12 + 4;
  const b = Buffer.alloc(dataAt + text.length);
  b.write('MM', 0, 'latin1');
  b.writeUInt16BE(42, 2);
  b.writeUInt32BE(8, 4);
  b.writeUInt16BE(1, 8);
  b.writeUInt16BE(0x8769, 10);
  b.writeUInt16BE(4, 12);
  b.writeUInt32BE(1, 14);
  b.writeUInt32BE(exifIfd, 18);
  b.writeUInt16BE(1, exifIfd);
  b.writeUInt16BE(0x9003, exifIfd + 2);
  b.writeUInt16BE(2, exifIfd + 4);
  b.writeUInt32BE(text.length, exifIfd + 6);
  b.writeUInt32BE(dataAt, exifIfd + 10);
  text.copy(b, dataAt);
  return b;
}

/** A 64x48 PNG. `tint` makes two pictures differ; `takenOn` ("2019:07:04 10:11:12") is written as the EXIF date. */
export function makePng(options: { tint?: number; takenOn?: string } = {}): Buffer {
  const width = 64;
  const height = 48;
  const tint = options.tint ?? 0;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * (width * 3 + 1) + 1 + x * 3;
      raw[at] = (x * 4 + tint) % 256;
      raw[at + 1] = (y * 5) % 256;
      raw[at + 2] = (128 + tint * 3) % 256;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    ...(options.takenOn ? [chunk('eXIf', exifWithDate(options.takenOn))] : []),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
