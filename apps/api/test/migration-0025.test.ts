// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0025 is the contract half of ADR 0038 and #220: it folds any particle still there, keeps a row too long to fold
// in an owner-only leftover table, rewrites search_names and the placeholder CHECK without the particle, and drops
// people.surname_particle and users.surname_choice.
import { randomBytes } from 'node:crypto';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppDb, createDb } from '../src/db.js';
import type { AnySchema, UntypedDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase, server } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

const M24 = '0024_fold_surname_particle.sql';
const M25 = '0025_drop_surname_particle.sql';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function insert(db: UntypedDb, given: string, surname: string, particle: string | null): Promise<string> {
  const row = await sql<{ id: string }>`insert into people (given_name, surname, surname_particle)
    values (${given}, ${surname}, ${particle}) returning id`.execute(db);
  return row.rows[0]!.id;
}

const searchText = async (db: UntypedDb) =>
  new Map(
    (await sql<{ id: string; search_names: string }>`select id, search_names from people`.execute(db)).rows.map((r) => [
      r.id,
      r.search_names,
    ]),
  );

const surnameOf = async (db: UntypedDb, id: string) =>
  (await sql<{ surname: string }>`select surname from people where id = ${id}`.execute(db)).rows[0]!.surname;

const leftovers = async (db: UntypedDb) =>
  (
    await sql<{
      person_id: string;
      surname_particle: string;
      surname: string;
    }>`select person_id, surname_particle, surname from people_surname_particle_leftover order by person_id`.execute(db)
  ).rows;

const columnExists = async (db: UntypedDb, table: string, column: string) =>
  (
    await sql`select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and column_name = ${column}`.execute(db)
  ).rows.length === 1;

const forced = async (db: UntypedDb) =>
  (await sql<{ f: boolean }>`select relforcerowsecurity as f from pg_class where relname = 'people'`.execute(db))
    .rows[0]!.f;

/** A database migrated up to (and not including) `from`, and a connection that collects NOTICEs. */
async function databaseBefore(from: number) {
  const test = await createTestDatabase();
  cleanups.push(() => test.cleanup());
  const dir = await tempMigrationsDir(true);
  cleanups.push(() => dir.remove());
  await removeMigrationsFrom(dir.dir, from);
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
  const notices: string[] = [];
  const noticing = createDb<AnySchema>(test.config, server.user, server.password, 1, (m) => notices.push(m));
  cleanups.push(() => noticing.destroy());
  return { test, dir: dir.dir, notices, noticing };
}

describe('migration 0025 drops the surname particle and the surname choice', () => {
  it('folds what is left, keeps an over-long row aside, keeps the search text and drops both columns', async () => {
    const { test, dir, notices, noticing } = await databaseBefore(25);
    const family = await buildFamily(test.owner);
    await sql`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'female', true)`.execute(
      test.owner,
    );
    // Written by hand after 0024 (the API refuses the field): one that fits, one that does not.
    const fits = await insert(test.owner, 'Rosa', 'Cruz', 'de la');
    // 3 + 1 + 98 = 102 characters.
    const long = await insert(test.owner, 'Otto', 'L'.repeat(98), 'von');
    const before = await searchText(test.owner);

    await cp(join(realMigrationsDir, M25), join(dir, M25));
    const result = await runMigrations(noticing, { dir, appRole: test.config.appUser });
    expect(result.applied).toEqual(['0025_drop_surname_particle']);

    expect(await surnameOf(test.owner, fits)).toBe('de la Cruz');
    expect(await surnameOf(test.owner, long)).toBe('L'.repeat(98));
    expect(await leftovers(test.owner)).toEqual([
      { person_id: long, surname_particle: 'von', surname: 'L'.repeat(98) },
    ]);

    // The search text is the same for every row but the leftover, which loses its particle (kept in the leftover table).
    const after = await searchText(test.owner);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, text] of before) {
      if (id === long) continue;
      expect(after.get(id), id).toBe(text);
    }
    expect(before.get(long)).toBe(`otto von ${'l'.repeat(98)}`);
    expect(after.get(long)).toBe(`otto ${'l'.repeat(98)}`);
    expect(after.get(family.person.marcus)).toBe(before.get(family.person.marcus));

    // The NOTICE names the person id and never the name.
    const notice = notices.filter((m) => m.startsWith('0025:'));
    expect(notice).toHaveLength(1);
    expect(notice[0]).toContain(long);
    expect(notice[0]).not.toContain(fits);
    expect(notice[0]).not.toContain('L'.repeat(10));
    expect(notice[0]).not.toMatch(/\bvon\b/);

    expect(await columnExists(test.owner, 'people', 'surname_particle')).toBe(false);
    expect(await columnExists(test.owner, 'users', 'surname_choice')).toBe(false);
    expect(await forced(test.owner)).toBe(true);

    // The placeholder rule still holds without the particle.
    for (const column of ['name_prefix', 'name_suffix', 'nickname', 'second_surname']) {
      await expect(
        sql`insert into people (given_name, surname, gender, is_placeholder, ${sql.id(column)})
            values ('', '', 'male', true, 'x')`.execute(test.owner),
        column,
      ).rejects.toThrow(/people_placeholder_is_blank/);
    }
    await expect(
      sql`insert into people (given_name, surname, gender, is_placeholder) values ('Named', '', 'male', true)`.execute(
        test.owner,
      ),
    ).rejects.toThrow(/people_placeholder_is_blank/);

    // Only the owner reads the leftover table; the app role has no privilege on it.
    const app = test.track(createAppDb(test.config));
    await expect(sql`select * from people_surname_particle_leftover`.execute(app)).rejects.toThrow(/permission denied/);
    const grants = await sql<{ n: string }>`select count(*)::text as n from information_schema.role_table_grants
      where table_name = 'people_surname_particle_leftover' and grantee <> current_user`.execute(test.owner);
    expect(grants.rows[0]?.n).toBe('0');
    // Once the surname is fixed, the admin empties it.
    await sql`delete from people_surname_particle_leftover where person_id = ${long}`.execute(test.owner);
    expect(await leftovers(test.owner)).toEqual([]);
  }, 60_000);

  it('creates the leftover table empty, with no NOTICE, when nothing is left', async () => {
    const { test, dir, notices, noticing } = await databaseBefore(25);
    await buildFamily(test.owner);
    await cp(join(realMigrationsDir, M25), join(dir, M25));
    await runMigrations(noticing, { dir, appRole: test.config.appUser });
    expect(await leftovers(test.owner)).toEqual([]);
    expect(notices.filter((m) => m.startsWith('0025:'))).toEqual([]);
  }, 60_000);

  it('from schema 23 (0.3.0-rc.1 or rc.2), 0024 and 0025 run together with the same result', async () => {
    const { test, dir, notices, noticing } = await databaseBefore(24);
    await buildFamily(test.owner);
    const fits = await insert(test.owner, 'Rosa', 'Cruz', 'de la');
    const already = await insert(test.owner, 'Hugo', 'De Vries', 'de');
    const long = await insert(test.owner, 'Otto', 'L'.repeat(98), 'von');

    await cp(join(realMigrationsDir, M24), join(dir, M24));
    await cp(join(realMigrationsDir, M25), join(dir, M25));
    const result = await runMigrations(noticing, { dir, appRole: test.config.appUser });
    expect(result.applied).toEqual(['0024_fold_surname_particle', '0025_drop_surname_particle']);

    expect(await surnameOf(test.owner, fits)).toBe('de la Cruz');
    expect(await surnameOf(test.owner, already)).toBe('De Vries');
    expect(await leftovers(test.owner)).toEqual([
      { person_id: long, surname_particle: 'von', surname: 'L'.repeat(98) },
    ]);
    expect(notices.some((m) => m.startsWith('0024:') && m.includes(long))).toBe(true);
    expect(notices.some((m) => m.startsWith('0025:') && m.includes(long))).toBe(true);
    const search = await searchText(test.owner);
    expect(search.get(fits)).toBe('rosa de la cruz');
    expect(await columnExists(test.owner, 'people', 'surname_particle')).toBe(false);
  }, 60_000);

  it('works under an owner that is not a superuser, although row-level security is forced on people', async () => {
    const suffix = randomBytes(5).toString('hex');
    const config = {
      host: server.host,
      port: server.port,
      name: `kinship_0025_${suffix}`,
      ownerUser: `kinship_owner25_${suffix}`,
      ownerPassword: `owner-${suffix}-password`,
      appUser: `kinship_app25_${suffix}`,
      appPassword: `app-${suffix}-password`,
    };
    const admin = createDb<AnySchema>({ ...config, name: 'postgres' }, server.user, server.password, 1);
    cleanups.push(async () => {
      await sql`drop database if exists ${sql.id(config.name)} with (force)`.execute(admin);
      await sql`drop role if exists ${sql.id(config.appUser)}`.execute(admin);
      await sql`drop role if exists ${sql.id(config.ownerUser)}`.execute(admin);
      await admin.destroy();
    });
    await sql`create role ${sql.id(config.ownerUser)} login nosuperuser nocreatedb createrole nobypassrls password ${sql.lit(config.ownerPassword)}`.execute(
      admin,
    );
    await sql`create database ${sql.id(config.name)} owner ${sql.id(config.ownerUser)}`.execute(admin);
    const owner = createDb<AnySchema>(config, config.ownerUser, config.ownerPassword, 1);
    cleanups.push(() => owner.destroy());
    const dir = await tempMigrationsDir(true);
    cleanups.push(() => dir.remove());
    await removeMigrationsFrom(dir.dir, 25);
    await ensureAppRole(owner, config.appUser, config.appPassword);
    await runMigrations(owner, { dir: dir.dir, appRole: config.appUser });

    // Rows are written as the server's superuser: the non-superuser owner itself cannot see people (forced).
    const superuser = createDb<AnySchema>(config, server.user, server.password, 1);
    cleanups.push(() => superuser.destroy());
    const fits = await insert(superuser, 'Rosa', 'Cruz', 'de la');
    const long = await insert(superuser, 'Otto', 'L'.repeat(98), 'von');
    const hidden = await sql<{ n: string }>`select count(*)::text as n from people`.execute(owner);
    expect(hidden.rows[0]?.n).toBe('0');

    await cp(join(realMigrationsDir, M25), join(dir.dir, M25));
    await runMigrations(owner, { dir: dir.dir, appRole: config.appUser });
    expect(await surnameOf(superuser, fits)).toBe('de la Cruz');
    expect(await leftovers(owner)).toEqual([{ person_id: long, surname_particle: 'von', surname: 'L'.repeat(98) }]);
    expect(await columnExists(owner, 'people', 'surname_particle')).toBe(false);
    expect(await forced(owner)).toBe(true);
  }, 60_000);
});
