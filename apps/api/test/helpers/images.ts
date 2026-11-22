// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pictures made in test code (no real photo ever goes in this repo): coloured gradients, with the metadata a test needs.
import sharp from 'sharp';

export interface MakeImage {
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp';
  /** EXIF text dates: DateTimeOriginal (IFD2) and DateTimeDigitized, the "CreateDate". */
  taken?: string;
  created?: string;
  /** GPS in the EXIF, to prove it does not survive. */
  gps?: boolean;
  /** EXIF orientation 1 to 8. */
  orientation?: number;
}

export async function makeImage(options: MakeImage = {}): Promise<Buffer> {
  const { width = 320, height = 240, format = 'jpeg' } = options;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    raw[i * 3] = (i % width) % 256;
    raw[i * 3 + 1] = Math.floor(i / width) % 256;
    raw[i * 3 + 2] = (i * 7) % 256;
  }
  let image = sharp(raw, { raw: { width, height, channels: 3 } });
  const exif: Record<string, Record<string, string>> = { IFD0: { Copyright: 'Hale test' } };
  if (options.taken) exif['IFD2'] = { ...exif['IFD2'], DateTimeOriginal: options.taken };
  if (options.created) exif['IFD2'] = { ...exif['IFD2'], DateTimeDigitized: options.created };
  if (options.gps)
    exif['IFD3'] = {
      GPSLatitudeRef: 'N',
      GPSLatitude: '40/1 26/1 46/1',
      GPSLongitudeRef: 'W',
      GPSLongitude: '79/1 58/1 56/1',
    };
  image = image.withExif(exif);
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return format === 'jpeg'
    ? image.jpeg({ quality: 80 }).toBuffer()
    : format === 'png'
      ? image.png().toBuffer()
      : image.webp({ quality: 80 }).toBuffer();
}

/** A picture with this many pixels, as small a file as possible (a flat colour). */
export async function flatImage(width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const base = sharp({ create: { width, height, channels: 3, background: '#3a6ea5' } });
  return format === 'png' ? base.png({ compressionLevel: 9 }).toBuffer() : base.jpeg({ quality: 40 }).toBuffer();
}
