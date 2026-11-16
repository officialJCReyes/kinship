// SPDX-License-Identifier: AGPL-3.0-or-later
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { cp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb, createDb } from '../src/db.js';
import type { AnySchema } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { createTestDatabase, server } from './helpers/db.js';
import { insertPersonRow, insertUnionRow, linkChild } from './helpers/family.js';
import { realMigrationsDir, tempMigrationsDir } from './helpers/migrations-dir.js';

describe('migration 0007 on data from before it (the 0.1.0 baseline: migrations 0001 to 0006)', () => {
  it('keeps every row, fills the new search column, and widows relationships whose partner already died', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await rm(join(dir.dir, '0007_names_and_widowed.sql'));
      await rm(join(dir.dir, '0008_union_status_by_hand.sql')); // later than 0007: this test is about 0007 alone
      await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });

      // A family in the old shape.
      const joseph = await insertPersonRow(test.owner, 'Joseph', 'Hale', { deceased: true, birth: '1902' });
      const anna = await insertPersonRow(test.owner, 'Anna', 'Walsh', { birth: '1905' });
      const walter = await insertPersonRow(test.owner, 'Walter', 'Hale', { birth: '1931' });
      const rosa = await insertPersonRow(test.owner, 'Rosa', 'Méndez', { birth: '1934' });
      const married = await insertUnionRow(test.owner, joseph, anna, 'married', { start: '1927-06-11' });
      const living = await insertUnionRow(test.owner, walter, rosa, 'married', { start: '1955-06-04' });
      const engaged = await insertUnionRow(test.owner, joseph, rosa, 'engaged');
      await linkChild(test.owner, walter, { union: married });
      const before = await sql<{ n: string }>`select count(*) as n from people`.execute(test.owner);

      await cp(join(realMigrationsDir, '0007_names_and_widowed.sql'), join(dir.dir, '0007_names_and_widowed.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0007_names_and_widowed']);

      expect((await sql<{ n: string }>`select count(*) as n from people`.execute(test.owner)).rows).toEqual(
        before.rows,
      );
      const people = await sql<{ second_surname: string | null; married_surname: string | null }>`
        select second_surname, married_surname from people`.execute(test.owner);
      expect(people.rows.every((p) => p.second_surname === null && p.married_surname === null)).toBe(true);
      // Accent-insensitive search text over all the name parts, and the old column still there.
      const search = await sql<{ search_names: string; search_name: string }>`
        select search_names, search_name from people where id = ${rosa}`.execute(test.owner);
      expect(search.rows[0]).toEqual({ search_names: 'rosa mendez', search_name: 'rosa mendez' });
      await sql`update people set second_surname = 'Ortiz', married_surname = 'Hale' where id = ${rosa}`.execute(
        test.owner,
      );
      expect(
        (await sql<{ s: string }>`select search_names as s from people where id = ${rosa}`.execute(test.owner)).rows[0]
          ?.s,
      ).toBe('rosa mendez ortiz hale');

      // Joseph is deceased: his Married relationship is Widowed (automatic); the others are untouched.
      const state = async (id: string) =>
        (
          await sql<{
            status: string;
            status_auto: boolean;
          }>`select status, status_auto from unions where id = ${id}`.execute(test.owner)
        ).rows[0];
      expect(await state(married)).toEqual({ status: 'widowed', status_auto: true });
      expect(await state(living)).toEqual({ status: 'married', status_auto: false });
      expect(await state(engaged)).toEqual({ status: 'engaged', status_auto: false });
      expect(
        (await sql`select 1 from person_parents where child_id = ${walter}`.execute(test.owner)).rows,
      ).toHaveLength(1);

      // The app role can write the new name columns and cannot write status_auto.
      const app = test.track(createAppDb(test.config));
      await expect(sql`update unions set status_auto = true`.execute(app)).rejects.toThrow(/permission denied/);
      await expect(sql`update people set married_surname = 'X'`.execute(app)).resolves.toBeDefined();
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});

describe('migration 0007 when the owner role is not a superuser', () => {
  it('still widows the relationships whose partner already died (forced row-level security applies to the owner)', async () => {
    const id = randomBytes(5).toString('hex');
    const name = `kinship_m7_${id}`;
    const ownerUser = `kinship_m7o_${id}`;
    const appUser = `kinship_m7a_${id}`;
    const admin = createDb<AnySchema>(
      { host: server.host, port: server.port, name: 'postgres' },
      server.user,
      server.password,
      1,
    );
    await sql`create role ${sql.id(ownerUser)} login nosuperuser nocreatedb createrole nobypassrls password 'owner-pw'`.execute(
      admin,
    );
    await sql`create database ${sql.id(name)} owner ${sql.id(ownerUser)}`.execute(admin);
    const config = { host: server.host, port: server.port, name };
    const owner = createDb<AnySchema>(config, ownerUser, 'owner-pw', 2);
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(owner, appUser, 'app-pw');
      await rm(join(dir.dir, '0007_names_and_widowed.sql'));
      await rm(join(dir.dir, '0008_union_status_by_hand.sql')); // later than 0007: this test is about 0007 alone
      await runMigrations(owner, { dir: dir.dir, appRole: appUser });
      // Rows in the people tables are invisible to a non-superuser owner under forced row-level security
      // unless a policy lets it in, so the old data is arranged with that protection switched off for a moment.
      await sql`alter table people no force row level security`.execute(owner);
      await sql`alter table unions no force row level security`.execute(owner);
      const gone = await insertPersonRow(owner, 'Late', 'Spouse', { deceased: true });
      const wife = await insertPersonRow(owner, 'Living', 'Spouse');
      const union = await insertUnionRow(owner, gone, wife, 'married');
      await sql`alter table people force row level security`.execute(owner);
      await sql`alter table unions force row level security`.execute(owner);

      await cp(join(realMigrationsDir, '0007_names_and_widowed.sql'), join(dir.dir, '0007_names_and_widowed.sql'));
      await runMigrations(owner, { dir: dir.dir, appRole: appUser });

      await sql`alter table unions no force row level security`.execute(owner);
      const row = await sql<{ status: string; status_auto: boolean }>`
        select status, status_auto from unions where id = ${union}`.execute(owner);
      expect(row.rows[0]).toEqual({ status: 'widowed', status_auto: true });
    } finally {
      await dir.remove();
      await owner.destroy();
      await sql`drop database if exists ${sql.id(name)} with (force)`.execute(admin);
      await sql`drop role if exists ${sql.id(appUser)}`.execute(admin);
      await sql`drop role if exists ${sql.id(ownerUser)}`.execute(admin);
      await admin.destroy();
    }
  }, 60_000);
});
