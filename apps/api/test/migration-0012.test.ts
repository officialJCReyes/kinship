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

describe('migration 0012 on a populated database (migrations 0001 to 0011 with the Hale family)', () => {
  it('changes no data, drops the five-argument complete_setup, and adds the wizard function for the app role only', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 12);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0011_account_links');
      await buildFamily(test.owner);
      await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);

      const functions = async () =>
        (
          await sql<{ args: string }>`
            select pg_get_function_identity_arguments(p.oid) as args
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'kinship_auth' and p.proname = 'complete_setup'
             order by 1`.execute(test.owner)
        ).rows.map((r) => r.args.split(',').length);
      expect(await functions()).toEqual([5, 7]);

      const snapshot = async () => ({
        users: (await sql`select * from users order by id`.execute(test.owner)).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
        tree: (await sql`select * from family_tree`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.users).toHaveLength(ACCOUNTS.length);

      await cp(join(realMigrationsDir, '0012_setup_family.sql'), join(dir.dir, '0012_setup_family.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0012_setup_family']);

      expect(await snapshot()).toEqual(beforeData);
      // The seven-argument function stays (scripted installs send `person`); the five-argument one is gone.
      expect(await functions()).toEqual([7]);

      const app = test.track(createAppDb(test.config));
      const privilege = async (signature: string) =>
        (
          await sql<{ ok: boolean }>`
            select has_function_privilege(${test.config.appUser}, ${signature}, 'execute') as ok`.execute(test.owner)
        ).rows[0]?.ok;
      expect(await privilege('kinship_auth.complete_setup_family(text, text, text, text, text, jsonb, jsonb)')).toBe(
        true,
      );
      // The two helpers it calls are for the function itself, not for the app role.
      expect(await privilege('kinship_auth.setup_insert_person(uuid, jsonb)')).toBe(false);
      expect(await privilege('kinship_auth.setup_insert_union(uuid, uuid, uuid, text)')).toBe(false);

      // On an installation that already has accounts the wizard function says no (KS001) and writes nothing.
      await expect(
        sql`select kinship_auth.complete_setup_family('x', 'a@example.com', 'A', 'hash', 'Tree', '{}'::jsonb,
                 '{"you":{"given_name":"A","surname":"B"}}'::jsonb)`.execute(app),
      ).rejects.toMatchObject({ code: 'KS001' });
      expect(await snapshot()).toEqual(beforeData);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
