// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Restoring a backup that carries photos (ADR 0035, #205): the matrix. Real backups, a real database, the real restore.
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup, listBackups, openArchive, readFilesIndex } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { BackupError } from '../src/backup/errors.js';
import { applyArchive, checkRestore, restoreBackup } from '../src/backup/restore.js';
import type { RestoreHooks } from '../src/backup/restore.js';
import {
  INTENT_FILE,
  finishSwap,
  newRestoreId,
  readIntent,
  reconcileFiles,
  stageFiles,
  stagingOf,
  writeIntent,
} from '../src/backup/restore-files.js';
import { runCli } from '../src/cli.js';
import type { CliDeps } from '../src/cli.js';
import { deriveFileKeys } from '../src/files/key.js';
import { createObjectStore } from '../src/files/objects.js';
import { readRestoreMarker } from '../src/files/restore-marker.js';
import { MARKER } from '../src/files/state.js';
import { HOLD_FILE, holdUntil, HOUR_MS } from '../src/media/sweeper.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { buildFamily } from './helpers/family.js';
import { forgeBackup, readJson, writeJson } from './helpers/forge.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import { addTestPhoto, setUpFilesFolder } from './helpers/photos.js';
import type { TestPhoto } from './helpers/photos.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Rig {
  test: TestDatabase;
  dir: string;
  filesDir: string;
  ctx: BackupContext;
  configured: Buffer;
  sealed: ReturnType<typeof deriveFileKeys>;
}

async function rig(): Promise<Rig> {
  const test = await createTestDatabase();
  cleanups.push(() => test.cleanup());
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
  await buildFamily(test.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
  const dir = mkdtempSync(join(tmpdir(), 'kinship-rfiles-'));
  const filesDir = `${dir}-files`;
  cleanups.push(
    () => rmSync(dir, { recursive: true, force: true }),
    () => rmSync(filesDir, { recursive: true, force: true }),
  );
  const configured = randomBytes(32);
  const config = testConfig(test, dir, PASS);
  const ctx: BackupContext = {
    config: { ...config, migrationsDir: realMigrationsDir, files: { dir: filesDir, key: configured } },
    tools: testTools(),
    log: () => undefined,
    appVersion: '0.3.0-test',
    kdf: CHEAP,
  };
  setUpFilesFolder(filesDir);
  return { test, dir, filesDir, ctx, configured, sealed: deriveFileKeys(configured) };
}

const hooks = (answer = true): RestoreHooks & { messages: string[] } => {
  const messages: string[] = [];
  return { messages, progress: (m) => messages.push(m), confirm: () => Promise.resolve(answer) };
};

/** name -> sha256 of every stored object. */
function objects(filesDir: string): Record<string, string> {
  const store = createObjectStore(filesDir, () => null);
  return Object.fromEntries(
    store
      .list()
      .map((o) => [o.storageId, createHash('sha256').update(store.readRaw(o.storageId)).digest('hex')] as const)
      .sort(),
  );
}
const namesOf = (...photos: TestPhoto[]) => photos.flatMap((p) => [p.storageId, p.avatarStorageId]).sort();
const rowNames = async (test: TestDatabase) =>
  (
    await sql<{
      id: string;
    }>`select storage_id as id from media_files union all select avatar_storage_id from media_files`.execute(test.owner)
  ).rows
    .map((r) => r.id)
    .sort();
const leftovers = (filesDir: string) => ({
  staging: readdirSync(join(filesDir, 'staging')),
  old: readdirSync(filesDir).filter((n) => n.startsWith('objects.old-')),
  intent: existsSync(join(filesDir, INTENT_FILE)),
});

/** Two photos, a backup with files, then a change: one photo deleted and a different one uploaded. */
async function scenario() {
  const r = await rig();
  const a = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
  const b = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
  const made = await createBackup(r.ctx, { kind: 'manual', includeFiles: true });
  const before = objects(r.filesDir);
  // After the backup: photo a is deleted (row and files), and photo c is uploaded.
  const store = createObjectStore(r.filesDir, () => r.sealed);
  await sql`delete from media_files where id = ${a.id}`.execute(r.test.owner);
  store.remove(a.storageId);
  store.remove(a.avatarStorageId);
  const c = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
  return { r, a, b, c, made, before };
}

describe('restoring a backup that carries photos', () => {
  it('replaces the photos with the backup’s, byte for byte, and leaves nothing behind', async () => {
    const { r, a, b, c, made, before } = await scenario();
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(b, c));
    const report = await restoreBackup(r.ctx, join(r.dir, made.name), hooks());
    expect(report.cancelled).toBe(false);
    // Exactly the files the backup held: a is back, c is gone, b is untouched.
    expect(objects(r.filesDir)).toEqual(before);
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, b));
    expect(await rowNames(r.test)).toEqual(namesOf(a, b));
    // The files still open with the key, and say what they held.
    const store = createObjectStore(r.filesDir, () => r.sealed);
    expect(store.read(a.storageId).equals(a.full)).toBe(true);
    expect(store.read(b.avatarStorageId).equals(b.avatar)).toBe(true);
    // Staging, the old objects, and the intent are gone; the folder is a normal one.
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
    expect(existsSync(join(r.filesDir, MARKER))).toBe(true);
    expect(existsSync(join(r.filesDir, 'tmp'))).toBe(true);
    // The marker says which restore this was.
    expect(await readRestoreMarker(r.test.owner)).toMatch(/^[0-9a-f]{32}$/);
    expect(existsSync(join(r.filesDir, HOLD_FILE))).toBe(false);
  }, 180_000);

  it('makes a safety copy that carries the photos that were here, so a restore can be undone', async () => {
    const { r, c, b, made } = await scenario();
    const report = await restoreBackup(r.ctx, join(r.dir, made.name), hooks());
    expect(report.safetyCopy).toMatch(/^pre-restore-/);
    const archive = await openArchive(join(r.dir, report.safetyCopy as string), PASS, r.ctx.tools, r.dir);
    try {
      expect(archive.manifest.files).toMatchObject({ included: true, count: 4 });
      const index = await readFilesIndex(archive);
      expect(index.files.map((f) => f.name).sort()).toEqual(namesOf(b, c));
    } finally {
      archive.cleanup();
    }
    // And restoring that safety copy puts photo c back and removes the backup's photo a again.
    await restoreBackup(r.ctx, join(r.dir, report.safetyCopy as string), hooks());
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(b, c));
  }, 240_000);

  it('on a brand-new server: an empty, unmounted-looking files folder is set up and filled', async () => {
    const { r, a, b, made } = await scenario();
    rmSync(r.filesDir, { recursive: true, force: true });
    await restoreBackup(r.ctx, join(r.dir, made.name), hooks());
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, b));
    expect(existsSync(join(r.filesDir, MARKER))).toBe(true);
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
  }, 180_000);

  it('works when the photos here cannot be read for the safety copy (a lost mount): the copy is database-only', async () => {
    const { r, a, b, made } = await scenario();
    rmSync(join(r.filesDir, MARKER)); // photos in the database, but this is not the folder that holds them
    const h = hooks();
    const report = await restoreBackup(r.ctx, join(r.dir, made.name), h);
    expect(h.messages.join('\n')).toMatch(/safety copy holds the database only/);
    expect(report.safetyCopy).toMatch(/^pre-restore-/);
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, b));
  }, 180_000);

  it('a photo that was already missing when the backup was made stays a row without a file', async () => {
    const r = await rig();
    const a = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
    const b = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
    createObjectStore(r.filesDir, () => r.sealed).remove(a.storageId);
    const made = await createBackup(r.ctx, { kind: 'manual', includeFiles: true });
    await restoreBackup(r.ctx, join(r.dir, made.name), hooks());
    expect(await rowNames(r.test)).toEqual(namesOf(a, b));
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual([a.avatarStorageId, b.storageId, b.avatarStorageId].sort());
  }, 180_000);
});

describe('what stops a restore with photos, with nothing changed', () => {
  const unchanged = async (r: Rig, before: Record<string, string>, rows: string[]) => {
    expect(objects(r.filesDir)).toEqual(before);
    expect(await rowNames(r.test)).toEqual(rows);
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
  };

  it('a photo row the backup’s files do not cover: aborts BEFORE the commit, files and database untouched', async () => {
    const { r, made } = await scenario();
    // Forge the same backup with one photo dropped from the index, its entry and the manifest, but its row still in the dump.
    await forgeBackup(r.dir, made.name, PASS, 'kinship-2020-01-01-0000.tar.enc', (work) => {
      const index = readJson<{ files: Array<{ name: string; bytes: number }>; missing: string[]; version: 1 }>(
        join(work, 'files.json'),
      );
      const dropped = index.files.pop() as { name: string; bytes: number };
      writeJson(join(work, 'files.json'), index);
      rmSync(join(work, 'files', dropped.name));
      const manifest = readJson<{ files: { count: number; bytes: number } }>(join(work, 'manifest.json'));
      manifest.files.count -= 1;
      manifest.files.bytes -= dropped.bytes;
      writeJson(join(work, 'manifest.json'), manifest);
    });
    const before = objects(r.filesDir);
    const rows = await rowNames(r.test);
    const marker = await readRestoreMarker(r.test.owner);
    const failure = await restoreBackup(r.ctx, join(r.dir, 'kinship-2020-01-01-0000.tar.enc'), hooks()).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(BackupError);
    expect((failure as BackupError).message).toMatch(/do not match/);
    await unchanged(r, before, rows);
    expect(await readRestoreMarker(r.test.owner)).toBe(marker);
  }, 240_000);

  it('a photo file whose bytes changed in the archive: refused while unpacking, before the database is touched', async () => {
    const { r, made } = await scenario();
    await forgeBackup(r.dir, made.name, PASS, 'kinship-2020-01-02-0000.tar.enc', (work) => {
      const index = readJson<{ files: Array<{ name: string }> }>(join(work, 'files.json'));
      const path = join(work, 'files', (index.files[0] as { name: string }).name);
      const bytes = readFileSync(path);
      bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 1;
      writeFileSync(path, bytes);
    });
    const before = objects(r.filesDir);
    const rows = await rowNames(r.test);
    const failure = await restoreBackup(r.ctx, join(r.dir, 'kinship-2020-01-02-0000.tar.enc'), hooks()).catch(
      (e: unknown) => e,
    );
    expect((failure as BackupError).message).toMatch(/does not match its checksum/);
    await unchanged(r, before, rows);
  }, 240_000);

  it('the server’s key is not the one that sealed the photos: refused with the key ids, in the check and in the restore', async () => {
    const { r, made } = await scenario();
    const other = randomBytes(32);
    const wrong: BackupContext = { ...r.ctx, config: { ...r.ctx.config, files: { dir: r.filesDir, key: other } } };
    const before = objects(r.filesDir);
    const rows = await rowNames(r.test);
    for (const attempt of [
      () => checkRestore(wrong, join(r.dir, made.name)),
      () => restoreBackup(wrong, join(r.dir, made.name), hooks()),
    ]) {
      const failure = (await attempt().catch((e: unknown) => e)) as BackupError;
      expect(failure.kind).toBe('refused');
      expect(failure.message).toMatch(/different file key \(id [0-9a-f]{16}\) than this server's \(id [0-9a-f]{16}\)/);
      expect(failure.message).not.toContain(other.toString('hex'));
      expect(failure.message).not.toContain(other.toString('base64'));
    }
    await unchanged(r, before, rows);
  }, 180_000);

  it('no key on this server: refused, saying how to fix it', async () => {
    const { r, made } = await scenario();
    const keyless: BackupContext = {
      ...r.ctx,
      config: { ...r.ctx.config, files: { dir: r.filesDir, key: undefined } },
    };
    const failure = (await checkRestore(keyless, join(r.dir, made.name)).catch((e: unknown) => e)) as BackupError;
    expect(failure.kind).toBe('refused');
    expect(failure.message).toMatch(/no FILE_ENCRYPTION_KEY/);
  }, 120_000);

  it('not enough room: the amounts of the backups folder and the photos are in the refusal', async () => {
    const { r, made } = await scenario();
    const size = Number(
      (await sql<{ n: string }>`select pg_database_size(current_database())::text as n`.execute(r.test.owner)).rows[0]
        ?.n,
    );
    const here = Number(
      (await sql<{ n: string }>`select sum(size + avatar_size)::text as n from media_files`.execute(r.test.owner))
        .rows[0]?.n,
    );
    const archive = await openArchive(join(r.dir, made.name), PASS, r.ctx.tools, r.dir);
    const inBackup = archive.manifest.files.bytes;
    archive.cleanup();
    const tight: BackupContext = { ...r.ctx, freeBytes: () => 1000 };
    const failure = (await checkRestore(tight, join(r.dir, made.name)).catch((e: unknown) => e)) as BackupError;
    expect(failure.kind).toBe('disk_space');
    expect(failure.message).toContain(`${here} bytes in the safety copy`);
    expect(failure.message).toContain(`${inBackup} in the unpacked backup`);
    expect(failure.message).toContain(`the database, which is ${size} bytes`);
    expect(failure.message).toMatch(/and 1000 are available/);
  }, 180_000);
});

describe('a restore cut short between the commit and the file swap', () => {
  /** Does everything a restore does up to (and including) the commit, then stops: as if the process died there. */
  async function diedAfterCommit(r: Rig, backup: string) {
    const archive = await openArchive(join(r.dir, backup), PASS, r.ctx.tools, r.dir);
    try {
      const index = await readFilesIndex(archive);
      const id = newRestoreId();
      await stageFiles(r.ctx.tools, archive.tarPath, index, r.filesDir, id);
      writeIntent(r.filesDir, id);
      await applyArchive(r.ctx, archive, r.test.config.name, { resetState: true, restoreId: id });
      return id;
    } finally {
      archive.cleanup();
    }
  }

  it('the database committed: the next start swaps the photos in, and does it only once', async () => {
    const { r, a, b, made, before } = await scenario();
    const id = await diedAfterCommit(r, made.name);
    expect(readIntent(r.filesDir)?.id).toBe(id);
    expect(Object.keys(objects(r.filesDir)).length).toBe(4); // still the old photos
    const first = await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner));
    expect(first).toEqual({ action: 'completed', id });
    expect(objects(r.filesDir)).toEqual(before);
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, b));
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
    expect(await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner))).toEqual({ action: 'none' });
  }, 240_000);

  it('the swap was half done (objects already moved aside): it is finished', async () => {
    const { r, a, b, made, before } = await scenario();
    const id = await diedAfterCommit(r, made.name);
    renameSync(join(r.filesDir, 'objects'), join(r.filesDir, `objects.old-${id}`));
    const result = await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner));
    expect(result).toEqual({ action: 'completed', id });
    expect(objects(r.filesDir)).toEqual(before);
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, b));
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
  }, 240_000);

  it('the swap was done but the old files were not deleted yet: they are deleted', async () => {
    const { r, made, before } = await scenario();
    const id = await diedAfterCommit(r, made.name);
    // Do the two renames by hand, then "die" before the delete.
    renameSync(join(r.filesDir, 'objects'), join(r.filesDir, `objects.old-${id}`));
    renameSync(join(stagingOf(r.filesDir, id), 'tree'), join(r.filesDir, 'objects'));
    expect((await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner))).action).toBe('completed');
    expect(objects(r.filesDir)).toEqual(before);
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
  }, 240_000);

  it('the database did NOT commit: the staged photos are discarded and the folder is untouched', async () => {
    const { r, made } = await scenario();
    const archive = await openArchive(join(r.dir, made.name), PASS, r.ctx.tools, r.dir);
    const before = objects(r.filesDir);
    const rows = await rowNames(r.test);
    const marker = await readRestoreMarker(r.test.owner);
    let id: string;
    try {
      const index = await readFilesIndex(archive);
      id = newRestoreId();
      await stageFiles(r.ctx.tools, archive.tarPath, index, r.filesDir, id);
      writeIntent(r.filesDir, id);
      // The process died inside the database transaction: nothing was committed, so the marker is still the old one.
    } finally {
      archive.cleanup();
    }
    expect(existsSync(stagingOf(r.filesDir, id))).toBe(true);
    const result = await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner));
    expect(result).toEqual({ action: 'discarded', id });
    expect(objects(r.filesDir)).toEqual(before);
    expect(await rowNames(r.test)).toEqual(rows);
    expect(await readRestoreMarker(r.test.owner)).toBe(marker);
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
  }, 240_000);

  it('a stale marker from an earlier restore is not mistaken for this one', async () => {
    const { r, made } = await scenario();
    const first = await diedAfterCommit(r, made.name);
    await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner));
    // A second attempt dies before its commit. The database still carries the FIRST id.
    const archive = await openArchive(join(r.dir, made.name), PASS, r.ctx.tools, r.dir);
    try {
      const second = newRestoreId();
      await stageFiles(r.ctx.tools, archive.tarPath, await readFilesIndex(archive), r.filesDir, second);
      writeIntent(r.filesDir, second);
      expect(await readRestoreMarker(r.test.owner)).toBe(first);
      expect(await reconcileFiles(r.filesDir, () => readRestoreMarker(r.test.owner))).toEqual({
        action: 'discarded',
        id: second,
      });
    } finally {
      archive.cleanup();
    }
  }, 240_000);

  it('removes a staging folder left by a crash while unpacking (no intent at all)', async () => {
    const r = await rig();
    mkdirSync(join(r.filesDir, 'staging', newRestoreId(), 'raw'), { recursive: true });
    expect(await reconcileFiles(r.filesDir, () => Promise.resolve(null))).toEqual({ action: 'none' });
    expect(readdirSync(join(r.filesDir, 'staging'))).toEqual([]);
  });

  it('finishSwap run twice is harmless', async () => {
    const { r, made, before } = await scenario();
    const id = await diedAfterCommit(r, made.name);
    finishSwap(r.filesDir, id);
    finishSwap(r.filesDir, id);
    expect(objects(r.filesDir)).toEqual(before);
  }, 240_000);
});

describe('a database-only backup', () => {
  it('leaves the files folder alone; photos uploaded since are kept for seven days, and the sweeper honours that', async () => {
    const r = await rig();
    const a = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
    const made = await createBackup(r.ctx, { kind: 'manual' }); // no includeFiles
    expect(made.manifest.files.included).toBe(false);
    const c = await addTestPhoto(r.test.owner, r.filesDir, r.sealed);
    const before = objects(r.filesDir);
    const now = Date.now();
    const report = await restoreBackup({ ...r.ctx, now: () => new Date(now) }, join(r.dir, made.name), hooks());
    expect(report.cancelled).toBe(false);
    // Nothing in the folder changed: c's files are still there although its row is gone (an orphan), and a's files too.
    expect(objects(r.filesDir)).toEqual(before);
    expect(await rowNames(r.test)).toEqual(namesOf(a));
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, c));
    const until = holdUntil(r.filesDir);
    expect(until).toBeGreaterThanOrEqual(now + 7 * 24 * HOUR_MS - 1000);
    expect(until).toBeLessThanOrEqual(now + 7 * 24 * HOUR_MS + 1000);
    // A restore of a database-only backup does not need a matching key.
    const keyless: BackupContext = {
      ...r.ctx,
      config: { ...r.ctx.config, files: { dir: r.filesDir, key: randomBytes(32) } },
    };
    await expect(checkRestore(keyless, join(r.dir, made.name))).resolves.toMatchObject({ files: { included: false } });
  }, 240_000);

  it('a backup with no photos at all is the same thing', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual', includeFiles: true });
    expect(made.manifest.files).toEqual({ included: false, count: 0, bytes: 0 });
    const facts = await checkRestore(r.ctx, join(r.dir, made.name));
    expect(facts.files).toEqual({ included: false, count: 0, bytes: 0 });
  }, 120_000);

  it('the check says what a restore will do with the photos', async () => {
    const { r, made } = await scenario();
    const facts = await checkRestore(r.ctx, join(r.dir, made.name));
    expect(facts.files).toMatchObject({ included: true, count: 4 });
    expect(facts.files.bytes).toBeGreaterThan(0);
  }, 180_000);
});

describe('the command line does the same', () => {
  it('kinship restore puts the photos back and says so', async () => {
    const { r, a, b, made, before } = await scenario();
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps = {
      openDb: () => {
        throw new Error('not used');
      },
      readPassword: () => Promise.resolve(''),
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      backup: {
        config: () => r.ctx.config,
        tools: r.ctx.tools,
        env: { BACKUP_DIR: r.dir, BACKUP_PASSPHRASE: PASS },
      },
    };
    expect(await runCli(['restore', made.name, '--yes'], deps)).toBe(0);
    expect(out.join('\n')).toMatch(/The backup carries 4 photo files/);
    expect(err).toEqual([]);
    expect(objects(r.filesDir)).toEqual(before);
    expect(Object.keys(objects(r.filesDir)).sort()).toEqual(namesOf(a, b));
    expect(leftovers(r.filesDir)).toEqual({ staging: [], old: [], intent: false });
    expect(listBackups(r.dir).some((x) => x.kind === 'pre-restore')).toBe(true);
  }, 240_000);
});
