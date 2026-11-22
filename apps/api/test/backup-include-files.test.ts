// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Include uploaded files" is ON when nothing is stored, in every place the setting is read: the settings the Admin form shows, the
// schedule, a manual backup and `kinship backup`. An explicit stored value is kept. An upgrade's safety copy is database-only.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKUP_SETTINGS } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listBackups, openArchive } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { createScheduler } from '../src/backup/scheduler.js';
import { readBackupSettings } from '../src/backup/settings.js';
import { migrateWithSafetyCopy } from '../src/backup/upgrade.js';
import type { UpgradeContext } from '../src/backup/upgrade.js';
import { runCli } from '../src/cli.js';
import type { CliDeps } from '../src/cli.js';
import { deriveFileKeys } from '../src/files/key.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';
import { addTestPhoto, setUpFilesFolder } from './helpers/photos.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const configured = randomBytes(32);
const sealed = deriveFileKeys(configured);

let test: TestDatabase;
const dirs: string[] = [];
beforeAll(async () => {
  test = await createTestDatabase();
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
}, 60_000);
afterAll(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  await test.cleanup();
});

const store = (value: unknown | undefined) =>
  value === undefined
    ? sql`delete from app_settings where key = 'backup.include_files'`.execute(test.owner)
    : sql`insert into app_settings (key, value) values ('backup.include_files', ${JSON.stringify(value)}::jsonb)
          on conflict (key) do update set value = excluded.value`.execute(test.owner);
// The settings these tests do not care about: no test run after each backup (it is slow and tested elsewhere).
const quiet = () =>
  sql`insert into app_settings (key, value) values ('backup.test_after', 'false'::jsonb)
      on conflict (key) do update set value = excluded.value`.execute(test.owner);

async function rig(): Promise<{ dir: string; ctx: BackupContext }> {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-incl-'));
  dirs.push(dir, `${dir}-files`);
  const config = testConfig(test, dir, PASS);
  const ctx: BackupContext = {
    config: { ...config, migrationsDir: realMigrationsDir, files: { dir: `${dir}-files`, key: configured } },
    tools: testTools(),
    log: () => undefined,
    appVersion: '0.3.0-test',
    kdf: CHEAP,
  };
  setUpFilesFolder(ctx.config.files.dir);
  return { dir, ctx };
}

const manifestOf = async (dir: string, name: string) => {
  const archive = await openArchive(join(dir, name), PASS, testTools(), dir);
  try {
    return { files: archive.manifest.files, entries: archive.entries };
  } finally {
    archive.cleanup();
  }
};
const newest = (dir: string) => (listBackups(dir)[0] as { name: string }).name;

describe('the stored setting', () => {
  it('is ON when nothing is stored, and the shared default is ON', async () => {
    expect(DEFAULT_BACKUP_SETTINGS.includeFiles).toBe(true);
    await store(undefined);
    expect((await readBackupSettings(test.owner)).includeFiles).toBe(true);
  });

  it('keeps an explicit value, on or off', async () => {
    await store(false);
    expect((await readBackupSettings(test.owner)).includeFiles).toBe(false);
    await store(true);
    expect((await readBackupSettings(test.owner)).includeFiles).toBe(true);
  });

  it('falls back to ON for a stored value that is not a boolean', async () => {
    await store('maybe');
    expect((await readBackupSettings(test.owner)).includeFiles).toBe(true);
    await store(undefined);
  });
});

describe('a backup made with nothing stored carries the photos', () => {
  it('a manual backup (the Admin button)', async () => {
    await store(undefined);
    await quiet();
    const { dir, ctx } = await rig();
    await addTestPhoto(test.owner, ctx.config.files.dir, sealed);
    const record = await createScheduler(ctx).runNow();
    expect(record).toMatchObject({ kind: 'manual', ok: true });
    const made = await manifestOf(dir, newest(dir));
    expect(made.files).toMatchObject({ included: true, count: 2 });
    expect(made.entries).toContain('files.json');
  }, 120_000);

  it('kinship backup', async () => {
    await store(undefined);
    const { dir, ctx } = await rig();
    const deps: CliDeps = {
      openDb: () => test.owner,
      readPassword: () => Promise.resolve(''),
      out: () => undefined,
      err: () => undefined,
      backup: { config: () => ctx.config, tools: testTools(), env: { BACKUP_DIR: dir, BACKUP_PASSPHRASE: PASS } },
    };
    // The photo from the first test is still in the database; this folder needs its files.
    await sql`delete from media_files`.execute(test.owner);
    await addTestPhoto(test.owner, ctx.config.files.dir, sealed);
    expect(await runCli(['backup'], deps)).toBe(0);
    expect((await manifestOf(dir, newest(dir))).files).toMatchObject({ included: true, count: 2 });
  }, 120_000);

  it('an explicit OFF is kept: no files from the button or the command line', async () => {
    await store(false);
    await quiet();
    const { dir, ctx } = await rig();
    await sql`delete from media_files`.execute(test.owner);
    await addTestPhoto(test.owner, ctx.config.files.dir, sealed);
    await createScheduler(ctx).runNow();
    expect((await manifestOf(dir, newest(dir))).files).toEqual({ included: false, count: 0, bytes: 0 });
    const cli = await rig();
    await addTestPhoto(test.owner, cli.ctx.config.files.dir, sealed);
    const deps: CliDeps = {
      openDb: () => test.owner,
      readPassword: () => Promise.resolve(''),
      out: () => undefined,
      err: () => undefined,
      backup: {
        config: () => cli.ctx.config,
        tools: testTools(),
        env: { BACKUP_DIR: cli.dir, BACKUP_PASSPHRASE: PASS },
      },
    };
    expect(await runCli(['backup'], deps)).toBe(0);
    expect((await manifestOf(cli.dir, newest(cli.dir))).entries.sort()).toEqual(['database.dump', 'manifest.json']);
    await store(undefined);
  }, 180_000);

  it('with no photos, ON makes the same archive as a database-only one', async () => {
    await store(undefined);
    await quiet();
    await sql`delete from media_files`.execute(test.owner);
    const { dir, ctx } = await rig();
    await createScheduler(ctx).runNow();
    const made = await manifestOf(dir, newest(dir));
    expect(made.files).toEqual({ included: false, count: 0, bytes: 0 });
    expect(made.entries.sort()).toEqual(['database.dump', 'manifest.json']);
  }, 120_000);
});

describe('an upgrade safety copy stays database-only', () => {
  it('even with photos, a key and "include files" ON', async () => {
    const own = await createTestDatabase();
    const full = await tempMigrationsDir(true);
    const partial = await tempMigrationsDir(true);
    try {
      await ensureAppRole(own.owner, own.config.appUser, own.config.appPassword);
      // The database is at the last migration but one; the newest is the pending change that triggers the copy.
      const last = Math.max(
        ...(await import('node:fs')).readdirSync(realMigrationsDir).map((n) => Number(/^(\d+)_/.exec(n)?.[1] ?? 0)),
      );
      await removeMigrationsFrom(partial.dir, last);
      await runMigrations(own.owner, { dir: partial.dir, appRole: own.config.appUser });
      const dir = mkdtempSync(join(tmpdir(), 'kinship-incl-up-'));
      dirs.push(dir, `${dir}-files`);
      const config = testConfig(own, dir, PASS);
      const filesDir = `${dir}-files`;
      setUpFilesFolder(filesDir);
      await addTestPhoto(own.owner, filesDir, sealed);
      await sql`insert into app_settings (key, value) values ('backup.include_files', 'true'::jsonb)`.execute(
        own.owner,
      );
      const ctx: UpgradeContext = {
        config: { ...config, migrationsDir: full.dir, files: { dir: filesDir, key: configured } },
        tools: testTools(),
        log: () => undefined,
        appVersion: '0.3.0-test',
        kdf: CHEAP,
      };
      const result = await migrateWithSafetyCopy(ctx);
      expect(result.applied.length).toBeGreaterThan(0);
      const copy = listBackups(dir).find((b) => b.kind === 'pre-upgrade');
      expect(copy).toBeTruthy();
      const made = await manifestOf(dir, (copy as { name: string }).name);
      expect(made.files).toEqual({ included: false, count: 0, bytes: 0 });
      expect(made.entries.sort()).toEqual(['database.dump', 'manifest.json']);
    } finally {
      await full.remove();
      await partial.remove();
      await own.cleanup();
    }
  }, 180_000);
});
