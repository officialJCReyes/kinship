// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

describe('migration 0015 on a populated database (migrations 0001 to 0014 with the Hale family)', () => {
  it('changes no data: every person stays a real person, and only a placeholder may be blank', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 15);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0014_updates_and_whats_new');
      await buildFamily(test.owner);
      const snapshot = async () => ({
        people: (
          await sql`select id, given_name, surname, gender, birth_date, deceased from people order by id`.execute(
            test.owner,
          )
        ).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();

      await cp(join(realMigrationsDir, '0015_placeholder_people.sql'), join(dir.dir, '0015_placeholder_people.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0015_placeholder_people']);

      expect(await snapshot()).toEqual(beforeData);
      const flags = await sql<{ n: string }>`select count(*) as n from people where is_placeholder`.execute(test.owner);
      expect(Number(flags.rows[0]?.n)).toBe(0);

      const refused = (q: ReturnType<typeof sql>) =>
        q.execute(test.owner).then(
          () => 'ok',
          (e: Error) => e.message,
        );
      expect(await refused(sql`insert into people (given_name, surname) values ('', '')`)).toMatch(/given_name_check/);
      expect(
        await refused(
          sql`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'male', true)`,
        ),
      ).toBe('ok');
      expect(
        await refused(
          sql`insert into people (given_name, surname, gender, is_placeholder, deceased) values ('', '', 'male', true, true)`,
        ),
      ).toMatch(/placeholder_is_blank/);
      expect(
        await refused(
          sql`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'other', true)`,
        ),
      ).toMatch(/placeholder_is_blank/);
      // Forward-only and additive: the app role may write the flag (column grant) and nothing else changed.
      const grants = await sql<{ n: string }>`
        select count(*) as n from information_schema.column_privileges
         where table_name = 'people' and column_name = 'is_placeholder' and grantee = ${test.config.appUser}
           and privilege_type in ('INSERT', 'UPDATE')`.execute(test.owner);
      expect(Number(grants.rows[0]?.n)).toBe(2);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
