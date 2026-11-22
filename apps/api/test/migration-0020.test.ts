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

describe('migration 0020 on a populated database (migrations 0001 to 0019 with the Hale family)', () => {
  it('starts every account on Sunday and changes nothing else', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 20);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0019_account_roles_disable_delete');
      const family = await buildFamily(test.owner);
      await sql`update users set color_scheme = 'sand' where id = ${family.account.member.id}`.execute(test.owner);

      const snapshot = async () => ({
        users: (
          await sql`select id, email, role, person_id, color_scheme, theme, date_format, name_form, tree_wheel, password_hash, disabled_at, updated_at from users order by id`.execute(
            test.owner,
          )
        ).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.users).toHaveLength(ACCOUNTS.length);

      await cp(join(realMigrationsDir, '0020_week_start.sql'), join(dir.dir, '0020_week_start.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0020_week_start']);
      expect(await snapshot()).toEqual(beforeData);

      const weeks = await sql<{ week_start: string }>`select week_start from users`.execute(test.owner);
      expect(weeks.rows).toHaveLength(ACCOUNTS.length);
      for (const row of weeks.rows) expect(row.week_start).toBe('sunday');

      // The app role changes it on its own row only, and the list is enforced.
      const app = test.track(createAppDb(test.config));
      const mine = family.account.member.id;
      type Trx = Parameters<Parameters<ReturnType<typeof app.transaction>['execute']>[0]>[0];
      const asMember = (statement: (trx: Trx) => Promise<unknown>) =>
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${mine}, true)`.execute(trx);
          return statement(trx);
        });
      await asMember((trx) => sql`update users set week_start = 'monday' where id = ${mine}`.execute(trx));
      const touched = await asMember((trx) =>
        sql`update users set week_start = 'saturday' where id = ${family.account.user.id}`.execute(trx),
      );
      expect((touched as { numAffectedRows?: bigint }).numAffectedRows ?? 0n).toBe(0n);
      await expect(
        asMember((trx) => sql`update users set week_start = 'friday' where id = ${mine}`.execute(trx)),
      ).rejects.toThrow(/check constraint/);
      const after = await sql<{ id: string; week_start: string }>`select id, week_start from users`.execute(test.owner);
      expect(after.rows.filter((r) => r.week_start !== 'sunday').map((r) => r.id)).toEqual([mine]);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);

  it('the wizard’s one write stores the week start with the account', async () => {
    const test = await createTestDatabase();
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
      const row = await sql<{ proc: string }>`
        select pg_get_functiondef('kinship_auth.complete_setup_family(text,text,text,text,text,jsonb,jsonb)'::regprocedure) as proc`.execute(
        test.owner,
      );
      for (const key of ['weekStart', 'treeWheel', 'nameForm']) expect(row.rows[0]!.proc).toContain(`'${key}'`);
    } finally {
      await test.cleanup();
    }
  }, 60_000);
});
