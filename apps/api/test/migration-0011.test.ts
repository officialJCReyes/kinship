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

describe('migration 0011 on a populated database (migrations 0001 to 0010 with the Hale family)', () => {
  it('changes nothing that was there, and leaves the new columns empty', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 11);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0010_user_display_settings');
      const family = await buildFamily(test.owner);
      await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
      await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
                values (${family.account.member.id}, 'a-session-hash', now() + interval '1 day', now() + interval '2 days')`.execute(
        test.owner,
      );

      const snapshot = async () => ({
        users: (
          await sql`select id, email, display_name, role, person_id, password_hash, lineage_view, color_scheme, theme,
                           date_format, surname_choice, created_at, updated_at from users order by id`.execute(
            test.owner,
          )
        ).rows,
        sessions: (await sql`select * from sessions order by id`.execute(test.owner)).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
        tree: (await sql`select * from family_tree`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.users).toHaveLength(ACCOUNTS.length);

      await cp(join(realMigrationsDir, '0011_account_links.sql'), join(dir.dir, '0011_account_links.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0011_account_links']);

      expect(await snapshot()).toEqual(beforeData);
      const added = await sql<Record<string, unknown>>`
        select last_sign_in_at, password_changed_at, password_changed_via from users`.execute(test.owner);
      expect(added.rows).toHaveLength(ACCOUNTS.length);
      for (const row of added.rows) {
        expect(row).toEqual({ last_sign_in_at: null, password_changed_at: null, password_changed_via: null });
      }
      expect((await sql`select * from account_links`.execute(test.owner)).rows).toHaveLength(0);

      // The app role: no table, the new columns read-only, and an admin now reads every account.
      const app = test.track(createAppDb(test.config));
      const run = async (id: string, query: ReturnType<typeof sql>) =>
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${id}, true)`.execute(trx);
          return query.execute(trx);
        });
      await expect(run(family.account.superadmin.id, sql`select * from account_links`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        run(
          family.account.member.id,
          sql`update users set password_changed_via = 'self' where id = ${family.account.member.id}`,
        ),
      ).rejects.toThrow(/permission denied/);
      expect((await run(family.account.superadmin.id, sql`select id from users`)).rows).toHaveLength(ACCOUNTS.length);
      expect((await run(family.account.user.id, sql`select id from users`)).rows).toHaveLength(1);
      expect((await run(family.account.user.id, sql`select password_changed_via from users`)).rows).toEqual([
        { password_changed_via: null },
      ]);

      // The old session still resolves, and signing in now records the time.
      const resolved = await sql`select * from kinship_auth.resolve_session('a-session-hash', 3600)`.execute(
        test.owner,
      );
      expect(resolved.rows).toHaveLength(1);
      await sql`select * from kinship_auth.create_session(${family.account.member.id}, 'another-hash', 3600, 86400)`.execute(
        test.owner,
      );
      const stamped = await sql<{
        last_sign_in_at: Date | null;
      }>`select last_sign_in_at from users where id = ${family.account.member.id}`.execute(test.owner);
      expect(stamped.rows[0]?.last_sign_in_at).toBeInstanceOf(Date);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
