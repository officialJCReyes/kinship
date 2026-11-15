// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { MigrationError, runMigrations } from '../src/migrations/runner.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir, tempMigrationsDir } from './helpers/migrations-dir.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** A fresh database with the app role in place, and a migrations folder to edit. */
async function setup(copyReal = true) {
  const test = await createTestDatabase();
  cleanups.push(test.cleanup);
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  const dir = await tempMigrationsDir(copyReal);
  cleanups.push(dir.remove);
  const run = () => runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
  return { test, dir, run };
}

async function tableExists(test: TestDatabase, name: string): Promise<boolean> {
  const result = await sql<{ present: boolean }>`select to_regclass(${name}) is not null as present`.execute(
    test.owner,
  );
  return result.rows[0]?.present === true;
}

describe('migration runner', () => {
  it('applies the migrations to an empty database and records the schema number', async () => {
    const { test, run } = await setup();
    const { applied } = await run();
    expect(applied).toEqual(['0001_schema_info_and_grants']);

    const info = await sql<{ schema_number: number }>`select schema_number from schema_info`.execute(test.owner);
    expect(info.rows).toEqual([{ schema_number: 1 }]);
    const checksums = await sql<{ name: string }>`select name from kinship_migration_checksum`.execute(test.owner);
    expect(checksums.rows.map((r) => r.name)).toEqual(['0001_schema_info_and_grants']);
  });

  it('does nothing the second time', async () => {
    const { run } = await setup();
    await run();
    expect((await run()).applied).toEqual([]);
  });

  it('applies only new migrations later, and updates the schema number', async () => {
    const { test, dir, run } = await setup();
    await run();
    await dir.add('0002_people.sql', 'create table people (id serial primary key, given_name text not null);');
    expect((await run()).applied).toEqual(['0002_people']);
    const info = await sql<{ schema_number: number }>`select schema_number from schema_info`.execute(test.owner);
    expect(info.rows[0]?.schema_number).toBe(2);
    expect(await tableExists(test, 'people')).toBe(true);
  });

  it('fails loudly when an applied migration file was edited', async () => {
    const { dir, run } = await setup();
    await run();
    await dir.add('0001_schema_info_and_grants.sql', '-- edited\nselect 1;\n');
    const failure = await run().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationError);
    expect((failure as Error).message).toMatch(/0001_schema_info_and_grants was edited after it was applied/);
  });

  it('fails when an applied migration file is missing', async () => {
    const { dir, run } = await setup();
    await run();
    await dir.add('0002_extra.sql', 'select 1;');
    await run();
    const { rm } = await import('node:fs/promises');
    await rm(`${dir.dir}/0002_extra.sql`);
    await expect(run()).rejects.toThrow(/0002_extra was applied to this database but its file is missing/);
  });

  it('fails when an applied migration has no recorded checksum', async () => {
    const { test, run } = await setup();
    await run();
    await sql`delete from kinship_migration_checksum`.execute(test.owner);
    await expect(run()).rejects.toThrow(/no checksum recorded/);
  });

  it('rolls back everything when a migration fails', async () => {
    const { test, dir, run } = await setup();
    await run();
    await dir.add('0002_good.sql', 'create table good_table (id int);');
    await dir.add('0003_bad.sql', 'create table bad_table (id int); select * from does_not_exist;');
    await expect(run()).rejects.toThrow(/Migration failed and was rolled back/);

    expect(await tableExists(test, 'good_table')).toBe(false);
    expect(await tableExists(test, 'bad_table')).toBe(false);
    const info = await sql<{ schema_number: number }>`select schema_number from schema_info`.execute(test.owner);
    expect(info.rows[0]?.schema_number).toBe(1);

    // Fixing the pending file lets the next run succeed.
    await dir.add('0003_bad.sql', 'create table fixed_table (id int);');
    expect((await run()).applied).toEqual(['0002_good', '0003_bad']);
  });

  it('applies each migration once when two runners start at the same time', async () => {
    const { test, run } = await setup();
    const results = await Promise.all([run(), run(), run()]);
    const appliedCounts = results.map((r) => r.applied.length).sort();
    expect(appliedCounts).toEqual([0, 0, 1]);
    const rows = await sql`select 1 from kinship_migration_checksum`.execute(test.owner);
    expect(rows.rows).toHaveLength(1);
  });
});

describe('the app role after migrating', () => {
  let test: TestDatabase;
  let app: ReturnType<typeof createAppDb>;

  beforeAll(async () => {
    test = await createTestDatabase();
    await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
    await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
    app = test.track(createAppDb(test.config));
  });
  afterAll(() => test.cleanup());

  it('is NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB, NOREPLICATION and can log in', async () => {
    const result = await sql<Record<string, unknown>>`
      select current_user, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
      from pg_roles where rolname = current_user`.execute(app);
    expect(result.rows[0]).toEqual({
      current_user: test.config.appUser,
      rolcanlogin: true,
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it('owns no objects: tables, sequences, functions, schemas, types or databases', async () => {
    // Ownership dependencies ("o") of this role, in this database and cluster-wide.
    const owned = await sql<{ objects: number }>`
      select count(*)::int as objects
      from pg_shdepend d join pg_roles r on r.oid = d.refobjid
      where r.rolname = ${test.config.appUser} and d.deptype = 'o'`.execute(test.owner);
    expect(owned.rows[0]?.objects).toBe(0);

    // And nothing in the public schema belongs to it.
    const publicOwners = await sql<{ owner: string }>`
      select distinct pg_get_userbyid(relowner) as owner from pg_class
      where relnamespace = 'public'::regnamespace`.execute(test.owner);
    expect(publicOwners.rows.map((r) => r.owner)).not.toContain(test.config.appUser);
  });

  it('is not a member of any role', async () => {
    const memberships = await sql<{ n: number }>`
      select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid = m.member
      where r.rolname = ${test.config.appUser}`.execute(test.owner);
    expect(memberships.rows[0]?.n).toBe(0);
  });

  it('can read schema_info but not change it', async () => {
    const read = await sql<{ schema_number: number }>`select schema_number from schema_info`.execute(app);
    expect(read.rows[0]?.schema_number).toBe(1);
    await expect(sql`update schema_info set schema_number = 99`.execute(app)).rejects.toThrow(/permission denied/);
    await expect(sql`delete from schema_info`.execute(app)).rejects.toThrow(/permission denied/);
  });

  it('cannot create tables or read the migration bookkeeping', async () => {
    await expect(sql`create table sneaky (id int)`.execute(app)).rejects.toThrow(/permission denied/);
    await expect(sql`select * from kinship_migration_checksum`.execute(app)).rejects.toThrow(/permission denied/);
    await expect(sql`select * from kysely_migration`.execute(app)).rejects.toThrow(/permission denied/);
  });

  it('gets read and write access to tables the owner creates later', async () => {
    await sql`create table later_table (id int)`.execute(test.owner);
    await sql`insert into later_table values (1)`.execute(app);
    const rows = await sql`select * from later_table`.execute(app);
    expect(rows.rows).toHaveLength(1);
  });

  it('follows a password change in .env on the next start', async () => {
    await ensureAppRole(test.owner, test.config.appUser, 'a-new-password');
    const changed = test.track(createAppDb({ ...test.config, appPassword: 'a-new-password' }));
    await expect(sql`select 1`.execute(changed)).resolves.toBeDefined();
    const old = test.track(createAppDb(test.config));
    await expect(sql`select 1`.execute(old)).rejects.toThrow(/password authentication failed/);
  });
});
