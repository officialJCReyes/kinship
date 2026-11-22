// SPDX-License-Identifier: AGPL-3.0-or-later
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/errors.js';
import { processImage, sniffMime } from '../src/media/image.js';
import { flatImage, makeImage } from './helpers/images.js';

const refused = async (input: Buffer, status: number, code: string) => {
  const error = await processImage(input).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, code).toBeInstanceOf(ApiError);
  expect((error as ApiError).status).toBe(status);
  expect((error as ApiError).code).toBe(code);
};

describe('sniffMime', () => {
  it('knows the three types by their first bytes, and nothing else', async () => {
    expect(sniffMime(await makeImage({ format: 'jpeg' }))).toBe('image/jpeg');
    expect(sniffMime(await makeImage({ format: 'png' }))).toBe('image/png');
    expect(sniffMime(await makeImage({ format: 'webp' }))).toBe('image/webp');
    for (const other of [
      Buffer.from('GIF89a......'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('%PDF-1.7 ....'),
      Buffer.from('....ftypheic....'),
      Buffer.from('RIFF....WAVEfmt '),
      Buffer.from('<html><script>alert(1)</script>'),
      Buffer.alloc(0),
    ])
      expect(sniffMime(other)).toBeNull();
  });
});

describe('processImage', () => {
  it('re-encodes each type as itself: full size and a 192 px square avatar', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const out = await processImage(await makeImage({ format, width: 640, height: 480 }));
      expect(out.mime).toBe(`image/${format}`);
      expect([out.width, out.height]).toEqual([640, 480]);
      const avatar = await sharp(out.avatar).metadata();
      expect([avatar.width, avatar.height, avatar.format]).toEqual([192, 192, format]);
      expect((await sharp(out.full).metadata()).format).toBe(format);
    }
  });

  it('shrinks a big picture to 2400 px on the long side and never enlarges a small one', async () => {
    const big = await processImage(await makeImage({ width: 3200, height: 1800 }));
    expect([big.width, big.height]).toEqual([2400, 1350]);
    const small = await processImage(await makeImage({ width: 100, height: 60 }));
    expect([small.width, small.height]).toEqual([100, 60]);
  });

  it('turns a picture upright by its EXIF orientation, and the size says so', async () => {
    const out = await processImage(await makeImage({ width: 400, height: 200, orientation: 6 }));
    expect([out.width, out.height]).toEqual([200, 400]);
  });

  it('keeps NO metadata: no GPS, no camera text, no EXIF, no orientation tag', async () => {
    for (const format of ['jpeg', 'webp'] as const) {
      const input = await makeImage({ format, gps: true, taken: '2019:07:04 10:11:12', orientation: 3 });
      expect((await sharp(input).metadata()).exif).toBeDefined(); // the input had it
      const out = await processImage(input);
      for (const bytes of [out.full, out.avatar]) {
        const meta = await sharp(bytes).metadata();
        expect(meta.exif, format).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(meta.iptc).toBeUndefined();
        expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
        // The camera text and the GPS reference letters are nowhere in the bytes.
        expect(bytes.includes(Buffer.from('Hale test'))).toBe(false);
        expect(bytes.includes(Buffer.from('GPS'))).toBe(false);
      }
    }
  });

  it('suggests the date taken from the original EXIF (the one thing it keeps), before the metadata is dropped', async () => {
    const out = await processImage(await makeImage({ taken: '2019:07:04 10:11:12', gps: true }));
    expect(out.suggestedTakenOn).toBe('2019-07-04');
    expect((await processImage(await makeImage())).suggestedTakenOn).toBeNull();
    expect((await processImage(await makeImage({ created: '2020:01:02 03:04:05' }))).suggestedTakenOn).toBe(
      '2020-01-02',
    );
  });

  it('refuses what is not a JPEG, PNG or WebP, whatever it is called (415)', async () => {
    await refused(Buffer.from('GIF89a' + 'x'.repeat(40)), 415, 'unsupported_image');
    await refused(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      415,
      'unsupported_image',
    );
    await refused(Buffer.from('%PDF-1.7\n' + 'x'.repeat(40)), 415, 'unsupported_image');
    await refused(
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]),
      415,
      'unsupported_image',
    );
    await refused(Buffer.alloc(0), 415, 'unsupported_image');
  });

  it('refuses a damaged picture (400) and never a half picture', async () => {
    const jpeg = await makeImage({ width: 800, height: 600 });
    await refused(jpeg.subarray(0, 300), 400, 'invalid_image');
    await refused(Buffer.concat([jpeg.subarray(0, 20), Buffer.alloc(200, 7)]), 400, 'invalid_image');
  });

  it('refuses more than 10 MB (413) before decoding anything', async () => {
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)]);
    await refused(huge, 413, 'image_too_large');
  });

  it('refuses more than 50 megapixels (413) and accepts just under', async () => {
    await refused(await flatImage(7200, 7000), 413, 'image_too_many_pixels'); // 50.4 MP, a tiny file
    const ok = await processImage(await flatImage(7000, 7000)); // 49 MP
    expect([ok.width, ok.height]).toEqual([2400, 2400]);
  }, 60_000);

  it('does one picture at a time, and tells the ones that cannot wait to try again', async () => {
    const input = await makeImage({ width: 2000, height: 1500 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => processImage(input)));
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.length).toBeGreaterThan(0);
    for (const f of failed) expect(((f as PromiseRejectedResult).reason as ApiError).status).toBe(429);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(4);
  }, 60_000);
});
