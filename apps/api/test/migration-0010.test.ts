// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { ACCOUNTS, buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

describe('migration 0010 on a populated database (migrations 0001 to 0009 with the Hale family)', () => {
  it('gives every account the defaults and changes nothing else', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 10);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0009_relationship_labels');
      const family = await buildFamily(test.owner);
      // Accounts that chose something in 0006 keep it.
      await sql`update users set lineage_view = 'birth' where id = ${family.account.user.id}`.execute(test.owner);

      const snapshot = async () => ({
        users: (
          await sql`select id, email, display_name, role, person_id, lineage_view, password_hash, created_at, updated_at from users order by id`.execute(
            test.owner,
          )
        ).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.users).toHaveLength(ACCOUNTS.length);

      await cp(
        join(realMigrationsDir, '0010_user_display_settings.sql'),
        join(dir.dir, '0010_user_display_settings.sql'),
      );
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0010_user_display_settings']);

      expect(await snapshot()).toEqual(beforeData);
      const settings = await sql<{
        color_scheme: string;
        theme: string;
        date_format: string;
        surname_choice: string;
      }>`select color_scheme, theme, date_format, surname_choice from users`.execute(test.owner);
      expect(settings.rows).toHaveLength(ACCOUNTS.length);
      expect(
        settings.rows.every(
          (r) =>
            r.color_scheme === 'forest' &&
            r.theme === 'device' &&
            r.date_format === 'mdy' &&
            r.surname_choice === 'married',
        ),
      ).toBe(true);

      // The app role can read and change the new columns on its own row, and still nothing else about the account.
      const app = test.track(createAppDb(test.config));
      await app.transaction().execute(async (trx) => {
        await sql`select set_config('kinship.user_id', ${family.account.member.id}, true)`.execute(trx);
        await sql`update users set theme = 'dark' where id = ${family.account.member.id}`.execute(trx);
      });
      await expect(
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${family.account.member.id}, true)`.execute(trx);
          await sql`update users set role = 'superadmin' where id = ${family.account.member.id}`.execute(trx);
        }),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
