// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { ACCOUNTS, buildFamily, insertPersonRow } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

describe('migration 0017 on a populated database (migrations 0001 to 0016 with the Hale family)', () => {
  it('moves the name setting, keeps every person, and rebuilds the search text', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 17);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0016_link_account_person');
      const family = await buildFamily(test.owner);
      // Rosa: a married woman with a married surname; Beatriz: one without (the fixture's default).
      await sql`update people set married_surname = 'Mendez Hale', second_surname = 'Ortiz' where id = ${family.person.rosa}`.execute(
        test.owner,
      );
      // A placeholder, as 0015 makes them ("Unknown father").
      await sql`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'male', true)`.execute(
        test.owner,
      );
      // Accounts: the Member chose "birth names"; everyone else is on the old default.
      await sql`update users set surname_choice = 'birth' where id = ${family.account.member.id}`.execute(test.owner);

      const snapshot = async () => ({
        people: (
          await sql`select id, given_name, surname, second_surname, married_surname, gender, birth_date, deceased, is_placeholder from people order by id`.execute(
            test.owner,
          )
        ).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
        users: (
          await sql`select id, email, role, person_id, color_scheme, theme, date_format, lineage_view, surname_choice from users order by id`.execute(
            test.owner,
          )
        ).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.users).toHaveLength(ACCOUNTS.length);
      const placeholders = (beforeData.people as Array<{ is_placeholder: boolean }>).filter((p) => p.is_placeholder);
      expect(placeholders).toHaveLength(1);

      await cp(join(realMigrationsDir, '0017_names.sql'), join(dir.dir, '0017_names.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0017_names']);

      // Nothing that was there changed (surname_choice stays, unread, for the contract step).
      expect(await snapshot()).toEqual(beforeData);

      // The new person columns are empty for everyone, placeholders included.
      const empties = await sql<{ n: string }>`
        select count(*) as n from people
         where name_prefix is not null or name_suffix is not null or nickname is not null or surname_particle is not null`.execute(
        test.owner,
      );
      expect(empties.rows[0]!.n).toBe('0');

      // The settings: the Member's "birth" became "maiden"; everyone else the new default. Prefix and suffix show for all.
      const settings = await sql<{ id: string; name_form: string; show_prefix: boolean; show_suffix: boolean }>`
        select id, name_form, show_prefix, show_suffix from users`.execute(test.owner);
      expect(settings.rows).toHaveLength(ACCOUNTS.length);
      for (const row of settings.rows) {
        expect(row.name_form, row.id).toBe(row.id === family.account.member.id ? 'maiden' : 'maiden_married');
        expect(row.show_prefix).toBe(true);
        expect(row.show_suffix).toBe(true);
      }

      // The search text still finds what it found (including the second and married surnames), now over all parts.
      const rosa = await sql<{
        search_names: string;
      }>`select search_names from people where id = ${family.person.rosa}`.execute(test.owner);
      expect(rosa.rows[0]!.search_names).toBe('rosa mendez ortiz mendez hale');
      await sql`update people set nickname = 'Rosie', name_prefix = 'Dr.', surname_particle = 'de' where id = ${family.person.rosa}`.execute(
        test.owner,
      );
      const rebuilt = await sql<{
        search_names: string;
      }>`select search_names from people where id = ${family.person.rosa}`.execute(test.owner);
      expect(rebuilt.rows[0]!.search_names).toBe('dr. rosa rosie de mendez ortiz mendez hale');
      // The placeholder's text is what it was (empty names), not null.
      const ph = await sql<{ s: string | null }>`select search_names as s from people where is_placeholder`.execute(
        test.owner,
      );
      expect(ph.rows[0]!.s).not.toBeNull();

      // The app role reads and changes the new settings on its own row, and still nothing else about the account.
      const app = test.track(createAppDb(test.config));
      await app.transaction().execute(async (trx) => {
        await sql`select set_config('kinship.user_id', ${family.account.member.id}, true)`.execute(trx);
        await sql`update users set name_form = 'married_born', show_prefix = false, show_suffix = false where id = ${family.account.member.id}`.execute(
          trx,
        );
      });
      await expect(
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${family.account.member.id}, true)`.execute(trx);
          await sql`update users set name_form = 'nonsense' where id = ${family.account.member.id}`.execute(trx);
        }),
      ).rejects.toThrow(/check constraint/);
      void insertPersonRow;
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);

  it('the wizard’s one write stores the new settings with the account', async () => {
    const test = await createTestDatabase();
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
      const row = await sql<{ proc: string }>`
        select pg_get_functiondef('kinship_auth.complete_setup_family(text,text,text,text,text,jsonb,jsonb)'::regprocedure) as proc`.execute(
        test.owner,
      );
      expect(row.rows[0]!.proc).toContain("'nameForm'");
      expect(row.rows[0]!.proc).not.toContain('surnameChoice');
    } finally {
      await test.cleanup();
    }
  }, 60_000);
});
