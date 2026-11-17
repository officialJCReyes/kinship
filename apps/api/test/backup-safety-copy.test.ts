// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { openArchive } from '../src/backup/archive.js';
import { SafetyCopyError, migrateWithSafetyCopy } from '../src/backup/upgrade.js';
import type { UpgradeContext } from '../src/backup/upgrade.js';
import type { DbConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import type { AnySchema, UntypedDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase, server } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-upgrade-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

interface Env {
  test: TestDatabase;
  dir: string;
  ctx: UpgradeContext;
  logs: Array<{ level: string; message: string }>;
  migrationsDir: string;
}

/** A database migrated up to `upTo` (0 means: empty, nothing applied) with the Hale family, ready to be upgraded. */
async function database(options: {
  upTo: number;
  passphrase?: string | undefined;
  extra?: Record<string, string>;
  populate?: boolean;
}): Promise<Env> {
  const test = await createTestDatabase();
  cleanups.push(() => test.cleanup());
  const full = await tempMigrationsDir(true);
  cleanups.push(() => full.remove());
  for (const [name, text] of Object.entries(options.extra ?? {})) await full.add(name, text);
  if (options.upTo > 0) {
    const partial = await tempMigrationsDir(true);
    cleanups.push(() => partial.remove());
    await removeMigrationsFrom(partial.dir, options.upTo + 1);
    await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
    await runMigrations(test.owner, { dir: partial.dir, appRole: test.config.appUser });
    if (options.populate !== false) {
      await buildFamily(test.owner);
      await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
    }
  }
  const dir = folder();
  const logs: Env['logs'] = [];
  const config = testConfig(test, dir, 'passphrase' in options ? options.passphrase : PASS);
  const ctx: UpgradeContext = {
    config: { ...config, migrationsDir: full.dir },
    tools: testTools(),
    log: (level, message) => logs.push({ level, message }),
    appVersion: '0.2.0-test',
    kdf: CHEAP,
  };
  return { test, dir, ctx, logs, migrationsDir: full.dir };
}

const schema = async (env: Env) =>
  Number((await sql<{ n: number }>`select schema_number as n from schema_info`.execute(env.test.owner)).rows[0]?.n);
const copies = (dir: string) => readdirSync(dir).filter((n) => n.startsWith('pre-upgrade'));
const log = (env: Env) =>
  sql<
    Record<string, unknown>
  >`select event, from_schema, to_schema, from_version, to_version, safety_copy, safety_note from upgrade_log`.execute(
    env.test.owner,
  );

describe('a database change on a database that has data', () => {
  it('writes an encrypted safety copy first, then migrates, and records both', async () => {
    const env = await database({ upTo: 12 });
    const before = Number(
      (await sql<{ n: string }>`select count(*)::text as n from people`.execute(env.test.owner)).rows[0]?.n,
    );
    const result = await migrateWithSafetyCopy(env.ctx);
    expect(result).toMatchObject({
      applied: ['0013_backup_settings_and_upgrade_log'],
      safetyCopy: 'pre-upgrade-0012-to-0013.tar.enc',
      safetyNote: null,
      fromSchema: 12,
      toSchema: 13,
    });
    expect(copies(env.dir)).toEqual(['pre-upgrade-0012-to-0013.tar.enc']);
    expect((statSync(join(env.dir, copies(env.dir)[0] as string)).mode & 0o777).toString(8)).toBe('600');
    expect(await schema(env)).toBe(13);

    // The copy is the database BEFORE the change: schema 12, no upgrade_log table in it, all the people.
    const archive = await openArchive(join(env.dir, copies(env.dir)[0] as string), PASS, testTools(), env.dir);
    try {
      expect(archive.manifest).toMatchObject({ kind: 'pre-upgrade', schema: 12 });
      expect(archive.manifest.tables['people']?.rows).toBe(before);
      expect(archive.manifest.tables['upgrade_log']).toBeUndefined();
    } finally {
      archive.cleanup();
    }
    expect((await log(env)).rows).toEqual([
      {
        event: 'migrate',
        from_schema: 12,
        to_schema: 13,
        from_version: null,
        to_version: '0.2.0-test',
        safety_copy: 'pre-upgrade-0012-to-0013.tar.enc',
        safety_note: null,
      },
    ]);
    expect(
      (await sql<{ app_version: string }>`select app_version from schema_info`.execute(env.test.owner)).rows[0]
        ?.app_version,
    ).toBe('0.2.0-test');
    expect(readdirSync(env.dir).filter((n) => n.startsWith('.'))).toEqual([]);
  }, 120_000);

  it('without a passphrase it writes a plain, gzip-compressed SQL copy (mode 0600) and warns that it is not encrypted', async () => {
    const env = await database({ upTo: 12, passphrase: undefined });
    const result = await migrateWithSafetyCopy(env.ctx);
    expect(result.safetyCopy).toBe('pre-upgrade-0012-to-0013.sql.gz');
    const path = join(env.dir, 'pre-upgrade-0012-to-0013.sql.gz');
    expect((statSync(path).mode & 0o777).toString(8)).toBe('600');
    const text = gunzipSync(readFileSync(path)).toString('utf8');
    expect(text).toContain('Walter');
    expect(text).toContain('PostgreSQL database dump complete');
    expect(env.logs.some((l) => l.level === 'warn' && /NOT encrypted/.test(l.message))).toBe(true);
    expect(await schema(env)).toBe(13);
  }, 120_000);

  it('the plain copy can be replayed by hand with psql into an empty database', async () => {
    const env = await database({ upTo: 12, passphrase: undefined });
    await migrateWithSafetyCopy(env.ctx);
    const admin = createDb<AnySchema>(
      { host: server.host, port: server.port, name: 'postgres' },
      server.user,
      server.password,
      1,
    );
    const name = `kinship_manual_${randomBytes(4).toString('hex')}`;
    cleanups.push(async () => {
      await sql`drop database if exists ${sql.id(name)} with (force)`.execute(admin);
      await admin.destroy();
    });
    await sql`create database ${sql.id(name)}`.execute(admin);
    const { run } = await import('../src/backup/tools.js');
    const { Readable } = await import('node:stream');
    const sqlText = gunzipSync(readFileSync(join(env.dir, 'pre-upgrade-0012-to-0013.sql.gz')));
    const result = await run(testTools().psql, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-1', '-f', '-'], {
      env: {
        PATH: process.env['PATH'] ?? '',
        PGHOST: server.host,
        PGPORT: String(server.port),
        PGUSER: server.user,
        PGPASSWORD: server.password,
        PGDATABASE: name,
      },
      stdin: Readable.from([sqlText]),
    });
    expect(result.code, result.stderr).toBe(0);
    const restored = createDb<AnySchema>(
      { host: server.host, port: server.port, name },
      server.user,
      server.password,
      1,
    );
    try {
      expect((await sql<{ n: string }>`select count(*)::text as n from people`.execute(restored)).rows[0]?.n).toBe(
        '11',
      );
    } finally {
      await restored.destroy();
    }
  }, 120_000);

  it('keeps only the newest three safety copies', async () => {
    const env = await database({ upTo: 12 });
    for (const [i, name] of [
      'pre-upgrade-0008-to-0009.tar.enc',
      'pre-upgrade-0009-to-0010.tar.enc',
      'pre-upgrade-0010-to-0011.sql.gz',
      'pre-upgrade-0011-to-0012.tar.enc',
    ].entries()) {
      writeFileSync(join(env.dir, name), 'x');
      const t = new Date(Date.now() - (10 - i) * 86_400_000);
      utimesSync(join(env.dir, name), t, t);
    }
    await migrateWithSafetyCopy(env.ctx);
    expect(copies(env.dir).sort()).toEqual([
      'pre-upgrade-0010-to-0011.sql.gz',
      'pre-upgrade-0011-to-0012.tar.enc',
      'pre-upgrade-0012-to-0013.tar.enc',
    ]);
  }, 120_000);
});

describe('the switch, and when there is nothing to copy', () => {
  const extra = {
    '0014_test_table.sql': '-- SPDX-License-Identifier: AGPL-3.0-or-later\nCREATE TABLE test_table (id integer);\n',
  };

  it('is on by default for a later change, and off when a SuperAdmin switched it off (recorded)', async () => {
    const on = await database({ upTo: 13, extra });
    await migrateWithSafetyCopy(on.ctx);
    expect(copies(on.dir)).toEqual(['pre-upgrade-0013-to-0014.tar.enc']);

    const off = await database({ upTo: 13, extra });
    await sql`insert into app_settings (key, value) values ('safety_copy', 'false'::jsonb)`.execute(off.test.owner);
    const result = await migrateWithSafetyCopy(off.ctx);
    expect(result).toMatchObject({ safetyCopy: null, safetyNote: 'off', applied: ['0014_test_table'] });
    expect(copies(off.dir)).toEqual([]);
    expect((await log(off)).rows[0]).toMatchObject({
      safety_copy: null,
      safety_note: 'off',
      from_schema: 13,
      to_schema: 14,
    });
    expect(off.logs.some((l) => l.level === 'warn' && /switched off/.test(l.message))).toBe(true);
  }, 180_000);

  it('a fresh install has nothing to copy, and says so in the log', async () => {
    const env = await database({ upTo: 0 });
    const result = await migrateWithSafetyCopy(env.ctx);
    expect(result).toMatchObject({ safetyCopy: null, safetyNote: 'fresh_install', fromSchema: null, toSchema: 13 });
    expect(readdirSync(env.dir)).toEqual([]);
    expect((await log(env)).rows[0]).toMatchObject({ from_schema: null, to_schema: 13, safety_note: 'fresh_install' });
  }, 120_000);

  it('an up-to-date database is left alone: no copy, no log row', async () => {
    const env = await database({ upTo: 13 });
    const result = await migrateWithSafetyCopy(env.ctx);
    expect(result).toMatchObject({ applied: [], safetyCopy: null, safetyNote: null });
    expect(readdirSync(env.dir)).toEqual([]);
    expect((await log(env)).rows).toEqual([]);
  }, 120_000);

  it('two api containers starting together make one copy and apply each migration once', async () => {
    const env = await database({ upTo: 12 });
    const [a, b] = await Promise.all([migrateWithSafetyCopy(env.ctx), migrateWithSafetyCopy(env.ctx)]);
    expect(a.applied.length + b.applied.length).toBe(1);
    expect(copies(env.dir)).toEqual(['pre-upgrade-0012-to-0013.tar.enc']);
    expect((await log(env)).rows).toHaveLength(1);
    expect(await schema(env)).toBe(13);
  }, 120_000);
});

describe('when the safety copy cannot be made, the upgrade does not start', () => {
  const unchanged = async (env: Env) => {
    expect(await schema(env)).toBe(12);
    expect((await sql`select name from kysely_migration`.execute(env.test.owner)).rows).toHaveLength(12);
    expect((await sql<{ n: string }>`select count(*)::text as n from people`.execute(env.test.owner)).rows[0]?.n).toBe(
      '11',
    );
  };

  it('a pg_dump that fails: the cause, the fix and the break-glass are in the message, with no secret', async () => {
    const env = await database({ upTo: 12 });
    const broken = join(folder(), 'pg_dump');
    writeFileSync(
      broken,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then exec '${testTools().pgDump}' --version; fi\necho "password authentication failed for ${env.test.config.ownerPassword} ${PASS}" >&2\nexit 1\n`,
    );
    chmodSync(broken, 0o755);
    const failure = await migrateWithSafetyCopy({ ...env.ctx, tools: { ...env.ctx.tools, pgDump: broken } }).catch(
      (e: unknown) => e as Error,
    );
    expect(failure).toBeInstanceOf(SafetyCopyError);
    const message = (failure as Error).message;
    expect(message).toContain('could not be made');
    expect(message).toContain('your data is untouched');
    expect(message).toContain('pg_dump');
    expect(message).toContain('KINSHIP_SAFETY_COPY=skip');
    expect(message).not.toContain(env.test.config.ownerPassword);
    expect(message).not.toContain(PASS);
    await unchanged(env);
    expect(copies(env.dir)).toEqual([]);
    expect(readdirSync(env.dir).filter((n) => n.startsWith('.'))).toEqual([]);
  }, 120_000);

  it('a folder that cannot be written (an upgrade whose compose.yml has no backups volume): the exact lines to add', async () => {
    const env = await database({ upTo: 12 });
    const file = join(env.dir, 'a-file');
    writeFileSync(file, 'x');
    const failure = await migrateWithSafetyCopy({
      ...env.ctx,
      config: { ...env.ctx.config, backup: { ...env.ctx.config.backup, dir: join(file, 'backups') } },
    }).catch((e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(SafetyCopyError);
    const message = (failure as Error).message;
    expect(message).toContain('- ./data/backups:/var/lib/kinship/backups');
    expect(message).toContain('mkdir -p data/backups && sudo chown 1000:1000 data/backups');
    expect(message).toContain('volumes:');
    await unchanged(env);
  }, 120_000);

  it('not enough free space: told how much, and nothing changed', async () => {
    const env = await database({ upTo: 12 });
    const failure = await migrateWithSafetyCopy({ ...env.ctx, freeBytes: () => 1 }).catch((e: unknown) => e as Error);
    expect(failure).toBeInstanceOf(SafetyCopyError);
    expect((failure as Error).message).toMatch(/not enough free space/);
    await unchanged(env);
  }, 120_000);

  it('the break-glass lets the upgrade go on, loudly and on the record', async () => {
    const env = await database({ upTo: 12 });
    const ctx = {
      ...env.ctx,
      freeBytes: () => 1,
      config: { ...env.ctx.config, backup: { ...env.ctx.config.backup, skipSafetyCopy: true } },
    };
    const result = await migrateWithSafetyCopy(ctx);
    expect(result).toMatchObject({
      safetyCopy: null,
      safetyNote: 'break_glass',
      applied: ['0013_backup_settings_and_upgrade_log'],
    });
    expect(copies(env.dir)).toEqual([]);
    expect(env.logs.some((l) => l.level === 'warn' && /KINSHIP_SAFETY_COPY=skip is set/.test(l.message))).toBe(true);
    expect((await log(env)).rows[0]).toMatchObject({ safety_note: 'break_glass', safety_copy: null });
  }, 120_000);
});

describe('an owner role that cannot read every row', () => {
  it('skips the copy, says so loudly, records it, and still upgrades', async () => {
    const id = randomBytes(5).toString('hex');
    const config: DbConfig = {
      host: server.host,
      port: server.port,
      name: `kinship_sc_${id}`,
      ownerUser: `plain_owner_${id}`,
      ownerPassword: `owner-${id}-password`,
      appUser: `kinship_scapp_${id}`,
      appPassword: `app-${id}-password`,
    };
    const admin: UntypedDb = createDb<AnySchema>(
      { host: server.host, port: server.port, name: 'postgres' },
      server.user,
      server.password,
      1,
    );
    const target = createDb<AnySchema>({ ...config, name: 'postgres' }, server.user, server.password, 1);
    void target;
    await sql`create role ${sql.id(config.ownerUser)} login nosuperuser nocreatedb createrole nobypassrls password ${sql.lit(config.ownerPassword)}`.execute(
      admin,
    );
    await sql`create database ${sql.id(config.name)} owner ${sql.id(config.ownerUser)}`.execute(admin);
    const owner = createDb<AnySchema>(config, config.ownerUser, config.ownerPassword, 2);
    const superuser = createDb<AnySchema>(config, server.user, server.password, 1);
    cleanups.push(async () => {
      await owner.destroy();
      await superuser.destroy();
      await target.destroy();
      await sql`drop database if exists ${sql.id(config.name)} with (force)`.execute(admin);
      await sql`drop role if exists ${sql.id(config.appUser)}`.execute(admin);
      await sql`drop role if exists ${sql.id(config.ownerUser)}`.execute(admin);
      await admin.destroy();
    });
    const partial = await tempMigrationsDir(true);
    cleanups.push(() => partial.remove());
    await removeMigrationsFrom(partial.dir, 13);
    await ensureAppRole(owner, config.appUser, config.appPassword);
    await runMigrations(owner, { dir: partial.dir, appRole: config.appUser });
    // A superuser puts a person in (the plain owner could not, under forced row-level security).
    await sql`insert into people (given_name, surname) values ('Walter', 'Hale')`.execute(superuser);

    const dir = folder();
    const logs: Array<{ level: string; message: string }> = [];
    const ctx: UpgradeContext = {
      config: { ...testConfig({ config } as unknown as TestDatabase, dir, PASS), migrationsDir: realMigrationsDir },
      tools: testTools(),
      log: (level, message) => logs.push({ level, message }),
      appVersion: '0.2.0-test',
      kdf: CHEAP,
    };
    const result = await migrateWithSafetyCopy(ctx);
    expect(result).toMatchObject({
      safetyCopy: null,
      safetyNote: 'skipped_no_bypassrls',
      applied: ['0013_backup_settings_and_upgrade_log'],
    });
    expect(copies(dir)).toEqual([]);
    const loud = logs.find((l) => l.level === 'error');
    expect(loud?.message).toContain('NO SAFETY COPY');
    expect(loud?.message).toContain(`ALTER ROLE "${config.ownerUser}" BYPASSRLS;`);
    const row = await sql<{ safety_note: string }>`select safety_note from upgrade_log`.execute(superuser);
    expect(row.rows).toEqual([{ safety_note: 'skipped_no_bypassrls' }]);
    expect(existsSync(dir)).toBe(true);
  }, 120_000);
});
