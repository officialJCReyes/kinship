// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Migration 0024 folds the surname particle into the surname (ADR 0038). Data only: the column stays, unread.
import { randomBytes } from 'node:crypto';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import type { AnySchema, UntypedDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase, server } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

const MIGRATION = '0024_fold_surname_particle.sql';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function insert(owner: UntypedDb, given: string, surname: string, particle: string | null): Promise<string> {
  const row = await sql<{ id: string }>`insert into people (given_name, surname, surname_particle)
    values (${given}, ${surname}, ${particle}) returning id`.execute(owner);
  return row.rows[0]!.id;
}

const person = async (owner: UntypedDb, id: string) =>
  (
    await sql<{
      surname: string;
      surname_particle: string | null;
      search_names: string;
    }>`select surname, surname_particle, search_names from people where id = ${id}`.execute(owner)
  ).rows[0]!;

describe('migration 0024 folds the surname particle into the surname', () => {
  it('folds each kind of row, keeps the search text, leaves an over-long one alone and names it in a NOTICE', async () => {
    const test = await createTestDatabase();
    cleanups.push(() => test.cleanup());
    const dir = await tempMigrationsDir(true);
    cleanups.push(() => dir.remove());
    await removeMigrationsFrom(dir.dir, 24);
    await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
    await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
    const family = await buildFamily(test.owner);
    await sql`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'female', true)`.execute(
      test.owner,
    );

    const id = {
      plain: await insert(test.owner, 'Rosa', 'Cruz', 'de la'),
      // Already typed into the surname too, in another case: not doubled.
      already: await insert(test.owner, 'Hugo', 'De Vries', 'de'),
      // The surname is the particle itself.
      same: await insert(test.owner, 'Ana', 'Van', 'van'),
      // Whole words only: "Vandermeer" does not start with the word "van".
      word: await insert(test.owner, 'Pieter', 'Vandermeer', 'van'),
      // 3 + 1 + 98 = 102 characters: kept as it is.
      long: await insert(test.owner, 'Otto', 'L'.repeat(98), 'von'),
      // 3 + 1 + 96 = 100 characters exactly: folded.
      edge: await insert(test.owner, 'Lena', 'M'.repeat(96), 'von'),
      none: family.person.marcus,
    };
    const before = Object.fromEntries(
      await Promise.all(Object.entries(id).map(async ([k, v]) => [k, await person(test.owner, v)] as const)),
    );

    // Run the migration on a connection that reports NOTICEs, as the api's start-up and restore do.
    const notices: string[] = [];
    const noticing = createDb<AnySchema>(test.config, server.user, server.password, 1, (m) => notices.push(m));
    cleanups.push(() => noticing.destroy());
    await cp(join(realMigrationsDir, MIGRATION), join(dir.dir, MIGRATION));
    const result = await runMigrations(noticing, { dir: dir.dir, appRole: test.config.appUser });
    expect(result.applied).toEqual(['0024_fold_surname_particle']);

    const after = async (key: keyof typeof id) => person(test.owner, id[key]);
    expect(await after('plain')).toMatchObject({ surname: 'de la Cruz', surname_particle: null });
    expect(await after('already')).toMatchObject({ surname: 'De Vries', surname_particle: null });
    expect(await after('same')).toMatchObject({ surname: 'Van', surname_particle: null });
    expect(await after('word')).toMatchObject({ surname: 'van Vandermeer', surname_particle: null });
    expect(await after('edge')).toMatchObject({ surname: `von ${'M'.repeat(96)}`, surname_particle: null });
    expect(await after('long')).toEqual(before['long']);
    expect(await after('none')).toEqual(before['none']);

    // The search text is the same for a folded row (the particle was already in front of the surname); a particle typed
    // twice is now there once.
    for (const key of ['plain', 'word', 'edge'] as const) {
      expect((await after(key)).search_names, key).toBe(before[key]!.search_names);
    }
    expect(before['already']!.search_names).toBe('hugo de de vries');
    expect((await after('already')).search_names).toBe('hugo de vries');

    expect(notices.some((m) => m.startsWith('0024:') && m.includes(id.long))).toBe(true);
    expect(notices.join('\n')).not.toContain(id.edge);
    // Placeholders keep their blank names; the column, its CHECK and the force on row-level security stay.
    const placeholders = await sql<{ n: string }>`select count(*)::text as n from people
      where is_placeholder and surname = '' and surname_particle is null`.execute(test.owner);
    expect(placeholders.rows[0]?.n).toBe('1');
    const forced = await sql<{
      f: boolean;
    }>`select relforcerowsecurity as f from pg_class where relname = 'people'`.execute(test.owner);
    expect(forced.rows[0]?.f).toBe(true);
    await expect(
      sql`update people set surname_particle = ${'x'.repeat(31)} where id = ${id.plain}`.execute(test.owner),
    ).rejects.toThrow(/check constraint/);
  }, 60_000);

  it('folds under an owner that is not a superuser, although row-level security is forced on people', async () => {
    const suffix = randomBytes(5).toString('hex');
    const config = {
      host: server.host,
      port: server.port,
      name: `kinship_0024_${suffix}`,
      ownerUser: `kinship_owner24_${suffix}`,
      ownerPassword: `owner-${suffix}-password`,
      appUser: `kinship_app24_${suffix}`,
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
    await removeMigrationsFrom(dir.dir, 24);
    await ensureAppRole(owner, config.appUser, config.appPassword);
    await runMigrations(owner, { dir: dir.dir, appRole: config.appUser });

    // The row is written as the server's superuser: the non-superuser owner itself cannot see or write people (forced).
    const superuser = createDb<AnySchema>(config, server.user, server.password, 1);
    cleanups.push(() => superuser.destroy());
    const rosa = await insert(superuser, 'Rosa', 'Cruz', 'de la');
    const hidden = await sql<{ n: string }>`select count(*)::text as n from people`.execute(owner);
    expect(hidden.rows[0]?.n).toBe('0');

    await cp(join(realMigrationsDir, MIGRATION), join(dir.dir, MIGRATION));
    await runMigrations(owner, { dir: dir.dir, appRole: config.appUser });
    expect(await person(superuser, rosa)).toMatchObject({ surname: 'de la Cruz', surname_particle: null });
    const forced = await sql<{
      f: boolean;
    }>`select relforcerowsecurity as f from pg_class where relname = 'people'`.execute(owner);
    expect(forced.rows[0]?.f).toBe(true);
  }, 60_000);
});
