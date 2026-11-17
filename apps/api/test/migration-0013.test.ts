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

describe('migration 0013 on a populated database (migrations 0001 to 0012 with the Hale family)', () => {
  it('changes no data, adds the settings and the upgrade log, and keeps them away from the wrong roles', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 13);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0012_setup_family');
      const family = await buildFamily(test.owner);
      await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);

      const snapshot = async () => ({
        users: (await sql`select * from users order by id`.execute(test.owner)).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
        tree: (await sql`select * from family_tree`.execute(test.owner)).rows,
        info: (await sql`select id, schema_number from schema_info`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();

      await cp(
        join(realMigrationsDir, '0013_backup_settings_and_upgrade_log.sql'),
        join(dir.dir, '0013_backup_settings_and_upgrade_log.sql'),
      );
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0013_backup_settings_and_upgrade_log']);

      const after = await snapshot();
      expect(after).toEqual({ ...beforeData, info: [{ id: true, schema_number: 13 }] });
      expect((await sql`select app_version from schema_info`.execute(test.owner)).rows).toEqual([
        { app_version: null },
      ]);
      expect((await sql`select * from app_settings`.execute(test.owner)).rows).toHaveLength(0);
      expect((await sql`select * from upgrade_log`.execute(test.owner)).rows).toHaveLength(0);

      // The app role: a SuperAdmin reads and writes settings; nobody else sees them; nobody writes the log.
      const app = test.track(createAppDb(test.config));
      const as = async (id: string, query: ReturnType<typeof sql>) =>
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${id}, true)`.execute(trx);
          return query.execute(trx);
        });
      const superadmin = family.account.superadmin.id;
      await as(
        superadmin,
        sql`insert into app_settings (key, value, updated_by) values ('backup.schedule', '"daily"'::jsonb, ${superadmin})`,
      );
      expect((await as(superadmin, sql`select key from app_settings`)).rows).toEqual([{ key: 'backup.schedule' }]);
      for (const other of [family.account.familyadmin.id, family.account.member.id, family.account.user.id]) {
        expect((await as(other, sql`select key from app_settings`)).rows).toEqual([]);
        await expect(as(other, sql`insert into app_settings (key, value) values ('x.y', '1'::jsonb)`)).rejects.toThrow(
          /row-level security/,
        );
      }
      await expect(
        as(superadmin, sql`insert into app_settings (key, value) values ('Bad Key', '1'::jsonb)`),
      ).rejects.toThrow();

      await sql`insert into upgrade_log (event, from_schema, to_schema, from_version, to_version, safety_note) values ('migrate', 12, 13, '0.1.0', '0.2.0', 'fresh_install')`.execute(
        test.owner,
      );
      expect((await as(family.account.familyadmin.id, sql`select event from upgrade_log`)).rows).toEqual([
        { event: 'migrate' },
      ]);
      expect((await as(family.account.member.id, sql`select event from upgrade_log`)).rows).toEqual([]);
      for (const statement of [
        sql`insert into upgrade_log (event, to_schema, to_version) values ('migrate', 13, 'x')`,
        sql`update upgrade_log set safety_note = 'x'`,
        sql`delete from upgrade_log`,
      ]) {
        await expect(as(superadmin, statement)).rejects.toThrow(/permission denied/);
      }
      await expect(as(superadmin, sql`update schema_info set app_version = 'x'`)).rejects.toThrow(/permission denied/);
      expect(ACCOUNTS.length).toBe(5);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
