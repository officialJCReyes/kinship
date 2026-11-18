// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createBackup, openArchive } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { BackupError } from '../src/backup/errors.js';
import { fingerprint, listTables, tableStats } from '../src/backup/inspect.js';
import { restoreBackup } from '../src/backup/restore.js';
import type { RestoreHooks } from '../src/backup/restore.js';
import type { Tools } from '../src/backup/tools.js';
import { sweepVerifyDatabases, verifyBackup, verifyPrefix } from '../src/backup/verify.js';
import { runCli } from '../src/cli.js';
import type { CliDeps } from '../src/cli.js';
import type { UntypedDb } from '../src/db.js';
import { createAppDb, createDb } from '../src/db.js';
import type { AnySchema } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

/** The newest migration number. Never write the last number into a test: a later migration moves it. */
const LATEST = readdirSync(realMigrationsDir).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length;

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(() => undefined);

const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-restore-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

interface Live {
  test: TestDatabase;
  dir: string;
  ctx: BackupContext;
  family: Awaited<ReturnType<typeof buildFamily>>;
}

/** A migrated test database with the Hale family, an open invitation and a session, and a backups folder. */
async function live(options: { migrationsDir?: string; upTo?: number } = {}): Promise<Live> {
  const test = await createTestDatabase();
  cleanups.push(() => test.cleanup());
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  const migrationsDir = options.migrationsDir ?? realMigrationsDir;
  await runMigrations(test.owner, { dir: migrationsDir, appRole: test.config.appUser });
  const family = await buildFamily(test.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
  await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
            values (${family.account.member.id}, 'a-session-hash', now() + interval '1 day', now() + interval '2 days')`.execute(
    test.owner,
  );
  if (!options.upTo || options.upTo >= 11) {
    await sql`insert into account_links (kind, token_hash, expires_at, email, role, created_by)
              values ('invite', 'a-link-hash', now() + interval '7 days', 'new@example.com', 'member', ${family.account.superadmin.id})`.execute(
      test.owner,
    );
  }
  const dir = folder();
  const config = { ...testConfig(test, dir, PASS), migrationsDir };
  return {
    test,
    dir,
    family,
    ctx: { config, tools: testTools(), log: () => undefined, appVersion: '0.2.0-test', kdf: CHEAP },
  };
}

const hooks = (answer = true): RestoreHooks & { messages: string[] } => {
  const messages: string[] = [];
  return { messages, progress: (m) => messages.push(m), confirm: () => Promise.resolve(answer) };
};

/** Everything that identifies the state of the database: every table's rows and digests, the protections, the schema. */
async function state(owner: UntypedDb, appRole: string) {
  const stats = await owner.transaction().execute((trx) => tableStats(trx));
  const schema = (await sql<{ n: number }>`select schema_number as n from schema_info`.execute(owner)).rows[0]?.n;
  return { stats, fingerprint: await fingerprint(owner, appRole), schema, tables: await listTables(owner) };
}

const withTools = (ctx: BackupContext, tools: Partial<Tools>): BackupContext => ({
  ...ctx,
  tools: { ...ctx.tools, ...tools },
});

/** A fake tool. `--version` still reaches the real one (the restore asks for it before it starts). */
function wrapper(script: string, real?: string): string {
  const path = join(folder(), 'tool');
  const version = real ? `if [ "$1" = "--version" ]; then exec '${real}' --version; fi\n` : '';
  writeFileSync(path, `#!/bin/sh\n${version}${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe('restoring a backup over a live database', () => {
  it('puts everything back, signs everyone out, cancels open links, and keeps a safety copy', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);

    // Things happen after the backup.
    await sql`delete from person_parents`.execute(l.test.owner);
    await sql`delete from unions`.execute(l.test.owner);
    await sql`delete from people where given_name = 'Leo'`.execute(l.test.owner);
    await sql`insert into people (given_name, surname) values ('Added', 'Later')`.execute(l.test.owner);
    await sql`update users set display_name = 'Changed' where id = ${l.family.account.member.id}`.execute(l.test.owner);
    expect(
      Number((await sql<{ n: string }>`select count(*)::text as n from people`.execute(l.test.owner)).rows[0]?.n),
    ).toBe(11);

    // The running version was newer than the backup's: the restore is a step down, and the log says so.
    await sql`update schema_info set app_version = '0.2.1-test'`.execute(l.test.owner);

    const h = hooks();
    const report = await restoreBackup(l.ctx, made.path, h);
    expect(report).toMatchObject({ cancelled: false, migrationsApplied: [] });
    expect(report.safetyCopy).toMatch(/^pre-restore-\d{8}-\d{6}\.tar\.enc$/);
    expect(existsSync(join(l.dir, report.safetyCopy as string))).toBe(true);

    // The data is the backup's again (the session and link tables are reset on purpose; upgrade_log and schema_info gain a record).
    const after = await state(l.test.owner, l.test.config.appUser);
    const same = [
      'people',
      'unions',
      'person_parents',
      'users',
      'family_tree',
      'relationship_labels',
      'kysely_migration',
      'kinship_migration_checksum',
    ];
    for (const table of same) expect(after.stats[table], table).toEqual(before.stats[table]);
    expect(after.fingerprint).toEqual(before.fingerprint);
    expect(after.schema).toBe(before.schema);
    expect(after.tables).toEqual(before.tables);

    expect((await sql`select * from sessions`.execute(l.test.owner)).rows).toHaveLength(0);
    const links = await sql<{ revoked_at: Date | null }>`select revoked_at from account_links`.execute(l.test.owner);
    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]?.revoked_at).toBeInstanceOf(Date);
    const log = await sql<
      Record<string, unknown>
    >`select event, from_schema, to_schema, from_version, to_version, backup_version, safety_copy from upgrade_log`.execute(
      l.test.owner,
    );
    expect(log.rows).toEqual([
      {
        event: 'restore',
        from_schema: before.schema,
        to_schema: before.schema,
        // from_version is what was running before, backup_version is what the backup came from.
        from_version: '0.2.1-test',
        to_version: '0.2.0-test',
        backup_version: '0.2.0-test',
        safety_copy: report.safetyCopy,
      },
    ]);
    const info = await sql<{ app_version: string }>`select app_version from schema_info`.execute(l.test.owner);
    expect(info.rows[0]?.app_version).toBe('0.2.0-test');

    // The safety copy is a real archive of the state before the restore: 'Added Later' is in it.
    const safety = await openArchive(join(l.dir, report.safetyCopy as string), PASS, testTools(), l.dir);
    try {
      expect(safety.manifest.kind).toBe('pre-restore');
      // It holds the state from just before the restore ('Added Later' was there), not the backup's.
      expect(safety.manifest.tables['people']?.digest).not.toEqual(made.manifest.tables['people']?.digest);
    } finally {
      safety.cleanup();
    }

    // The app role is still not an owner, and row-level security still hides everything from nobody.
    const app = createAppDb(l.test.config);
    cleanups.push(() => app.destroy());
    expect((await sql<{ n: string }>`select count(*)::text as n from people`.execute(app)).rows[0]?.n).toBe('0');
    const asAdmin = await app.transaction().execute(async (trx) => {
      await sql`select set_config('kinship.user_id', ${l.family.account.superadmin.id}, true)`.execute(trx);
      return (await sql<{ n: string }>`select count(*)::text as n from people`.execute(trx)).rows[0]?.n;
    });
    expect(asAdmin).toBe('11');
    const role = await sql<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>`select rolsuper, rolbypassrls from pg_roles where rolname = ${l.test.config.appUser}`.execute(l.test.owner);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(h.messages.join('\n')).toContain('Replacing the database in one transaction');
  }, 90_000);

  it('stops when the person says no, and changes nothing', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);
    const report = await restoreBackup(l.ctx, made.path, hooks(false));
    expect(report.cancelled).toBe(true);
    expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);
    expect(readdirSync(l.dir).filter((n) => n.startsWith('pre-restore'))).toEqual([]);
  }, 60_000);
});

describe('a restore that fails leaves the database exactly as it was', () => {
  const real = () => testTools();

  // Each case breaks the restore at a different stage. After every one the whole state must be identical.
  const cases: Array<[string, (ctx: BackupContext) => BackupContext, RegExp]> = [
    [
      'pg_restore fails at once',
      (ctx) =>
        withTools(ctx, {
          pgRestore: wrapper('cat >/dev/null; echo "cannot read the dump" >&2; exit 1', real().pgRestore),
        }),
      /pg_restore/,
    ],
    ...[300, 4000, 20000, 60000].map((n): [string, (ctx: BackupContext) => BackupContext, RegExp] => [
      `pg_restore stops after ${n} bytes and reports failure`,
      (ctx) =>
        withTools(ctx, { pgRestore: wrapper(`'${real().pgRestore}' "$@" | head -c ${n}; exit 1`, real().pgRestore) }),
      /pg_restore/,
    ]),
    ...[2000, 15000, 50000].map((n): [string, (ctx: BackupContext) => BackupContext, RegExp] => [
      `pg_restore stops after ${n} bytes and claims success (the checks inside the transaction catch it)`,
      (ctx) =>
        withTools(ctx, { pgRestore: wrapper(`'${real().pgRestore}' "$@" | head -c ${n}; exit 0`, real().pgRestore) }),
      /psql|rows|exception|syntax|error/i,
    ]),
    [
      'psql dies before reading anything',
      (ctx) => withTools(ctx, { psql: wrapper('echo "psql is broken" >&2; exit 1') }),
      /psql/,
    ],
    [
      'psql dies after the first statements',
      (ctx) => withTools(ctx, { psql: wrapper(`head -c 300 >/dev/null; echo "died" >&2; exit 2`) }),
      /psql/,
    ],
  ];

  it.each(cases)(
    '%s',
    async (_name, break_, pattern) => {
      const l = await live();
      const made = await createBackup(l.ctx, { kind: 'manual' });
      const before = await state(l.test.owner, l.test.config.appUser);
      const failure = await restoreBackup(break_(l.ctx), made.path, hooks()).catch((e: unknown) => e as Error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(pattern);
      expect((failure as Error).message).not.toContain(l.test.config.ownerPassword);
      expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);
      // Sessions and links were not touched either.
      expect((await sql`select * from sessions`.execute(l.test.owner)).rows).toHaveLength(1);
      expect(
        (await sql<{ revoked_at: Date | null }>`select revoked_at from account_links`.execute(l.test.owner)).rows[0]
          ?.revoked_at,
      ).toBeNull();
      expect((await sql`select * from upgrade_log`.execute(l.test.owner)).rows).toHaveLength(0);
    },
    90_000,
  );

  it('a check inside the transaction (different protections than the backup) rolls everything back', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);
    // A replay that quietly weakens a table: row-level security no longer forced. The fingerprint check inside the
    // transaction must refuse to commit it.
    const weakened = withTools(l.ctx, {
      pgRestore: wrapper(
        `'${real().pgRestore}' "$@"; echo 'ALTER TABLE public.people NO FORCE ROW LEVEL SECURITY;'`,
        real().pgRestore,
      ),
    });
    await expect(restoreBackup(weakened, made.path, hooks())).rejects.toThrow(
      /different protections.*tableGrants|different protections.*tables/s,
    );
    expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);
  }, 90_000);
});

describe('what a restore refuses before it touches anything', () => {
  it('a wrong passphrase, a damaged file and a cut file', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);
    const wrongPass = {
      ...l.ctx,
      config: { ...l.ctx.config, backup: { ...l.ctx.config.backup, passphrase: 'not the right one at all' } },
    };
    await expect(restoreBackup(wrongPass, made.path, hooks())).rejects.toMatchObject({ code: 'wrong_passphrase' });
    const bytes = readFileSync(made.path);
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 50] = (flipped[flipped.length - 50] ?? 0) ^ 1;
    writeFileSync(join(l.dir, 'flipped.tar.enc'), flipped);
    await expect(restoreBackup(l.ctx, join(l.dir, 'flipped.tar.enc'), hooks())).rejects.toMatchObject({
      code: 'corrupt',
    });
    writeFileSync(join(l.dir, 'cut.tar.enc'), bytes.subarray(0, bytes.length - 200));
    await expect(restoreBackup(l.ctx, join(l.dir, 'cut.tar.enc'), hooks())).rejects.toBeDefined();
    expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);
    expect(readdirSync(l.dir).filter((n) => n.startsWith('.') || n.startsWith('pre-restore'))).toEqual([]);
  }, 90_000);

  it('a backup from a newer schema than this image knows', async () => {
    const l = await live();
    const older = await tempMigrationsDir(true);
    cleanups.push(() => older.remove());
    await removeMigrationsFrom(older.dir, LATEST);
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);
    const oldImage = { ...l.ctx, config: { ...l.ctx.config, migrationsDir: older.dir } };
    const failure = await restoreBackup(oldImage, made.path, hooks()).catch((e: unknown) => e as BackupError);
    expect((failure as BackupError).kind).toBe('refused');
    expect((failure as BackupError).message).toMatch(
      new RegExp(`newer KinShip.*schema ${LATEST}.*only knows schema ${LATEST - 1}`),
    );
    expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);
  }, 90_000);

  it('different database role names', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const other = { ...l.ctx, config: { ...l.ctx.config, db: { ...l.ctx.config.db, appUser: 'some_other_app' } } };
    await expect(restoreBackup(other, made.path, hooks())).rejects.toThrow(/DB_APP_USER/);
  }, 60_000);

  it('KinShip still running: the app role has open connections', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const app = createAppDb(l.test.config);
    cleanups.push(() => app.destroy());
    await sql`select 1`.execute(app);
    const failure = await restoreBackup(l.ctx, made.path, hooks()).catch((e: unknown) => e as BackupError);
    expect((failure as BackupError).kind).toBe('refused');
    expect((failure as BackupError).message).toContain('docker compose stop web api');
    await app.destroy();
  }, 60_000);

  it('only one at a time', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const results = await Promise.allSettled([
      restoreBackup(l.ctx, made.path, hooks()),
      restoreBackup(l.ctx, made.path, hooks()),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of results)
      if (r.status === 'rejected') expect((r.reason as BackupError).kind).toMatch(/busy|refused|tool/);
  }, 90_000);
});

describe('restoring a backup from an older schema', () => {
  it('replays it and then runs the newer migrations, in their own transaction', async () => {
    const older = await tempMigrationsDir(true);
    cleanups.push(() => older.remove());
    await removeMigrationsFrom(older.dir, 11);
    const l = await live({ migrationsDir: older.dir, upTo: 10 });
    const oldCtx = l.ctx;
    const made = await createBackup(oldCtx, { kind: 'manual' });
    expect(made.manifest.schema).toBe(10);
    const peopleBefore = made.manifest.tables['people'];
    expect(made.manifest.tables['account_links']).toBeUndefined();

    // The installation moves on: the newest migrations are applied and more data is added.
    await cp(realMigrationsDir, older.dir, { recursive: true });
    await runMigrations(l.test.owner, { dir: older.dir, appRole: l.test.config.appUser });
    await sql`insert into people (given_name, surname) values ('Added', 'Later')`.execute(l.test.owner);

    const newImage: BackupContext = { ...oldCtx, config: { ...oldCtx.config, migrationsDir: realMigrationsDir } };
    const report = await restoreBackup(newImage, made.path, hooks());
    expect(report.migrationsApplied).toEqual(
      readdirSync(realMigrationsDir)
        .filter((n) => /^\d{4}_.*\.sql$/.test(n) && Number(n.slice(0, 4)) >= 11)
        .map((n) => n.replace(/\.sql$/, ''))
        .sort(),
    );
    const after = await state(l.test.owner, l.test.config.appUser);
    expect(after.schema).toBe(LATEST);
    // The row count, not the digest: a later migration adds columns to people, and the digest is over whole rows.
    expect(after.stats['people']?.rows).toBe(peopleBefore?.rows);
    expect(after.tables).toEqual(expect.arrayContaining(['account_links', 'app_settings', 'upgrade_log']));
    const log = await sql<{
      from_schema: number;
      to_schema: number;
    }>`select from_schema, to_schema from upgrade_log`.execute(l.test.owner);
    expect(log.rows).toEqual([{ from_schema: 10, to_schema: LATEST }]);
  }, 120_000);

  it('a failing newer migration leaves a valid database at the older schema', async () => {
    const older = await tempMigrationsDir(true);
    cleanups.push(() => older.remove());
    await removeMigrationsFrom(older.dir, 13);
    const l = await live({ migrationsDir: older.dir });
    const made = await createBackup(l.ctx, { kind: 'manual' });
    await older.add('0013_will_fail.sql', 'SELECT 1/0;\n');
    const failure = await restoreBackup(l.ctx, made.path, hooks()).catch((e: unknown) => e as Error);
    expect((failure as Error).message).toMatch(/Migration failed and was rolled back/);
    const after = await state(l.test.owner, l.test.config.appUser);
    expect(after.schema).toBe(12);
    expect(after.stats['people']?.rows).toBe(11);
  }, 120_000);
});

describe('restoring onto a brand-new, empty Postgres (disaster recovery)', () => {
  it('recreates the app role, replays everything, and the app role works', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const expected = await state(l.test.owner, l.test.config.appUser);
    const peopleIds = (await sql<{ id: string }>`select id from people order by id`.execute(l.test.owner)).rows.map(
      (r) => r.id,
    );
    // The old server is gone: no database, and no app role either.
    await l.test.cleanup();
    cleanups.length = 0;
    const admin = createDb<AnySchema>(
      { host: l.test.config.host, port: l.test.config.port, name: 'postgres' },
      l.test.config.ownerUser,
      l.test.config.ownerPassword,
      1,
    );
    const fresh = `kinship_dr_${Math.random().toString(16).slice(2, 10)}`;
    cleanups.push(async () => {
      await sql`drop database if exists ${sql.id(fresh)} with (force)`.execute(admin);
      await sql`drop role if exists ${sql.id(l.test.config.appUser)}`.execute(admin);
      await admin.destroy();
    });
    await sql`create database ${sql.id(fresh)}`.execute(admin);
    expect(
      (await sql`select 1 from pg_roles where rolname = ${l.test.config.appUser}`.execute(admin)).rows,
    ).toHaveLength(0);

    const newConfig = { ...l.ctx.config, db: { ...l.ctx.config.db, name: fresh } };
    const h = hooks();
    const report = await restoreBackup({ ...l.ctx, config: newConfig }, made.path, h);
    expect(report).toMatchObject({ cancelled: false, safetyCopy: null });
    expect(h.messages.join('\n')).toContain('The database is empty: no safety copy to make.');

    const owner = createDb<AnySchema>(newConfig.db, newConfig.db.ownerUser, newConfig.db.ownerPassword, 2);
    cleanups.push(() => owner.destroy());
    const after = await state(owner, newConfig.db.appUser);
    expect(after.fingerprint).toEqual(expected.fingerprint);
    expect(after.schema).toBe(expected.schema);
    expect(after.stats['people']).toEqual(expected.stats['people']);
    expect((await sql<{ id: string }>`select id from people order by id`.execute(owner)).rows.map((r) => r.id)).toEqual(
      peopleIds,
    );
    const log = await sql<{ safety_note: string | null }>`select safety_note from upgrade_log`.execute(owner);
    expect(log.rows).toEqual([{ safety_note: 'fresh_install' }]);

    const app = createAppDb(newConfig.db);
    cleanups.push(() => app.destroy());
    const seen = await app.transaction().execute(async (trx) => {
      await sql`select set_config('kinship.user_id', ${l.family.account.superadmin.id}, true)`.execute(trx);
      return (await sql<{ n: string }>`select count(*)::text as n from people`.execute(trx)).rows[0]?.n;
    });
    expect(seen).toBe('11');
  }, 120_000);
});

describe('the restore command line', () => {
  const output = (config: BackupContext['config'], tools: Tools, ask?: string | null) => {
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
        config: () => config,
        tools,
        env: { BACKUP_DIR: config.backup.dir, BACKUP_PASSPHRASE: PASS },
        ...(ask !== undefined ? { ask: () => Promise.resolve(ask) } : {}),
      },
    };
    return { out, err, deps };
  };

  it('never executes a plain .sql.gz safety copy', async () => {
    const l = await live();
    writeFileSync(join(l.dir, 'pre-upgrade-0012-to-0013.sql.gz'), 'DROP SCHEMA public CASCADE;');
    const { err, deps } = output(l.ctx.config, l.ctx.tools);
    expect(await runCli(['restore', 'pre-upgrade-0012-to-0013.sql.gz', '--yes'], deps)).toBe(1);
    expect(err.join('\n')).toMatch(/never restored here/);
    expect(await runCli(['restore', join(l.dir, 'dump.sql'), '--yes'], deps)).toBe(1);
  }, 60_000);

  it('asks for the word RESTORE, and a wrong answer changes nothing; --yes skips the question', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);
    const wrong = output(l.ctx.config, l.ctx.tools, 'restore');
    expect(await runCli(['restore', made.name], wrong.deps)).toBe(1);
    expect(wrong.err.join('\n')).toContain('Nothing was changed');
    const none = output(l.ctx.config, l.ctx.tools);
    expect(await runCli(['restore', made.name], none.deps)).toBe(1);
    expect(none.err.join('\n')).toContain('--yes');
    expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);

    const right = output(l.ctx.config, l.ctx.tools, 'RESTORE');
    expect(await runCli(['restore', made.name], right.deps)).toBe(0);
    expect(right.out.join('\n')).toContain('REPLACES EVERYTHING');
    expect(right.out.join('\n')).toContain('Start KinShip again');
    const yes = output(l.ctx.config, l.ctx.tools);
    expect(await runCli(['restore', made.name, '--yes'], yes.deps)).toBe(0);
  }, 120_000);
});

describe('testing a backup (restore into a temporary database)', () => {
  const leftovers = async (l: Live) =>
    (
      await sql<{
        datname: string;
      }>`select datname from pg_database where left(datname, 22) = ${verifyPrefix(l.test.config.name)}`.execute(
        l.test.owner,
      )
    ).rows;

  it('restores into a temporary database, checks it, and throws it away', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const before = await state(l.test.owner, l.test.config.appUser);
    const result = await verifyBackup(l.ctx, made.path);
    expect(result).toMatchObject({ mode: 'restore', ok: true });
    expect(result.checks.every((c) => c.ok)).toBe(true);
    expect(result.checks.map((c) => c.name).join('\n')).toMatch(/app role reads the people/);
    expect(result.tables).toBeGreaterThan(10);
    expect(await leftovers(l)).toEqual([]);
    expect(await state(l.test.owner, l.test.config.appUser)).toEqual(before);
    expect(readdirSync(l.dir).filter((n) => n.startsWith('.'))).toEqual([]);
  }, 90_000);

  it('says so when the backup came from a different build of the migrations', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const other = await tempMigrationsDir(true);
    cleanups.push(() => other.remove());
    const file = join(other.dir, '0005_account_link_and_access.sql');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- edited\n`);
    const result = await verifyBackup({ ...l.ctx, config: { ...l.ctx.config, migrationsDir: other.dir } }, made.path);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => !c.ok)).toMatchObject({
      name: expect.stringMatching(/migrations match/) as string,
      detail: expect.stringMatching(/0005_account_link_and_access differs/) as string,
    });
    expect(await leftovers(l)).toEqual([]);
  }, 90_000);

  it('drops the temporary database even when the replay fails', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    await expect(
      verifyBackup(withTools(l.ctx, { psql: wrapper('echo broken >&2; exit 1') }), made.path),
    ).rejects.toThrow(/psql/);
    expect(await leftovers(l)).toEqual([]);
  }, 90_000);

  it('refuses a wrong passphrase, and one test at a time', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    await expect(
      verifyBackup(
        {
          ...l.ctx,
          config: { ...l.ctx.config, backup: { ...l.ctx.config.backup, passphrase: 'a different passphrase here' } },
        },
        made.path,
      ),
    ).rejects.toMatchObject({ code: 'wrong_passphrase' });
    const both = await Promise.allSettled([verifyBackup(l.ctx, made.path), verifyBackup(l.ctx, made.path)]);
    expect(both.some((r) => r.status === 'fulfilled')).toBe(true);
    for (const r of both) if (r.status === 'rejected') expect((r.reason as BackupError).kind).toBe('busy');
  }, 120_000);

  it('sweeps temporary databases a cut-short test left behind', async () => {
    const l = await live();
    const admin = createDb<AnySchema>(
      { host: l.test.config.host, port: l.test.config.port, name: 'postgres' },
      l.test.config.ownerUser,
      l.test.config.ownerPassword,
      1,
    );
    cleanups.push(() => admin.destroy());
    const prefix = verifyPrefix(l.test.config.name);
    const other = verifyPrefix('some_other_installation');
    await sql`create database ${sql.id(`${prefix}leftover1`)}`.execute(l.test.owner);
    await sql`create database ${sql.id(`${prefix}leftover2`)}`.execute(l.test.owner);
    // Another installation's temporary database is not ours to drop.
    await sql`create database ${sql.id(`${other}leftover`)}`.execute(l.test.owner);
    cleanups.push(async () => {
      await sql`drop database if exists ${sql.id(`${other}leftover`)}`.execute(admin);
    });
    const dropped = await sweepVerifyDatabases(l.ctx);
    expect(dropped.sort()).toEqual([`${prefix}leftover1`, `${prefix}leftover2`]);
    expect(
      (await sql`select 1 from pg_database where datname = ${`${other}leftover`}`.execute(l.test.owner)).rows,
    ).toHaveLength(1);
    expect(await leftovers(l)).toEqual([]);
  }, 60_000);

  it('the command line does the full test with --full', async () => {
    const l = await live();
    const made = await createBackup(l.ctx, { kind: 'manual' });
    const out: string[] = [];
    const deps: CliDeps = {
      openDb: () => l.test.owner,
      readPassword: () => Promise.resolve(''),
      out: (t) => out.push(t),
      err: () => undefined,
      backup: { config: () => l.ctx.config, tools: l.ctx.tools, env: { BACKUP_DIR: l.dir, BACKUP_PASSPHRASE: PASS } },
    };
    expect(await runCli(['backup-verify', made.name, '--full'], deps)).toBe(0);
    expect(out.join('\n')).toMatch(/ok\s+Restored into a temporary database/);
  }, 90_000);
});
