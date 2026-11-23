// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Photos over HTTP (step 37c): upload, serve, date taken, profile photo, delete, person delete, limits.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEDIA_ROUTES } from '@kinship/shared';
import { sql } from 'kysely';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createObjectStore } from '../src/files/objects.js';
import { deriveFileKeys } from '../src/files/key.js';
import { createFilesService } from '../src/files/state.js';
import { CSRF, cookieHeader, createTestApp, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { AccountKey, Family, Json } from './helpers/family.js';
import { flatImage, makeImage } from './helpers/images.js';

let t: TestApp;
let root: string;
let family: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const cookies = {} as Record<AccountKey, string>;
const key = randomBytes(32);
const keys = deriveFileKeys(key);
const registered: string[] = [];

const filesDir = () => join(root, 'files');
const store = () => createObjectStore(filesDir(), () => keys);
const onDisk = () =>
  store()
    .list()
    .map((o) => o.storageId)
    .sort();

async function upload(who: AccountKey | 'anonymous', personId: string, body: Buffer, type = 'image/jpeg') {
  const response = await t.app.inject({
    method: 'POST',
    url: `/api/people/${personId}/photos`,
    headers: { ...CSRF, 'content-type': type, ...(who === 'anonymous' ? {} : { cookie: cookies[who] }) },
    payload: body,
  });
  return { status: response.statusCode, body: response.body ? (JSON.parse(response.body) as Json) : null };
}

async function get(who: AccountKey, url: string, headers: Record<string, string> = {}) {
  return t.app.inject({ method: 'GET', url, headers: { cookie: cookies[who], ...headers } });
}

/** A stored photo of one person, uploaded by the given account. */
async function photoOf(who: AccountKey, personId: string, options: Parameters<typeof makeImage>[0] = {}) {
  const response = await upload(who, personId, await makeImage(options));
  expect(response.status).toBe(201);
  return response.body as { photo: Json; suggestedTakenOn: string | null };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kinship-media-routes-'));
  const files = createFilesService({ dir: filesDir(), key });
  await files.refresh();
  t = await createTestApp({ files, photoUploadsPer10Minutes: 100 }, (app) => {
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) registered.push(`${method} ${route.url}`);
    });
  });
  family = await buildFamily(t.owner);
  as = await signInAll(t.app, family);
  for (const who of ACCOUNTS) cookies[who] = cookieHeader(await login(t.app, family.account[who].email));
}, 120_000);

afterAll(async () => {
  await t.close();
  rmSync(root, { recursive: true, force: true });
});

describe('the routes', () => {
  it('are exactly the ones the shared package lists', () => {
    const mine = registered
      .filter((r) => /^\w+ \/api\/(media|people\/:id\/photos)/.test(r) && !r.startsWith('HEAD '))
      .sort();
    expect(mine).toEqual(MEDIA_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  });
});

describe('uploading', () => {
  it('a Member adds a photo of their own person: stored encrypted, linked, nothing of the picture kept but its pixels', async () => {
    const before = onDisk().length;
    const { photo, suggestedTakenOn } = await photoOf('member', family.person.marcus, {
      width: 3000,
      height: 2000,
      taken: '2019:07:04 10:11:12',
      gps: true,
    });
    expect(photo).toMatchObject({
      mime: 'image/jpeg',
      width: 2400,
      height: 1600,
      takenOn: null,
      uploadedBy: family.account.member.id,
      people: [family.person.marcus],
      permissions: { edit: true, delete: true },
    });
    // The date is a suggestion for the form; nothing is saved until it is confirmed.
    expect(suggestedTakenOn).toBe('2019-07-04');
    expect(onDisk().length).toBe(before + 2);
    const row = (
      await sql<{ storage_id: string; avatar_storage_id: string; key_id: string }>`
        select storage_id, avatar_storage_id, key_id from media_files where id = ${photo['id'] as string}`.execute(
        t.owner,
      )
    ).rows[0]!;
    expect(row.key_id).toBe(keys.keyId.toString('hex'));
    // On disk it is a sealed file, not a picture; opened with the key it is a re-encoded one with no metadata.
    const raw = store().readRaw(row.storage_id);
    expect(raw.subarray(0, 4).toString('latin1')).toBe('KSFL');
    expect(raw.includes(Buffer.from('JFIF'))).toBe(false);
    const full = await sharp(store().read(row.storage_id)).metadata();
    expect([full.width, full.height, full.format, full.exif]).toEqual([2400, 1600, 'jpeg', undefined]);
    const avatar = await sharp(store().read(row.avatar_storage_id)).metadata();
    expect([avatar.width, avatar.height]).toEqual([192, 192]);
  });

  it('follows who may change that person: admins anyone; a Member only their own person; a User and the signed-out never', async () => {
    const png = await makeImage({ format: 'png', width: 64, height: 64 });
    expect((await upload('superadmin', family.person.sofia, png, 'image/png')).status).toBe(201);
    expect((await upload('familyadmin', family.person.leo, png, 'image/png')).status).toBe(201);
    expect((await upload('member', family.person.sofia, png, 'image/png')).status).toBe(403);
    expect((await upload('unlinked', family.person.marcus, png, 'image/png')).status).toBe(403);
    expect((await upload('user', family.person.marcus, png, 'image/png')).status).toBe(403);
    expect((await upload('anonymous', family.person.marcus, png, 'image/png')).status).toBe(401);
    expect((await upload('superadmin', '3e9f2a3c-0000-4000-8000-000000000000', png, 'image/png')).body).toEqual({
      error: 'person_not_found',
    });
    expect((await upload('superadmin', 'not-a-uuid', png, 'image/png')).status).toBe(404);
  });

  it('refuses what is not a JPEG, PNG or WebP: GIF, SVG, PDF, HEIC, a script, even under a picture content type', async () => {
    const before = onDisk().length;
    for (const body of [
      Buffer.from('GIF89a' + 'x'.repeat(50)),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from('%PDF-1.7\n' + 'x'.repeat(50)),
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]),
      Buffer.from('<html><script>alert(1)</script></html>'),
    ]) {
      const response = await upload('superadmin', family.person.walter, body, 'image/jpeg');
      expect(response.status).toBe(415);
      expect(response.body).toEqual({ error: 'unsupported_image' });
    }
    // A content type that is not a picture's at all is refused before the body is read.
    expect((await upload('superadmin', family.person.walter, Buffer.from('x'), 'image/svg+xml')).status).toBe(415);
    expect((await upload('superadmin', family.person.walter, Buffer.from('{}'), 'application/json')).status).toBe(415);
    expect(onDisk().length).toBe(before);
  });

  it('refuses a damaged picture, one over 10 MB, one over 12 MB, and one over 50 megapixels, and leaves no file behind', async () => {
    const before = onDisk().length;
    const jpeg = await makeImage({ width: 800, height: 600 });
    expect((await upload('superadmin', family.person.walter, jpeg.subarray(0, 300))).body).toEqual({
      error: 'invalid_image',
    });
    const over10 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)]);
    expect(await upload('superadmin', family.person.walter, over10)).toEqual({
      status: 413,
      body: { error: 'image_too_large' },
    });
    const over12 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12 * 1024 * 1024 + 10)]);
    expect(await upload('superadmin', family.person.walter, over12)).toEqual({
      status: 413,
      body: { error: 'payload_too_large' },
    });
    expect(await upload('superadmin', family.person.walter, await flatImage(7200, 7000), 'image/png')).toEqual({
      status: 413,
      body: { error: 'image_too_many_pixels' },
    });
    expect(onDisk().length).toBe(before);
  }, 60_000);

  it('uploading nothing is an unsupported image, not a crash', async () => {
    expect((await upload('superadmin', family.person.walter, Buffer.alloc(0))).status).toBe(415);
  });
});

describe('serving', () => {
  it('sends the decrypted picture with the headers that keep it a picture, and caches it for a year', async () => {
    const { photo } = await photoOf('member', family.person.marcus, { format: 'png', width: 500, height: 300 });
    for (const variant of ['full', 'avatar'] as const) {
      const response = await get('user', `/api/media/${photo['id'] as string}/${variant}`);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(response.headers['cache-control']).toBe('private, max-age=31536000, immutable');
      const meta = await sharp(response.rawPayload).metadata();
      expect([meta.width, meta.height]).toEqual(variant === 'full' ? [500, 300] : [192, 192]);
      expect(response.rawPayload.includes(Buffer.from('KSFL'))).toBe(false);
    }
  });

  it('is for signed-in accounts only, and a Range request just gets the whole picture', async () => {
    const { photo } = await photoOf('superadmin', family.person.walter);
    const url = `/api/media/${photo['id'] as string}/full`;
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    const whole = await get('user', url);
    const ranged = await get('user', url, { range: 'bytes=0-9' });
    expect(ranged.statusCode).toBe(200);
    expect(ranged.headers['accept-ranges']).toBeUndefined();
    expect(ranged.rawPayload.equals(whole.rawPayload)).toBe(true);
  });

  it('says 404 for a photo that is not there and for anything that is not an id', async () => {
    expect((await get('user', '/api/media/3e9f2a3c-0000-4000-8000-000000000000/full')).statusCode).toBe(404);
    expect((await get('user', '/api/media/nope/avatar')).statusCode).toBe(404);
    expect((await get('user', '/api/media/3e9f2a3c-0000-4000-8000-000000000000/other')).statusCode).toBe(404);
  });

  it('a file that is gone from disk is a 404, and a damaged one an error, never a half picture', async () => {
    const { photo } = await photoOf('superadmin', family.person.rosa);
    const id = photo['id'] as string;
    const row = (
      await sql<{ storage_id: string; avatar_storage_id: string }>`
        select storage_id, avatar_storage_id from media_files where id = ${id}`.execute(t.owner)
    ).rows[0]!;
    // Damage the avatar: flip a byte in its encrypted file.
    const path = store().pathOf(row.avatar_storage_id);
    const bytes = readFileSync(path);
    bytes[bytes.length - 3] = (bytes[bytes.length - 3]! + 1) % 256;
    (await import('node:fs')).writeFileSync(path, bytes);
    const damaged = await get('user', `/api/media/${id}/avatar`);
    expect(damaged.statusCode).toBe(500);
    expect(damaged.json()).toEqual({ error: 'internal_error' });
    rmSync(store().pathOf(row.storage_id));
    expect((await get('user', `/api/media/${id}/full`)).statusCode).toBe(404);
  });
});

describe('a person’s photos and the profile photo', () => {
  it('lists the photos of a person, newest first, with what the viewer may do', async () => {
    const { photo: first } = await photoOf('superadmin', family.person.tomas);
    const { photo: second } = await photoOf('superadmin', family.person.tomas);
    const asAdmin = await as('superadmin', 'GET', `/api/people/${family.person.tomas}/photos`);
    expect((asAdmin.body!['items'] as Json[]).map((p) => p['id'])).toEqual([second['id'], first['id']]);
    const asUser = await as('user', 'GET', `/api/people/${family.person.tomas}/photos`);
    expect((asUser.body!['items'] as Json[])[0]!['permissions']).toEqual({ edit: false, delete: false });
    expect((await as('user', 'GET', '/api/people/3e9f2a3c-0000-4000-8000-000000000000/photos')).status).toBe(404);
  });

  it('sets and clears the profile photo with PATCH /api/people/:id {photoMediaId}', async () => {
    const { photo } = await photoOf('member', family.person.marcus);
    const id = photo['id'] as string;
    const set = await as('member', 'PATCH', `/api/people/${family.person.marcus}`, { photoMediaId: id });
    expect(set.status).toBe(200);
    expect((set.body!['person'] as Json)['photoMediaId']).toBe(id);
    expect(
      ((await as('user', 'GET', `/api/people/${family.person.marcus}`)).body!['person'] as Json)['photoMediaId'],
    ).toBe(id);
    const cleared = await as('member', 'PATCH', `/api/people/${family.person.marcus}`, { photoMediaId: null });
    expect((cleared.body!['person'] as Json)['photoMediaId']).toBeNull();
  });

  it('refuses a profile photo that does not show this person, or does not exist', async () => {
    const { photo } = await photoOf('superadmin', family.person.sofia);
    const other = await as('superadmin', 'PATCH', `/api/people/${family.person.leo}`, { photoMediaId: photo['id'] });
    expect(other).toEqual({ status: 409, body: { error: 'photo_not_linked' } });
    const missing = await as('superadmin', 'PATCH', `/api/people/${family.person.leo}`, {
      photoMediaId: '3e9f2a3c-0000-4000-8000-000000000000',
    });
    expect(missing).toEqual({ status: 404, body: { error: 'photo_not_found' } });
    expect((await as('superadmin', 'PATCH', `/api/people/${family.person.leo}`, { photoMediaId: 'x' })).status).toBe(
      404,
    );
    // And only someone who may change the person can set it.
    expect(
      (await as('member', 'PATCH', `/api/people/${family.person.sofia}`, { photoMediaId: photo['id'] })).status,
    ).toBe(403);
  });

  it('removing a photo from a person clears their profile photo when it was that one, and the photo stays', async () => {
    const { photo } = await photoOf('superadmin', family.person.priya);
    const id = photo['id'] as string;
    await as('superadmin', 'PATCH', `/api/people/${family.person.priya}`, { photoMediaId: id });
    expect((await as('member', 'DELETE', `/api/people/${family.person.priya}/photos/${id}`)).status).toBe(403);
    expect((await as('superadmin', 'DELETE', `/api/people/${family.person.priya}/photos/${id}`)).status).toBe(204);
    expect(
      ((await as('user', 'GET', `/api/people/${family.person.priya}`)).body!['person'] as Json)['photoMediaId'],
    ).toBeNull();
    expect((await get('user', `/api/media/${id}/full`)).statusCode).toBe(200);
    expect((await as('superadmin', 'DELETE', `/api/people/${family.person.priya}/photos/${id}`)).status).toBe(404);
  });
});

describe('the date taken', () => {
  it('is saved only when asked, as typed (a year, a month or a day), shown back, and cleared with null', async () => {
    const { photo } = await photoOf('member', family.person.marcus, { taken: '2019:07:04 10:11:12' });
    const url = `/api/media/${photo['id'] as string}`;
    for (const typed of ['2019', '2019-07', '2019-07-04']) {
      const response = await as('member', 'PATCH', url, { takenOn: typed });
      expect(response.status, typed).toBe(200);
      expect(response.body!['takenOn']).toBe(typed);
    }
    expect(
      ((await as('user', 'GET', `/api/people/${family.person.marcus}/photos`)).body!['items'] as Json[]).find(
        (p) => p['id'] === photo['id'],
      )!['takenOn'],
    ).toBe('2019-07-04');
    expect((await as('member', 'PATCH', url, { takenOn: null })).body!['takenOn']).toBeNull();
  });

  it('refuses a date that is not one, and a body that is not the right shape', async () => {
    const { photo } = await photoOf('member', family.person.marcus);
    const url = `/api/media/${photo['id'] as string}`;
    for (const bad of ['2019-13', '2019-02-30', '19', 'yesterday', '0000'])
      expect(await as('member', 'PATCH', url, { takenOn: bad }), bad).toEqual({
        status: 400,
        body: { error: 'invalid_date' },
      });
    expect((await as('member', 'PATCH', url, {})).status).toBe(400);
    expect((await as('member', 'PATCH', url, { takenOn: '2019', width: 1 })).status).toBe(400);
  });

  it('follows who may change it: the uploader or someone who may change a person in it; a User and strangers never', async () => {
    const { photo } = await photoOf('superadmin', family.person.marcus);
    const url = `/api/media/${photo['id'] as string}`;
    // Uploaded by the SuperAdmin, but it shows Marcus, whom the Member may change.
    expect((await as('member', 'PATCH', url, { takenOn: '2001' })).status).toBe(200);
    expect((await as('unlinked', 'PATCH', url, { takenOn: '2002' })).status).toBe(403);
    expect((await as('user', 'PATCH', url, { takenOn: '2002' })).status).toBe(403);
    expect((await as('anonymous', 'PATCH', url, { takenOn: '2002' })).status).toBe(401);
    expect((await as('familyadmin', 'PATCH', url, { takenOn: '2003' })).status).toBe(200);
    expect(
      (await as('superadmin', 'PATCH', '/api/media/3e9f2a3c-0000-4000-8000-000000000000', { takenOn: null })).body,
    ).toEqual({
      error: 'photo_not_found',
    });
  });
});

describe('deleting a photo', () => {
  it('an admin, or the Member who uploaded it, removes the row, both files and the profile photo; nobody else', async () => {
    const mine = (await photoOf('member', family.person.marcus)).photo;
    const rows = async (id: string) =>
      (
        await sql<{ storage_id: string; avatar_storage_id: string }>`
        select storage_id, avatar_storage_id from media_files where id = ${id}`.execute(t.owner)
      ).rows[0];
    const gone = await rows(mine['id'] as string);
    await as('member', 'PATCH', `/api/people/${family.person.marcus}`, { photoMediaId: mine['id'] });
    expect((await as('unlinked', 'DELETE', `/api/media/${mine['id'] as string}`)).status).toBe(403);
    expect((await as('user', 'DELETE', `/api/media/${mine['id'] as string}`)).status).toBe(403);
    expect(existsSync(store().pathOf(gone!.storage_id))).toBe(true);
    expect((await as('member', 'DELETE', `/api/media/${mine['id'] as string}`)).status).toBe(204);
    expect(await rows(mine['id'] as string)).toBeUndefined();
    expect(existsSync(store().pathOf(gone!.storage_id))).toBe(false);
    expect(existsSync(store().pathOf(gone!.avatar_storage_id))).toBe(false);
    expect(
      ((await as('user', 'GET', `/api/people/${family.person.marcus}`)).body!['person'] as Json)['photoMediaId'],
    ).toBeNull();
    expect((await as('member', 'DELETE', `/api/media/${mine['id'] as string}`)).status).toBe(404);

    // A Member cannot delete what an admin uploaded, even of their own person; an admin can.
    const theirs = (await photoOf('superadmin', family.person.marcus)).photo;
    expect((await as('member', 'DELETE', `/api/media/${theirs['id'] as string}`)).status).toBe(403);
    expect((await as('familyadmin', 'DELETE', `/api/media/${theirs['id'] as string}`)).status).toBe(204);
  });
});

describe('deleting a person', () => {
  it('deletes the photos that show only them, files included, and keeps the ones that show someone else too', async () => {
    const victim = family.person.gabriel;
    const sole = (await photoOf('superadmin', victim)).photo;
    const shared = (await photoOf('superadmin', victim)).photo;
    await sql`insert into media_people (media_id, person_id) values (${shared['id'] as string}, ${family.person.sofia})`.execute(
      t.owner,
    );
    const ids = async (mediaId: string) =>
      (
        await sql<{ storage_id: string; avatar_storage_id: string }>`
        select storage_id, avatar_storage_id from media_files where id = ${mediaId}`.execute(t.owner)
      ).rows[0]!;
    const soleFiles = await ids(sole['id'] as string);
    const sharedFiles = await ids(shared['id'] as string);

    const response = await as('superadmin', 'DELETE', `/api/people/${victim}?confirm=true`);
    expect(response.status).toBe(204);

    const left = await sql<{
      id: string;
    }>`select id from media_files where id in (${sole['id'] as string}, ${shared['id'] as string})`.execute(t.owner);
    expect(left.rows.map((r) => r.id)).toEqual([shared['id']]);
    expect(existsSync(store().pathOf(soleFiles.storage_id))).toBe(false);
    expect(existsSync(store().pathOf(soleFiles.avatar_storage_id))).toBe(false);
    expect(existsSync(store().pathOf(sharedFiles.storage_id))).toBe(true);
    expect(existsSync(store().pathOf(sharedFiles.avatar_storage_id))).toBe(true);
    // The kept photo now shows only the other person, and still opens.
    expect((await as('user', 'GET', `/api/people/${family.person.sofia}/photos`)).body!['items']).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: shared['id'], people: [family.person.sofia] })]),
    );
    expect((await get('user', `/api/media/${shared['id'] as string}/full`)).statusCode).toBe(200);
  });

  it('the confirm_required preview says how many photos go with the person (those that show only them)', async () => {
    // Tomas hangs from Beatriz alone: deleting Beatriz needs a confirmation, and the preview counts her photos.
    const person = family.person.beatriz;
    await photoOf('superadmin', person);
    const shared = (await photoOf('superadmin', person)).photo;
    await sql`insert into media_people (media_id, person_id) values (${shared['id'] as string}, ${family.person.tomas})`.execute(
      t.owner,
    );
    const preview = await as('superadmin', 'DELETE', `/api/people/${person}`);
    expect(preview.status).toBe(409);
    expect(preview.body).toMatchObject({ error: 'confirm_required', photos: 1 });
  });

  it('a delete that is refused leaves the photos alone', async () => {
    // Marcus has an account: the delete is refused with 409 and nothing is removed.
    const { photo } = await photoOf('superadmin', family.person.marcus);
    const files = (
      await sql<{ storage_id: string }>`select storage_id from media_files where id = ${photo['id'] as string}`.execute(
        t.owner,
      )
    ).rows[0]!;
    expect((await as('superadmin', 'DELETE', `/api/people/${family.person.marcus}?confirm=true`)).status).toBe(409);
    expect(existsSync(store().pathOf(files.storage_id))).toBe(true);
    expect((await get('user', `/api/media/${photo['id'] as string}/full`)).statusCode).toBe(200);
  });
});
