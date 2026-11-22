// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKUP_LOCK_KEY } from '../src/backup/archive.js';
import { createAppDb } from '../src/db.js';
import { FileCryptoError } from '../src/files/crypto.js';
import { deriveFileKeys } from '../src/files/key.js';
import { createObjectStore, newStorageId } from '../src/files/objects.js';
import { createFilesService, MARKER } from '../src/files/state.js';
import {
  deleteMedia,
  deleteMediaOnlyOf,
  getMedia,
  insertMedia,
  linkMedia,
  listPersonMedia,
  mediaPeople,
  mediaRowsExist,
  setProfilePhoto,
  setTakenOn,
  storedKeyIds,
  unlinkMedia,
  usedStorageIds,
} from '../src/media/store.js';
import { HOLD_FILE, HOUR_MS, holdUntil, sweepOrphans } from '../src/media/sweeper.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { buildFamily } from './helpers/family.js';
import type { Family } from './helpers/family.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';

const keys = deriveFileKeys(randomBytes(32));
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kinship-media-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('the object store', () => {
  const dir = () => {
    const d = mkdtempSync(join(root, 'o-'));
    for (const sub of ['objects', 'tmp', 'staging']) mkdirSync(join(d, sub));
    return d;
  };

  it('stores a file encrypted under objects/<2 hex>/<32 hex> and reads it back', () => {
    const d = dir();
    const store = createObjectStore(d, () => keys);
    const plain = Buffer.from('not really a picture, but pretend');
    const { storageId, bytes } = store.put(plain);
    expect(storageId).toMatch(/^[0-9a-f]{32}$/);
    const path = join(d, 'objects', storageId.slice(0, 2), storageId);
    expect(statSync(path).size).toBe(bytes);
    expect(store.readRaw(storageId).includes(plain)).toBe(false);
    expect(store.read(storageId).equals(plain)).toBe(true);
    expect(store.exists(storageId)).toBe(true);
    // Nothing is left in tmp/.
    expect(readdirSync(join(d, 'tmp'))).toEqual([]);
    expect(store.list().map((o) => o.storageId)).toEqual([storageId]);
    expect(store.remove(storageId)).toBe(true);
    expect(store.remove(storageId)).toBe(false);
    expect(store.exists(storageId)).toBe(false);
  });

  it('refuses a name that is not 32 hex characters, so nothing can leave objects/', () => {
    const store = createObjectStore(dir(), () => keys);
    for (const bad of ['../../etc/passwd', 'abc', `${'a'.repeat(31)}/`, 'A'.repeat(32), `${'a'.repeat(32)}.jpg`, '']) {
      expect(() => store.read(bad), bad).toThrow('not a storage id');
      expect(() => store.remove(bad), bad).toThrow('not a storage id');
      expect(() => store.put(Buffer.from('x'), bad), bad).toThrow('not a storage id');
    }
  });

  it('a different key cannot read it, and a changed byte fails', () => {
    const d = dir();
    const store = createObjectStore(d, () => keys);
    const { storageId } = store.put(Buffer.from('secret'));
    const other = createObjectStore(d, () => deriveFileKeys(randomBytes(32)));
    expect(() => other.read(storageId)).toThrow(FileCryptoError);
    const path = store.pathOf(storageId);
    const raw = store.readRaw(storageId);
    raw[raw.length - 20] = (raw[raw.length - 20] ?? 0) ^ 1;
    writeFileSync(path, raw);
    expect(() => store.read(storageId)).toThrow(FileCryptoError);
  });

  it('without a key it neither writes nor reads', () => {
    const store = createObjectStore(dir(), () => null);
    expect(() => store.put(Buffer.from('x'))).toThrow(/no file encryption key/);
  });

  it('a failed write leaves nothing under objects/, and the file only appears when whole', () => {
    const d = dir();
    const store = createObjectStore(d, () => keys);
    const id = newStorageId();
    store.put(Buffer.from('one'), id);
    // The same name again must not overwrite silently half-way: tmp/<id>.part is opened exclusively.
    writeFileSync(join(d, 'tmp', `${id}.part`), 'leftover');
    expect(() => store.put(Buffer.from('two'), id)).toThrow();
    expect(store.read(id).toString()).toBe('one');
  });

  it('clears old leftovers in tmp/ and keeps fresh ones', () => {
    const d = dir();
    const store = createObjectStore(d, () => keys);
    writeFileSync(join(d, 'tmp', 'old.part'), 'x');
    writeFileSync(join(d, 'tmp', 'new.part'), 'x');
    const old = new Date(Date.now() - 2 * HOUR_MS);
    utimesSync(join(d, 'tmp', 'old.part'), old, old);
    expect(store.clearTmp(HOUR_MS)).toBe(1);
    expect(readdirSync(join(d, 'tmp'))).toEqual(['new.part']);
  });
});

describe('the media rows, the start-up questions and the sweeper', () => {
  let test: TestDatabase;
  let family: Family;
  let app: ReturnType<typeof createAppDb>;
  const filesDir = () => join(root, 'sweeper');
  type Trx = Parameters<Parameters<ReturnType<typeof app.transaction>['execute']>[0]>[0];
  const as = <T>(userId: string, statement: (trx: Trx) => Promise<T>): Promise<T> =>
    app.transaction().execute(async (trx) => {
      await sql`select set_config('kinship.user_id', ${userId}, true)`.execute(trx);
      return statement(trx);
    });

  beforeAll(async () => {
    test = await createTestDatabase();
    await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
    await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
    family = await buildFamily(test.owner);
    app = test.track(createAppDb(test.config));
    mkdirSync(filesDir(), { recursive: true });
  }, 60_000);
  afterAll(() => test.cleanup());

  const sample = (uploadedBy: string, storageId = newStorageId(), avatarStorageId = newStorageId()) => ({
    storageId,
    avatarStorageId,
    mime: 'image/jpeg' as const,
    size: 2000,
    avatarSize: 300,
    width: 640,
    height: 480,
    takenOn: '2001-05',
    keyId: keys.keyId.toString('hex'),
    uploadedBy,
  });

  it('answers the start-up questions with no photos', async () => {
    expect(await mediaRowsExist(app)).toBe(false);
    expect(await storedKeyIds(app)).toEqual([]);
    expect((await usedStorageIds(app)).size).toBe(0);
  });

  it('inserts, links, lists, dates, sets the profile photo and unlinks, as a signed-in account', async () => {
    const admin = family.account.superadmin.id;
    const media = await as(admin, async (trx) => {
      const row = await insertMedia(trx, sample(admin));
      await linkMedia(trx, row.id, family.person.sofia);
      await linkMedia(trx, row.id, family.person.sofia); // twice is fine
      return row;
    });
    expect(media).toMatchObject({ mime: 'image/jpeg', size: 2000, takenOn: '2001-05', width: 640, uploadedBy: admin });
    await as(admin, async (trx) => {
      expect((await getMedia(trx, media.id))?.storageId).toBe(media.storageId);
      expect((await listPersonMedia(trx, family.person.sofia)).map((m) => m.id)).toEqual([media.id]);
      expect(await mediaPeople(trx, media.id)).toEqual([family.person.sofia]);
      expect(await setTakenOn(trx, media.id, '2001-05-17')).toBe(true);
      expect(await setTakenOn(trx, media.id, null)).toBe(true);
      await setProfilePhoto(trx, family.person.sofia, media.id);
    });
    const photo = () =>
      sql<{ photo_media_id: string | null }>`select photo_media_id from people where id = ${family.person.sofia}`
        .execute(test.owner)
        .then((r) => r.rows[0]?.photo_media_id);
    expect(await photo()).toBe(media.id);
    expect(await as(admin, (trx) => unlinkMedia(trx, media.id, family.person.sofia))).toBe(true);
    expect(await photo()).toBeNull();
    // A User sees it but changes nothing.
    const user = family.account.user.id;
    await as(user, async (trx) => {
      expect(await getMedia(trx, media.id)).not.toBeNull();
      expect(await setTakenOn(trx, media.id, '1999')).toBe(false);
    });
    // Anyone may ask the start-up questions now.
    expect(await mediaRowsExist(app)).toBe(true);
    expect(await storedKeyIds(app)).toEqual([keys.keyId.toString('hex')]);
    const used = await usedStorageIds(app);
    expect(used.has(media.storageId) && used.has(media.avatarStorageId)).toBe(true);
  });

  it('deleteMedia returns both files; a User cannot delete', async () => {
    const admin = family.account.superadmin.id;
    const row = await as(admin, (trx) => insertMedia(trx, sample(admin)));
    expect(await as(family.account.user.id, (trx) => deleteMedia(trx, row.id))).toBeNull();
    const removed = await as(admin, (trx) => deleteMedia(trx, row.id));
    expect(removed?.storageIds.sort()).toEqual([row.storageId, row.avatarStorageId].sort());
    expect(await as(admin, (trx) => deleteMedia(trx, row.id))).toBeNull();
  });

  it('a rolled-back delete removes nothing and reports nothing to unlink', async () => {
    const admin = family.account.superadmin.id;
    const row = await as(admin, (trx) => insertMedia(trx, sample(admin)));
    await expect(
      as(admin, async (trx) => {
        await deleteMedia(trx, row.id);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await as(admin, (trx) => getMedia(trx, row.id))).not.toBeNull();
  });

  it('person delete: photos of only that person go (rows), photos shared with others stay', async () => {
    const admin = family.account.superadmin.id;
    const only = await as(admin, async (trx) => {
      const r = await insertMedia(trx, sample(admin));
      await linkMedia(trx, r.id, family.person.tomas);
      return r;
    });
    const shared = await as(admin, async (trx) => {
      const r = await insertMedia(trx, sample(admin));
      await linkMedia(trx, r.id, family.person.tomas);
      await linkMedia(trx, r.id, family.person.beatriz);
      return r;
    });
    const unlinked = await as(admin, (trx) => insertMedia(trx, sample(admin)));
    const removed = await as(admin, async (trx) => {
      const gone = await deleteMediaOnlyOf(trx, family.person.tomas);
      await trx.deleteFrom('people').where('id', '=', family.person.tomas).execute();
      return gone;
    });
    expect(removed.storageIds.sort()).toEqual([only.storageId, only.avatarStorageId].sort());
    await as(admin, async (trx) => {
      expect(await getMedia(trx, only.id)).toBeNull();
      expect(await getMedia(trx, shared.id)).not.toBeNull();
      expect(await mediaPeople(trx, shared.id)).toEqual([family.person.beatriz]);
      expect(await getMedia(trx, unlinked.id)).not.toBeNull();
    });
  });

  describe('the files service is wired to the table', () => {
    it('a missing marker with photos in the database is files_unavailable; with the marker, ready', async () => {
      const dir = join(root, 'svc');
      const service = createFilesService(
        { dir, key: Buffer.alloc(32, 9) },
        { mediaRowsExist: () => mediaRowsExist(app), sampleKeyIds: () => storedKeyIds(app) },
      );
      // The rows carry another key's id, and there is no marker: unavailable wins.
      expect((await service.refresh()).state).toBe('files_unavailable');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, MARKER), '{}');
      expect((await service.refresh()).state).toBe('key_mismatch');
    });
  });

  describe('the sweeper', () => {
    const setup = () => {
      const dir = mkdtempSync(join(filesDir(), 'd-'));
      for (const sub of ['objects', 'tmp', 'staging']) mkdirSync(join(dir, sub));
      writeFileSync(join(dir, MARKER), '{}');
      const service = createFilesService({ dir, key: Buffer.alloc(32, 3) });
      const store = createObjectStore(dir, () => deriveFileKeys(Buffer.alloc(32, 3)));
      return { dir, service, store };
    };
    const age = (path: string, ms: number) => {
      const when = new Date(Date.now() - ms);
      utimesSync(path, when, when);
    };
    const run = async (s: ReturnType<typeof setup>, now = Date.now()) => {
      await s.service.refresh();
      return sweepOrphans({ db: app, files: s.service, objects: s.store, log: () => undefined }, now);
    };

    it('removes old files no row names, keeps referenced and recent ones, and clears old tmp files', async () => {
      const s = setup();
      const admin = family.account.superadmin.id;
      const full = s.store.put(Buffer.from('full'));
      const avatar = s.store.put(Buffer.from('avatar'));
      const row = await as(admin, (trx) => insertMedia(trx, sample(admin, full.storageId, avatar.storageId)));
      const orphanOld = s.store.put(Buffer.from('orphan old'));
      const orphanNew = s.store.put(Buffer.from('orphan new'));
      for (const id of [full.storageId, avatar.storageId, orphanOld.storageId]) age(s.store.pathOf(id), 3 * HOUR_MS);
      writeFileSync(join(s.dir, 'tmp', 'crash.part'), 'x');
      age(join(s.dir, 'tmp', 'crash.part'), 3 * HOUR_MS);

      const result = await run(s);
      expect(result).toMatchObject({ skipped: null, held: false, tmpRemoved: 1 });
      expect(result.removed).toEqual([orphanOld.storageId]);
      expect(s.store.exists(full.storageId) && s.store.exists(avatar.storageId)).toBe(true);
      expect(s.store.exists(orphanNew.storageId)).toBe(true); // too young: an upload may be mid-flight
      expect(row.id).toBeTruthy();
    });

    it('does nothing while a backup, test or restore holds the lock', async () => {
      const s = setup();
      const orphan = s.store.put(Buffer.from('orphan'));
      age(s.store.pathOf(orphan.storageId), 3 * HOUR_MS);
      const result = await test.owner.connection().execute(async (conn) => {
        await sql`select pg_advisory_lock(${BACKUP_LOCK_KEY})`.execute(conn);
        try {
          return await run(s);
        } finally {
          await sql`select pg_advisory_unlock(${BACKUP_LOCK_KEY})`.execute(conn);
        }
      });
      expect(result.skipped).toBe('backup_running');
      expect(s.store.exists(orphan.storageId)).toBe(true);
      expect((await run(s)).removed).toEqual([orphan.storageId]);
    });

    it('does nothing unless the files folder is ready (no key, or a missing mount)', async () => {
      const s = setup();
      const orphan = s.store.put(Buffer.from('orphan'));
      age(s.store.pathOf(orphan.storageId), 3 * HOUR_MS);
      const keyless = createFilesService({ dir: s.dir, key: undefined });
      await keyless.refresh();
      const result = await sweepOrphans({ db: app, files: keyless, objects: s.store, log: () => undefined });
      expect(result.skipped).toBe('not_ready');
      expect(s.store.exists(orphan.storageId)).toBe(true);
    });

    it('keeps everything inside a hold (after a database-only restore) and sweeps once it has passed', async () => {
      const s = setup();
      const orphan = s.store.put(Buffer.from('uploaded after the backup'));
      age(s.store.pathOf(orphan.storageId), 3 * HOUR_MS);
      const now = Date.now();
      writeFileSync(join(s.dir, HOLD_FILE), new Date(now + 7 * 24 * HOUR_MS).toISOString());
      expect(holdUntil(s.dir)).toBeGreaterThan(now);
      const held = await run(s, now);
      expect(held).toMatchObject({ held: true, removed: [] });
      expect(s.store.exists(orphan.storageId)).toBe(true);
      // Seven days and a minute later the hold is over.
      const later = now + 7 * 24 * HOUR_MS + 60_000;
      const after = await run(s, later);
      expect(after.removed).toEqual([orphan.storageId]);
    });

    it('refuses to delete anything, and says why, when no row uses any file but the folder holds files', async () => {
      const s = setup();
      // A fresh database with no photo rows at all.
      const empty = await createTestDatabase();
      try {
        await ensureAppRole(empty.owner, empty.config.appUser, empty.config.appPassword);
        await runMigrations(empty.owner, { dir: realMigrationsDir, appRole: empty.config.appUser });
        const emptyApp = empty.track(createAppDb(empty.config));
        const stray = s.store.put(Buffer.from('a file and no rows'));
        age(s.store.pathOf(stray.storageId), 3 * HOUR_MS);
        await s.service.refresh();
        const logs: string[] = [];
        const result = await sweepOrphans({
          db: emptyApp,
          files: s.service,
          objects: s.store,
          log: (level, message) => logs.push(`${level}: ${message}`),
        });
        expect(result).toMatchObject({ skipped: 'no_rows_but_files', removed: [] });
        expect(s.store.exists(stray.storageId)).toBe(true);
        expect(logs.join('\n')).toMatch(/warn: the files sweep did nothing: the database says no photo uses any file/);
      } finally {
        await empty.cleanup();
      }
    });

    it('an unreadable or empty hold file is no hold', () => {
      const s = setup();
      expect(holdUntil(s.dir)).toBe(0);
      writeFileSync(join(s.dir, HOLD_FILE), 'garbage');
      expect(holdUntil(s.dir)).toBe(0);
    });
  });
});
