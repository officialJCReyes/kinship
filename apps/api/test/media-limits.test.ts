// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos when they cannot be used (no key, no folder, wrong key), and the two rate-limit buckets (step 37c).
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createFilesService } from '../src/files/state.js';
import type { FilesService } from '../src/files/state.js';
import { CSRF, cookieHeader, createTestApp, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily } from './helpers/family.js';
import type { Family, Json } from './helpers/family.js';
import { makeImage } from './helpers/images.js';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function rig(options: Parameters<typeof createTestApp>[0], files: FilesService | undefined) {
  const t: TestApp = await createTestApp({ ...options, ...(files ? { files } : {}) });
  cleanups.push(() => t.close());
  const family: Family = await buildFamily(t.owner);
  const cookie = async (who: 'superadmin' | 'member') => cookieHeader(await login(t.app, family.account[who].email));
  const send = async (cookieValue: string, url: string, body?: Buffer, method: 'GET' | 'POST' = 'GET') => {
    const response = await t.app.inject({
      method,
      url,
      headers: { ...CSRF, cookie: cookieValue, ...(body ? { 'content-type': 'image/jpeg' } : {}) },
      ...(body ? { payload: body } : {}),
    });
    return {
      status: response.statusCode,
      body: response.body.startsWith('{') ? (JSON.parse(response.body) as Json) : null,
      headers: response.headers,
    };
  };
  return { t, family, cookie, send };
}

const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-media-limits-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

describe('when photos cannot be used, uploads and pictures answer 503 files_unavailable', () => {
  it('with no key set', async () => {
    const files = createFilesService({ dir: join(folder(), 'files'), key: undefined });
    await files.refresh();
    const { family, cookie, send } = await rig({}, files);
    const admin = await cookie('superadmin');
    const image = await makeImage();
    expect(await send(admin, `/api/people/${family.person.walter}/photos`, image, 'POST')).toMatchObject({
      status: 503,
      body: { error: 'files_unavailable' },
    });
    expect(await send(admin, '/api/media/3e9f2a3c-0000-4000-8000-000000000000/full')).toMatchObject({
      status: 503,
      body: { error: 'files_unavailable' },
    });
    // Everything that does not need a file still works: the list of photos, and the rest of the app.
    expect((await send(admin, `/api/people/${family.person.walter}/photos`)).body).toEqual({ items: [] });
    expect((await send(admin, `/api/people/${family.person.walter}`)).status).toBe(200);
  });

  it('with no files service at all, and with a files folder that cannot be written', async () => {
    const bare = await rig({}, undefined);
    const image = await makeImage();
    expect(
      (
        await bare.send(
          await bare.cookie('superadmin'),
          `/api/people/${bare.family.person.walter}/photos`,
          image,
          'POST',
        )
      ).status,
    ).toBe(503);

    // A FILE where the folder should be: it can never be created.
    const blocked = join(folder(), 'in-the-way');
    writeFileSync(blocked, 'not a folder');
    const files = createFilesService({ dir: join(blocked, 'files'), key: randomBytes(32) });
    await files.refresh();
    const cannot = await rig({}, files);
    expect(
      (
        await cannot.send(
          await cannot.cookie('superadmin'),
          `/api/people/${cannot.family.person.walter}/photos`,
          image,
          'POST',
        )
      ).body,
    ).toEqual({
      error: 'files_unavailable',
    });
  });

  it('with the wrong key: new uploads are refused, and a photo sealed with another key is not served; one with this key still is', async () => {
    const key = randomBytes(32);
    let sample: string[] = [];
    const files = createFilesService(
      { dir: join(folder(), 'files'), key },
      { sampleKeyIds: () => Promise.resolve(sample) },
    );
    await files.refresh();
    const { t, family, cookie, send } = await rig({}, files);
    const admin = await cookie('superadmin');
    const uploaded = await send(admin, `/api/people/${family.person.walter}/photos`, await makeImage(), 'POST');
    expect(uploaded.status).toBe(201);
    const id = (uploaded.body!['photo'] as Json)['id'] as string;

    sample = ['0123456789abcdef']; // some stored photo was sealed with another key
    expect((await send(admin, `/api/people/${family.person.walter}/photos`, await makeImage(), 'POST')).body).toEqual({
      error: 'files_unavailable',
    });
    expect((await send(admin, `/api/media/${id}/full`)).status).toBe(200);
    // A photo that says it was sealed with another key is refused, not decrypted into garbage.
    await sql`update media_files set key_id = '0123456789abcdef' where id = ${id}`.execute(t.owner);
    expect((await send(admin, `/api/media/${id}/full`)).body).toEqual({ error: 'files_unavailable' });
  });
});

describe('the rate limits', () => {
  it('uploads: a few per ten minutes and account, each account on its own', async () => {
    const files = createFilesService({ dir: join(folder(), 'files'), key: randomBytes(32) });
    await files.refresh();
    const { family, cookie, send } = await rig({ photoUploadsPer10Minutes: 2 }, files);
    const admin = await cookie('superadmin');
    const member = await cookie('member');
    const image = await makeImage({ width: 64, height: 64 });
    const url = `/api/people/${family.person.marcus}/photos`;
    expect((await send(admin, url, image, 'POST')).status).toBe(201);
    expect((await send(admin, url, image, 'POST')).status).toBe(201);
    const third = await send(admin, url, image, 'POST');
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ error: 'rate_limited' });
    expect((third.body as Json)['retryAfterSeconds']).toBeGreaterThan(0);
    // Another account has its own allowance, and the first one can still look at pictures and use the app.
    expect((await send(member, url, image, 'POST')).status).toBe(201);
    expect((await send(admin, `/api/people/${family.person.marcus}`)).status).toBe(200);
  });

  it('pictures: one bucket for every photo and avatar, apart from the general limit', async () => {
    const files = createFilesService({ dir: join(folder(), 'files'), key: randomBytes(32) });
    await files.refresh();
    const { family, cookie, send } = await rig({ mediaRequestsPerMinute: 3, apiRequestsPerMinute: 5 }, files);
    const admin = await cookie('superadmin');
    const uploaded = await send(
      admin,
      `/api/people/${family.person.walter}/photos`,
      await makeImage({ width: 64, height: 64 }),
      'POST',
    );
    const id = (uploaded.body!['photo'] as Json)['id'] as string;
    expect((await send(admin, `/api/media/${id}/avatar`)).status).toBe(200);
    expect((await send(admin, `/api/media/${id}/full`)).status).toBe(200);
    expect((await send(admin, `/api/media/${id}/avatar`)).status).toBe(200);
    const over = await send(admin, `/api/media/${id}/full`);
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: 'rate_limited' });
    // Looking at pictures did not use up the general limit (5 a minute here), and that did not use up the pictures' bucket.
    for (let i = 0; i < 4; i++) expect((await send(admin, `/api/people/${family.person.walter}`)).status).toBe(200);
    const other = await cookie('member');
    expect((await send(other, `/api/media/${id}/avatar`)).status).toBe(200);
  });
});
