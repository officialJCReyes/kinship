// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { BackupError } from '../src/backup/errors.js';
import { createScheduler, RETRY_AFTER_FAILURE_MS, backupHousekeeping } from '../src/backup/scheduler.js';
import { verifyPrefix } from '../src/backup/verify.js';
import { readState } from '../src/backup/state.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { buildFamily } from './helpers/family.js';
import { testConfig, testTools } from './helpers/pg-tools.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Env {
  test: TestDatabase;
  dir: string;
  /** The fake clock the scheduler and the backups use. */
  now: { value: Date };
  ctx: BackupContext;
  logs: Array<{ level: string; message: string }>;
}

async function setup(
  options: { passphrase?: string | undefined; enabled?: boolean; settings?: Record<string, unknown> } = {},
): Promise<Env> {
  const test = await createTestDatabase();
  cleanups.push(() => test.cleanup());
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
  await buildFamily(test.owner);
  for (const [key, value] of Object.entries(options.settings ?? {})) {
    await sql`insert into app_settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)`.execute(
      test.owner,
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'kinship-sched-it-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const now = { value: new Date('2026-11-14T10:00:00Z') };
  const logs: Env['logs'] = [];
  const config = testConfig(test, dir, 'passphrase' in options ? options.passphrase : PASS);
  config.backup.enabled = options.enabled ?? true;
  const ctx: BackupContext = {
    config: { ...config, migrationsDir: realMigrationsDir },
    tools: testTools(),
    log: (level, message) => logs.push({ level, message }),
    appVersion: '0.2.0-test',
    kdf: CHEAP,
    now: () => now.value,
  };
  return { test, dir, now, ctx, logs };
}

const archives = (dir: string) => readdirSync(dir).filter((n) => /^kinship-.*\.tar\.enc$/.test(n));
const advance = (env: Env, ms: number) => void (env.now.value = new Date(env.now.value.getTime() + ms));

describe('the schedule', () => {
  it('makes the backup that is due, tests it, and does not make another until the next one is due', async () => {
    const env = await setup();
    const scheduler = createScheduler(env.ctx);
    await scheduler.tick(env.now.value); // 10:00, the 03:00 run is due
    expect(archives(env.dir)).toHaveLength(1);
    const state = readState(env.dir);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ kind: 'scheduled', ok: true, file: archives(env.dir)[0] });
    expect(state.lastTest).toMatchObject({ ok: true, mode: 'restore', file: archives(env.dir)[0] });

    advance(env, 5 * 3_600_000); // 15:00 the same day
    await scheduler.tick(env.now.value);
    expect(archives(env.dir)).toHaveLength(1);

    advance(env, 12 * 3_600_000); // 03:00 + the next day, 03:00 passed at 03:00
    await scheduler.tick(env.now.value); // 03:00 the 15th is due
    expect(archives(env.dir)).toHaveLength(2);
    expect(readState(env.dir).runs.map((r) => r.kind)).toEqual(['scheduled', 'scheduled']);
  }, 120_000);

  it('makes up a run it missed while it was stopped, and only once', async () => {
    const env = await setup();
    const scheduler = createScheduler(env.ctx);
    await scheduler.tick(env.now.value);
    expect(archives(env.dir)).toHaveLength(1);
    // The api is stopped for three days; it starts at 09:00 on the 17th. The 03:00 runs of the 15th, 16th and 17th were missed.
    env.now.value = new Date('2026-11-17T09:00:00Z');
    await scheduler.tick(env.now.value);
    expect(archives(env.dir)).toHaveLength(2);
    await scheduler.tick(env.now.value);
    expect(archives(env.dir)).toHaveLength(2);
  }, 120_000);

  it('a manual backup counts: the schedule does not repeat it right after', async () => {
    const env = await setup();
    const scheduler = createScheduler(env.ctx);
    const record = await scheduler.runNow();
    expect(record).toMatchObject({ kind: 'manual', ok: true });
    await scheduler.tick(env.now.value);
    expect(archives(env.dir)).toHaveLength(1);
  }, 120_000);

  it('waits 15 minutes after a failure, then tries again, and says what went wrong without a secret', async () => {
    const env = await setup();
    const broken = join(mkdtempSync(join(tmpdir(), 'kinship-broken-')), 'pg_dump');
    cleanups.push(() => rmSync(join(broken, '..'), { recursive: true, force: true }));
    writeFileSync(
      broken,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then exec '${testTools().pgDump}' --version; fi\necho "FATAL: password authentication failed ${env.test.config.ownerPassword} ${PASS}" >&2\nexit 1\n`,
    );
    chmodSync(broken, 0o755);
    const bad: BackupContext = { ...env.ctx, tools: { ...env.ctx.tools, pgDump: broken } };
    const scheduler = createScheduler(bad);
    await scheduler.tick(env.now.value);
    const state = readState(env.dir);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ ok: false, errorKind: 'tool' });
    expect(JSON.stringify(state)).not.toContain(env.test.config.ownerPassword);
    expect(JSON.stringify(state)).not.toContain(PASS);
    expect(archives(env.dir)).toHaveLength(0);

    advance(env, 5 * 60_000);
    await scheduler.tick(env.now.value);
    expect(readState(env.dir).runs).toHaveLength(1);
    advance(env, RETRY_AFTER_FAILURE_MS);
    await scheduler.tick(env.now.value);
    expect(readState(env.dir).runs).toHaveLength(2);
    const status = await scheduler.status(env.now.value);
    expect(status.problems).toEqual(expect.arrayContaining(['last_backup_failed', 'never_backed_up']));
    expect(status.healthy).toBe(false);
    expect(readdirSync(env.dir).filter((n) => n.startsWith('.work') || n.startsWith('.tmp'))).toEqual([]);
  }, 120_000);

  it('does nothing when BACKUP_ENABLED is off, or the passphrase is missing, short or the placeholder', async () => {
    for (const options of [
      { enabled: false },
      { passphrase: undefined },
      { passphrase: 'short' },
      { passphrase: 'change-me-backup' },
    ]) {
      const env = await setup(options);
      const scheduler = createScheduler(env.ctx);
      await scheduler.tick(env.now.value);
      expect(archives(env.dir), JSON.stringify(options)).toHaveLength(0);
      const status = await scheduler.status(env.now.value);
      const expected =
        'enabled' in options
          ? 'switched_off'
          : options.passphrase === undefined
            ? 'passphrase_missing'
            : options.passphrase === 'short'
              ? 'passphrase_too_short'
              : 'passphrase_placeholder';
      expect(status.problems, JSON.stringify(options)).toContain(expected);
      expect(status.nextRunAt).toBeNull();
    }
  }, 120_000);

  it('follows the settings in the database: off, weekly, and the time zone', async () => {
    const off = await setup({ settings: { 'backup.schedule': 'off' } });
    await createScheduler(off.ctx).tick(off.now.value);
    expect(archives(off.dir)).toHaveLength(0);
    expect((await createScheduler(off.ctx).status(off.now.value)).problems).toContain('schedule_off');

    // Weekly on Sundays at 03:00 Berlin time. Saturday 10:00Z: the last Sunday run (the 8th) is due.
    const weekly = await setup({
      settings: { 'backup.schedule': 'weekly', 'backup.weekday': 0, time_zone: 'Europe/Berlin' },
    });
    const scheduler = createScheduler(weekly.ctx);
    expect((await scheduler.status(weekly.now.value)).nextRunAt).toBe('2026-11-15T02:00:00.000Z');
    await scheduler.tick(weekly.now.value);
    expect(archives(weekly.dir)).toHaveLength(1);

    // Not yet: a Sunday at 02:30Z is 03:30 in Berlin, so it is past 03:00 and due; at 00:30Z it is not.
    const early = await setup({
      settings: {
        'backup.schedule': 'weekly',
        'backup.weekday': 0,
        time_zone: 'Europe/Berlin',
        'backup.keep_daily': 2,
      },
    });
    const s2 = createScheduler(early.ctx);
    early.now.value = new Date('2026-11-15T00:30:00Z');
    await s2.tick(early.now.value);
    expect(archives(early.dir)).toHaveLength(1); // the previous Sunday (the 8th) was due and not made yet
    early.now.value = new Date('2026-11-15T02:30:00Z');
    await s2.tick(early.now.value);
    // Both runs happened (the older archive of the same Berlin day was then removed by retention, as it should be).
    expect(readState(early.dir).runs.filter((r) => r.ok)).toHaveLength(2);
    expect(archives(early.dir)).toEqual(['kinship-2026-11-15-0230.tar.enc']);
  }, 180_000);

  it('does not test the backup when that switch is off, and removes old backups after a good one', async () => {
    const env = await setup({
      settings: {
        'backup.test_after': false,
        'backup.keep_daily': 1,
        'backup.keep_weekly': 0,
        'backup.keep_monthly': 0,
      },
    });
    for (const name of ['kinship-2026-11-10-0300.tar.enc', 'kinship-2026-11-11-0300.tar.enc'])
      writeFileSync(join(env.dir, name), 'x');
    writeFileSync(join(env.dir, 'my-own-notes.txt'), 'keep me');
    const scheduler = createScheduler(env.ctx);
    await scheduler.tick(env.now.value);
    expect(readState(env.dir).lastTest).toBeNull();
    expect(archives(env.dir)).toHaveLength(1);
    expect(archives(env.dir)[0]).not.toMatch(/2026-11-1[01]/);
    expect(readFileSync(join(env.dir, 'my-own-notes.txt'), 'utf8')).toBe('keep me');
  }, 120_000);

  it('a failed backup removes nothing: retention runs only after a good one', async () => {
    const env = await setup({
      settings: { 'backup.keep_daily': 1, 'backup.keep_weekly': 0, 'backup.keep_monthly': 0 },
    });
    for (const name of ['kinship-2026-11-10-0300.tar.enc', 'kinship-2026-11-11-0300.tar.enc'])
      writeFileSync(join(env.dir, name), 'x');
    const failing: BackupContext = { ...env.ctx, freeBytes: () => 0 };
    await createScheduler(failing).tick(env.now.value);
    expect(archives(env.dir).sort()).toEqual(['kinship-2026-11-10-0300.tar.enc', 'kinship-2026-11-11-0300.tar.enc']);
  }, 120_000);
});

describe('one at a time', () => {
  it('two api containers ticking together make exactly one backup', async () => {
    const env = await setup();
    const a = createScheduler(env.ctx);
    const b = createScheduler(env.ctx);
    await Promise.all([a.tick(env.now.value), b.tick(env.now.value)]);
    expect(archives(env.dir)).toHaveLength(1);
    expect(readState(env.dir).runs.filter((r) => r.ok)).toHaveLength(1);
    expect(readState(env.dir).runs.filter((r) => !r.ok)).toHaveLength(0);
  }, 120_000);

  it('the command line and the schedule do not overlap: the loser is told it is busy, not failed', async () => {
    const env = await setup({ settings: { 'backup.test_after': false } });
    const scheduler = createScheduler(env.ctx);
    const results = await Promise.allSettled([
      createBackup(env.ctx, { kind: 'manual' }),
      scheduler.tick(env.now.value),
      createBackup(env.ctx, { kind: 'manual' }),
    ]);
    const busy = results.filter((r) => r.status === 'rejected' && (r.reason as BackupError).kind === 'busy');
    expect(busy.length).toBeGreaterThanOrEqual(1);
    expect(readState(env.dir).runs.filter((r) => !r.ok)).toHaveLength(0);
    for (const name of archives(env.dir)) expect(name).toMatch(/^kinship-/);
  }, 120_000);

  it('the Admin button cannot start a second one in the same api', async () => {
    const env = await setup({ settings: { 'backup.test_after': false } });
    const scheduler = createScheduler(env.ctx);
    const [first, second] = await Promise.allSettled([scheduler.runNow(), scheduler.runNow()]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toMatchObject({ kind: 'busy' });
  }, 120_000);
});

describe('when the disk fills up', () => {
  it('refuses before starting when there is not enough room, and leaves no temporary file', async () => {
    const env = await setup();
    const scheduler = createScheduler({ ...env.ctx, freeBytes: () => 0 });
    await scheduler.tick(env.now.value);
    expect(readState(env.dir).runs[0]).toMatchObject({ ok: false, errorKind: 'disk_space' });
    expect(readdirSync(env.dir).filter((n) => n !== 'state.json')).toEqual([]);
  }, 120_000);

  it('cleans up when the disk fills while writing (tar fails with "No space left on device")', async () => {
    const env = await setup();
    const tar = join(mkdtempSync(join(tmpdir(), 'kinship-tar-')), 'tar');
    cleanups.push(() => rmSync(join(tar, '..'), { recursive: true, force: true }));
    writeFileSync(
      tar,
      '#!/bin/sh\nhead -c 5000 /dev/zero\necho "tar: write error: No space left on device" >&2\nexit 1\n',
    );
    chmodSync(tar, 0o755);
    const scheduler = createScheduler({ ...env.ctx, tools: { ...env.ctx.tools, tar } });
    await scheduler.tick(env.now.value);
    expect(readState(env.dir).runs[0]).toMatchObject({ ok: false, errorKind: 'disk_space' });
    expect(readdirSync(env.dir).filter((n) => n !== 'state.json')).toEqual([]);
  }, 120_000);
});

describe('what the Admin page is told', () => {
  it('a healthy install, then each problem in turn', async () => {
    const env = await setup();
    const scheduler = createScheduler(env.ctx);
    let status = await scheduler.status(env.now.value);
    expect(status).toMatchObject({
      enabled: true,
      passphrase: 'ok',
      folderWritable: true,
      running: false,
      lastSuccessAt: null,
      nextRunAt: '2026-11-15T03:00:00.000Z',
    });
    expect(status.problems).toEqual(['never_backed_up']);
    await scheduler.tick(env.now.value);
    status = await scheduler.status(env.now.value);
    expect(status.healthy).toBe(true);
    expect(status.problems).toEqual([]);
    expect(status.lastSuccessAt).toBe('2026-11-14T10:00:00.000Z');
    expect(status.lastTest).toMatchObject({ ok: true });
    // Two days later with no run: overdue.
    advance(env, 3 * 86_400_000);
    expect((await scheduler.status(env.now.value)).problems).toContain('overdue');
    // The folder cannot be written.
    const unwritable = createScheduler({
      ...env.ctx,
      config: { ...env.ctx.config, backup: { ...env.ctx.config.backup, dir: join(env.dir, 'state.json', 'nope') } },
    });
    expect((await unwritable.status(env.now.value)).problems).toContain('folder_not_writable');
    // The status never carries the passphrase.
    expect(JSON.stringify(await scheduler.status(env.now.value))).not.toContain(PASS);
  }, 120_000);

  it('a failed test of the new backup is shown', async () => {
    const env = await setup();
    const bad = join(mkdtempSync(join(tmpdir(), 'kinship-psql-')), 'psql');
    cleanups.push(() => rmSync(join(bad, '..'), { recursive: true, force: true }));
    writeFileSync(
      bad,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\ncat >/dev/null; echo "no" >&2; exit 1\n',
    );
    chmodSync(bad, 0o755);
    const scheduler = createScheduler({ ...env.ctx, tools: { ...env.ctx.tools, psql: bad } });
    await scheduler.tick(env.now.value);
    // The backup itself was made; the test could not run, which is logged and leaves the last test as it was.
    expect(archives(env.dir)).toHaveLength(1);
    expect(env.logs.some((l) => l.message === 'the new backup could not be tested')).toBe(true);
  }, 120_000);
});

describe('start-up housekeeping', () => {
  it('drops test databases a cut-short test left, and keeps the real one', async () => {
    const env = await setup();
    await sql`create database ${sql.id(`${verifyPrefix(env.test.config.name)}old1`)}`.execute(env.test.owner);
    await backupHousekeeping(env.ctx);
    const left = await sql<{
      datname: string;
    }>`select datname from pg_database where datname like ${`${verifyPrefix(env.test.config.name)}%`}`.execute(
      env.test.owner,
    );
    expect(left.rows).toEqual([]);
    expect(existsSync(env.dir)).toBe(true);
  }, 60_000);
});
