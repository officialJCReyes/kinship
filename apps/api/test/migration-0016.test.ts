// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/backup/inspect.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

describe('migration 0016 on a populated database (migrations 0001 to 0015 with the Hale family)', () => {
  it('changes no data, adds functions only, and the app role gets them without any write on users.person_id', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      // Run the files before 0016, whatever else follows it later.
      await removeMigrationsFrom(dir.dir, 16);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0015_placeholder_people');
      const family = await buildFamily(test.owner);
      // An account that has no person and one invitation open for a person, as an upgraded install may have.
      const snapshot = async () => ({
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
        users: (await sql`select id, email, role, person_id from users order by id`.execute(test.owner)).rows,
        links: (await sql`select * from account_links order by id`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      const appRole = test.config.appUser;
      const beforePrints = await fingerprint(test.owner, appRole);

      await cp(join(realMigrationsDir, '0016_link_account_person.sql'), join(dir.dir, '0016_link_account_person.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole });
      expect(result.applied).toEqual(['0016_link_account_person']);
      expect(await snapshot()).toEqual(beforeData);

      // Fingerprint: only definerFunctions and functionExecute grow, by exactly these five functions; nothing else moves.
      const after = await fingerprint(test.owner, appRole);
      const names = ['can_link_for', 'check_link', 'link_account_person', 'unlink_account_person', 'link_preview'];
      const fresh = (list: string[]) => list.filter((entry) => names.some((n) => entry.startsWith(`kinship_auth.${n}(`)));
      expect(fresh(after.definerFunctions)).toHaveLength(5);
      expect(fresh(after.functionExecute).sort()).toEqual(fresh(after.functionExecute).filter((e) => e.endsWith('=true')).sort());
      expect(fresh(after.functionExecute)).toHaveLength(5);
      const without = (list: string[]) => list.filter((entry) => !names.some((n) => entry.startsWith(`kinship_auth.${n}(`)));
      expect(without(after.definerFunctions)).toEqual(beforePrints.definerFunctions);
      expect(without(after.functionExecute)).toEqual(beforePrints.functionExecute);
      for (const key of ['tables', 'policies', 'tableGrants', 'columnGrants', 'schemaPrivileges', 'defaultPrivileges'] as const) {
        expect(after[key]).toEqual(beforePrints[key]);
      }

      // Rights: PUBLIC has no EXECUTE, the app role has. The app role still has no UPDATE on users.person_id.
      for (const n of names) {
        const rights = await sql<{ app: boolean; pub: boolean }>`
          select has_function_privilege(${appRole}, p.oid, 'EXECUTE') as app,
                 coalesce(bool_or(a.grantee = 0), false) as pub
            from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            left join lateral aclexplode(p.proacl) a on true
           where s.nspname = 'kinship_auth' and p.proname = ${n}
           group by p.oid`.execute(test.owner);
        expect(rights.rows[0]).toEqual({ app: true, pub: false });
        const definer = await sql<{ secdef: boolean; config: string[] }>`
          select p.prosecdef as secdef, p.proconfig as config from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname = 'kinship_auth' and p.proname = ${n}`.execute(test.owner);
        expect(definer.rows[0]?.secdef).toBe(true);
        expect(definer.rows[0]?.config).toContain('search_path=pg_catalog, pg_temp');
      }
      const column = await sql<{ n: string }>`
        select count(*) as n from information_schema.column_privileges
         where table_name = 'users' and column_name = 'person_id' and grantee = ${appRole} and privilege_type <> 'SELECT'`.execute(
        test.owner,
      );
      expect(Number(column.rows[0]?.n)).toBe(0);

      // The new functions work on the upgraded data, as an admin (set the signed-in account the way the API does).
      const asAdmin = async (query: ReturnType<typeof sql>) =>
        test.owner.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${family.account.superadmin.id}, true)`.execute(trx);
          return query.execute(trx);
        });
      await asAdmin(
        sql`select * from kinship_auth.link_account_person(${family.account.user.id}::uuid, ${family.person.priya}::uuid, null)`,
      );
      expect(
        (await sql<{ person_id: string }>`select person_id from users where id = ${family.account.user.id}`.execute(test.owner))
          .rows[0]?.person_id,
      ).toBe(family.person.priya);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);

  it('the placeholder fix in create_invitation: a placeholder is refused, a real person is still accepted', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 16);
      await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      const family = await buildFamily(test.owner);
      const placeholder = (
        await sql<{ id: string }>`insert into people (given_name, surname, gender, is_placeholder) values ('', '', 'female', true) returning id`.execute(
          test.owner,
        )
      ).rows[0]!.id;
      const invite = (person: string, email: string) =>
        test.owner.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${family.account.superadmin.id}, true)`.execute(trx);
          return sql`select * from kinship_auth.create_invitation(${email}, 'user', ${person}::uuid, null, ${`h-${email}`})`.execute(trx);
        });
      // Before 0016 the gap exists (documented in ADR 0020): the old function accepts the placeholder.
      await expect(invite(placeholder, 'old@example.com')).resolves.toBeDefined();
      await sql`delete from account_links`.execute(test.owner);

      await cp(join(realMigrationsDir, '0016_link_account_person.sql'), join(dir.dir, '0016_link_account_person.sql'));
      await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      await expect(invite(placeholder, 'new@example.com')).rejects.toThrow(/person_is_placeholder/);
      await expect(invite(family.person.priya, 'priya@example.com')).resolves.toBeDefined();
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
