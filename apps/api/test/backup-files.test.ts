// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkEntryNames, createBackup, openArchive, readFilesIndex, spaceNeeded } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { BackupError } from '../src/backup/errors.js';
import { parseFilesIndex } from '../src/backup/files.js';
import { parseManifest } from '../src/backup/manifest.js';
import { verifyBackup } from '../src/backup/verify.js';
import { deriveFileKeys } from '../src/files/key.js';
import { createObjectStore } from '../src/files/objects.js';
import { MARKER } from '../src/files/state.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily } from './helpers/family.js';
import { addTestPhoto, setUpFilesFolder } from './helpers/photos.js';
import type { TestPhoto } from './helpers/photos.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const configured = randomBytes(32);
const keys = { configured, sealed: deriveFileKeys(configured) };
const otherKey = () => {
  const c = randomBytes(32);
  return { configured: c, sealed: deriveFileKeys(c) };
};
const dirs: string[] = [];
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-bfiles-'));
  dirs.push(dir, `${dir}-files`);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
}, 60_000);
afterAll(async () => {
  await sql`delete from media_files`.execute(t.owner);
  await t.close();
});

function context(dir: string, key: typeof keys | null = keys): BackupContext {
  const config = testConfig(t.test, dir, PASS);
  return {
    config: {
      ...config,
      migrationsDir: realMigrationsDir,
      files: { ...config.files, key: key === null ? undefined : key.configured },
    },
    tools: testTools(),
    log: () => undefined,
    appVersion: '0.3.0-test',
    kdf: CHEAP,
  };
}

const collect = async (archive: Awaited<ReturnType<typeof openArchive>>, member: string): Promise<Buffer> => {
  const parts: Buffer[] = [];
  await archive.extract(member, new Writable({ write: (c: Buffer, _e, cb) => (parts.push(c), cb()) }));
  return Buffer.concat(parts);
};

/** A backups folder, a files folder with `n` photos in it, and a context whose file key is the one that sealed them. */
async function withPhotos(
  n: number,
): Promise<{ dir: string; ctx: BackupContext; photos: TestPhoto[]; filesDir: string }> {
  await sql`delete from media_files`.execute(t.owner);
  const dir = folder();
  const ctx = context(dir);
  setUpFilesFolder(ctx.config.files.dir);
  const photos: TestPhoto[] = [];
  for (let i = 0; i < n; i++) photos.push(await addTestPhoto(t.owner, ctx.config.files.dir, keys.sealed));
  return { dir, ctx, photos, filesDir: ctx.config.files.dir };
}

describe('a backup with photos', () => {
  it('carries each stored file as it is on disk, with an index of size, SHA-256 and key id', async () => {
    const { dir, ctx, photos, filesDir } = await withPhotos(2);
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const names = photos.flatMap((p) => [p.storageId, p.avatarStorageId]).sort();
    const total = names.reduce((sum, n) => sum + readFileSync(join(filesDir, 'objects', n.slice(0, 2), n)).length, 0);
    expect(made.manifest.files).toEqual({ included: true, count: 4, bytes: total });
    const archive = await openArchive(made.path, PASS, testTools(), dir);
    try {
      expect(archive.entries).toContain('files.json');
      expect(archive.entries.filter((e) => e.startsWith('files/') && e !== 'files/').sort()).toEqual(
        names.map((n) => `files/${n}`),
      );
      const index = await readFilesIndex(archive);
      expect(index.files.map((f) => f.name).sort()).toEqual(names);
      expect(index.missing).toEqual([]);
      for (const file of index.files) {
        const onDisk = readFileSync(join(filesDir, 'objects', file.name.slice(0, 2), file.name));
        const inArchive = await collect(archive, `files/${file.name}`);
        expect(inArchive.equals(onDisk)).toBe(true); // still encrypted: the bytes are the disk's, not re-sealed
        expect(file.bytes).toBe(onDisk.length);
        expect(file.sha256).toBe(createHash('sha256').update(onDisk).digest('hex'));
        expect(file.keyId).toBe(keys.sealed.keyId.toString('hex'));
      }
      // The archive never holds the key or any plaintext of a photo.
      const tar = readFileSync(archive.tarPath);
      for (const p of photos) expect(tar.includes(p.full.subarray(0, 64))).toBe(false);
      expect(tar.includes(keys.configured)).toBe(false);
    } finally {
      archive.cleanup();
    }
  }, 90_000);

  it('is database-only unless asked: no files, whatever is on the disk', async () => {
    const { dir, ctx } = await withPhotos(1);
    const made = await createBackup(ctx, { kind: 'manual' });
    expect(made.manifest.files).toEqual({ included: false, count: 0, bytes: 0 });
    const archive = await openArchive(made.path, PASS, testTools(), dir);
    try {
      expect(archive.entries.sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      archive.cleanup();
    }
  }, 60_000);

  it('takes the list from the database rows, not from the folder: a stray file is left out', async () => {
    const { dir, ctx, filesDir } = await withPhotos(1);
    const stray = createObjectStore(filesDir, () => keys.sealed).put(
      Buffer.from('uploaded after the snapshot'),
    ).storageId;
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const archive = await openArchive(made.path, PASS, testTools(), dir);
    try {
      expect(archive.entries).not.toContain(`files/${stray}`);
      expect(made.manifest.files.count).toBe(2);
    } finally {
      archive.cleanup();
    }
  }, 60_000);

  it('with no photos at all it is the same as a database-only backup (restoring it leaves the files folder alone)', async () => {
    const { dir, ctx } = await withPhotos(0);
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    expect(made.manifest.files).toEqual({ included: false, count: 0, bytes: 0 });
    const archive = await openArchive(made.path, PASS, testTools(), dir);
    try {
      expect(archive.entries.sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      archive.cleanup();
    }
  }, 60_000);

  it('lists a photo whose file is gone as missing instead of failing; the test then says so', async () => {
    const { dir, ctx, photos, filesDir } = await withPhotos(2);
    const gone = photos[0] as TestPhoto;
    rmSync(join(filesDir, 'objects', gone.storageId.slice(0, 2), gone.storageId));
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    expect(made.manifest.files.count).toBe(3);
    const archive = await openArchive(made.path, PASS, testTools(), dir);
    try {
      expect((await readFilesIndex(archive)).missing).toEqual([gone.storageId]);
    } finally {
      archive.cleanup();
    }
    const result = await verifyBackup(ctx, made.path);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === 'Every photo in the database is in the backup')).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/1 file\(s\) were already missing/),
    });
  }, 120_000);

  it('refuses, saying why, when photos exist but the files folder is not the one that holds them', async () => {
    const { ctx, filesDir } = await withPhotos(1);
    rmSync(join(filesDir, MARKER));
    const failure = await createBackup(ctx, { kind: 'manual', includeFiles: true }).catch(
      (e: unknown) => e as BackupError,
    );
    expect(failure).toBeInstanceOf(BackupError);
    expect((failure as BackupError).kind).toBe('files');
    expect((failure as BackupError).message).toMatch(/not usable/);
    expect((failure as BackupError).message).not.toContain(PASS);
    // A database-only backup still works.
    await expect(createBackup(ctx, { kind: 'manual' })).resolves.toBeTruthy();
  }, 60_000);
});

describe('free space', () => {
  it('needs the database plus the photos, and a tenth more', () => {
    expect(spaceNeeded(1000, 0)).toBe(1100);
    expect(spaceNeeded(1000, 9000)).toBe(11_000);
    expect(spaceNeeded(0, 0)).toBe(0);
  });

  it('refuses a backup with photos when the folder is a little short, with both amounts, and allows it without photos', async () => {
    const { ctx } = await withPhotos(2);
    const size = Number(
      (await sql<{ n: string }>`select pg_database_size(current_database())::text as n`.execute(t.owner)).rows[0]?.n,
    );
    const photos = Number(
      (await sql<{ n: string }>`select sum(size + avatar_size)::text as n from media_files`.execute(t.owner)).rows[0]
        ?.n,
    );
    const need = spaceNeeded(size, photos);
    const tight: BackupContext = { ...ctx, freeBytes: () => need - 1 };
    const failure = await createBackup(tight, { kind: 'manual', includeFiles: true }).catch(
      (e: unknown) => e as BackupError,
    );
    expect((failure as BackupError).kind).toBe('disk_space');
    expect((failure as BackupError).message).toContain(`the photos are ${photos} bytes`);
    expect((failure as BackupError).message).toContain(`${need} are needed`);
    // The database grows by a few pages between measuring it here and the backup measuring it again (pg_database_size is not
    // frozen), so "enough" gets a 5 % margin: the rule being tested is the order of magnitude, not the last byte.
    await expect(
      createBackup({ ...ctx, freeBytes: () => Math.ceil(need * 1.05) }, { kind: 'manual', includeFiles: true }),
    ).resolves.toBeTruthy();
    // Without photos the rule is the database alone (plus a tenth).
    await expect(
      createBackup({ ...ctx, freeBytes: () => Math.ceil(spaceNeeded(size, 0) * 1.05) }, { kind: 'manual' }),
    ).resolves.toBeTruthy();
  }, 120_000);
});

describe('testing a backup with photos', () => {
  it('passes with the current key and says "N files, X MB, key OK"', async () => {
    const { ctx } = await withPhotos(3);
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const result = await verifyBackup(ctx, made.path);
    expect(result.ok).toBe(true);
    const names = result.checks.map((c) => c.name);
    expect(names).toContain('The photo index matches the files in the backup and its manifest');
    expect(names).toContain('Every photo in the database is in the backup');
    const open = result.checks.find((c) => c.name.includes('sampled photo file'));
    expect(open).toMatchObject({ ok: true, detail: expect.stringMatching(/^6 files, \d+\.\d MB, key OK$/) });
  }, 120_000);

  it('fails when the server key is not the one the photos were sealed with', async () => {
    const { ctx } = await withPhotos(2);
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const other = otherKey();
    const result = await verifyBackup(context(ctx.config.backup.dir, other), made.path);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name.includes('sampled photo file'))).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/sealed with a different key/),
    });
  }, 120_000);

  it('fails when a stored file does not open (damaged on the disk before the backup)', async () => {
    const { ctx, photos, filesDir } = await withPhotos(1);
    const path = join(
      filesDir,
      'objects',
      (photos[0] as TestPhoto).storageId.slice(0, 2),
      (photos[0] as TestPhoto).storageId,
    );
    const bytes = readFileSync(path);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const result = await verifyBackup(ctx, made.path);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name.includes('sampled photo file'))?.detail).toMatch(/does not open/);
  }, 120_000);

  it('is skipped, not failed, when no key is set here', async () => {
    const { ctx } = await withPhotos(1);
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const result = await verifyBackup(context(ctx.config.backup.dir, null), made.path);
    expect(result.ok).toBe(true);
    expect(result.checks.at(-1)).toMatchObject({ ok: true, detail: expect.stringMatching(/^skipped/) });
  }, 120_000);

  it('opens at most 20 files, however many there are', async () => {
    const { ctx } = await withPhotos(12); // 24 files
    const made = await createBackup(ctx, { kind: 'manual', includeFiles: true });
    const result = await verifyBackup(ctx, made.path);
    expect(result.ok).toBe(true);
    expect(result.checks.find((c) => c.name.includes('sampled photo file'))?.name).toMatch(/^20 sampled/);
  }, 180_000);

  it('a database-only backup has no photo checks', async () => {
    const { ctx } = await withPhotos(1);
    const made = await createBackup(ctx, { kind: 'manual' });
    const result = await verifyBackup(ctx, made.path);
    expect(result.checks.map((c) => c.name).join('|')).not.toMatch(/photo/i);
  }, 120_000);
});

describe('the index and the manifest', () => {
  const file = { name: 'a'.repeat(32), bytes: 10, sha256: 'b'.repeat(64), keyId: 'c'.repeat(16) };
  it('parses a good index and refuses bad shapes', () => {
    expect(parseFilesIndex({ version: 1, files: [file], missing: ['d'.repeat(32)] }).files).toHaveLength(1);
    for (const bad of [
      null,
      { version: 2, files: [], missing: [] },
      { version: 1, files: [{ ...file, name: '../x' }], missing: [] },
      { version: 1, files: [{ ...file, sha256: 'xyz' }], missing: [] },
      { version: 1, files: [{ ...file, keyId: 'zz' }], missing: [] },
      { version: 1, files: [{ ...file, bytes: -1 }], missing: [] },
      { version: 1, files: [file, file], missing: [] },
      { version: 1, files: [file], missing: [file.name] },
      { version: 1, files: [], missing: ['nope'] },
    ]) {
      expect(() => parseFilesIndex(bad), JSON.stringify(bad)).toThrow(/file index is not valid/);
    }
  });

  it('only accepts hex file names (and files.json) as entries of the archive', () => {
    const ok = ['manifest.json', 'database.dump', 'files.json', 'files/', `files/${'a'.repeat(32)}`];
    expect(() => checkEntryNames(ok)).not.toThrow();
    for (const bad of ['files/photo.bin', 'files/../x', `files/${'A'.repeat(32)}`, 'files.json/x']) {
      expect(() => checkEntryNames(['manifest.json', 'database.dump', bad]), bad).toThrow(/unexpected entry/);
    }
  });

  it('reads the manifest of an older archive that has no file bytes', () => {
    const base = {
      format: 1,
      kind: 'manual',
      createdAt: 'x',
      appVersion: '0.2.1',
      database: 'k',
      ownerRole: 'o',
      appRole: 'a',
      schema: 20,
      pgDumpMajor: 18,
      serverMajor: 18,
      tables: {},
      fingerprint: {},
      dump: { file: 'database.dump', sha256: 'x', bytes: 1 },
    };
    expect(parseManifest({ ...base, files: { included: false, count: 0 } }).files).toEqual({
      included: false,
      count: 0,
      bytes: 0,
    });
    expect(() => parseManifest({ ...base, files: { included: true, count: 1, bytes: -3 } })).toThrow(/not valid/);
  });
});
