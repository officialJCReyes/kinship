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

describe('migration 0018 on a populated database (migrations 0001 to 0017 with the Hale family)', () => {
  it('gives every account the chart defaults and changes nothing else', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 18);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0017_names');
      const family = await buildFamily(test.owner);
      // An account that chose something earlier keeps it.
      await sql`update users set name_form = 'maiden', color_scheme = 'sand' where id = ${family.account.member.id}`.execute(
        test.owner,
      );

      const snapshot = async () => ({
        users: (
          await sql`select id, email, role, person_id, color_scheme, theme, date_format, lineage_view, name_form, show_prefix, show_suffix, password_hash, updated_at from users order by id`.execute(
            test.owner,
          )
        ).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.users).toHaveLength(ACCOUNTS.length);

      await cp(join(realMigrationsDir, '0018_chart_settings.sql'), join(dir.dir, '0018_chart_settings.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0018_chart_settings']);
      expect(await snapshot()).toEqual(beforeData);

      // Every account: the defaults. Aunts, uncles and cousins are hidden for everyone, existing accounts included.
      const settings = await sql<{
        tree_wheel: string;
        tree_default_view: string;
        show_extended_relatives: boolean;
        show_deceased_mark: boolean;
      }>`select tree_wheel, tree_default_view, show_extended_relatives, show_deceased_mark from users`.execute(
        test.owner,
      );
      expect(settings.rows).toHaveLength(ACCOUNTS.length);
      for (const row of settings.rows) {
        expect(row).toEqual({
          tree_wheel: 'zoom',
          tree_default_view: 'family',
          show_extended_relatives: false,
          show_deceased_mark: true,
        });
      }

      // The app role changes the new settings on its own row only, and the lists are enforced.
      const app = test.track(createAppDb(test.config));
      const mine = family.account.member.id;
      type Trx = Parameters<Parameters<ReturnType<typeof app.transaction>['execute']>[0]>[0];
      const asMember = (statement: (trx: Trx) => Promise<unknown>) =>
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${mine}, true)`.execute(trx);
          return statement(trx);
        });
      await asMember((trx) =>
        sql`update users set tree_wheel = 'scroll', tree_default_view = 'fan', show_extended_relatives = true, show_deceased_mark = false where id = ${mine}`.execute(
          trx,
        ),
      );
      const other = family.account.user.id;
      const touched = await asMember((trx) =>
        sql`update users set tree_wheel = 'scroll' where id = ${other}`.execute(trx),
      );
      expect((touched as { numAffectedRows?: bigint }).numAffectedRows ?? 0n).toBe(0n);
      await expect(
        asMember((trx) => sql`update users set tree_wheel = 'spin' where id = ${mine}`.execute(trx)),
      ).rejects.toThrow(/check constraint/);
      await expect(
        asMember((trx) => sql`update users set tree_default_view = 'hourglass' where id = ${mine}`.execute(trx)),
      ).rejects.toThrow(/check constraint/);
      const after = await sql<{ id: string; tree_wheel: string }>`select id, tree_wheel from users`.execute(test.owner);
      expect(after.rows.filter((r) => r.tree_wheel === 'scroll').map((r) => r.id)).toEqual([mine]);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);

  it('the wizard’s one write stores the chart settings with the account', async () => {
    const test = await createTestDatabase();
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
      const row = await sql<{ proc: string }>`
        select pg_get_functiondef('kinship_auth.complete_setup_family(text,text,text,text,text,jsonb,jsonb)'::regprocedure) as proc`.execute(
        test.owner,
      );
      for (const key of ['treeWheel', 'treeDefaultView', 'showExtendedRelatives', 'showDeceasedMark', 'nameForm']) {
        expect(row.rows[0]!.proc).toContain(`'${key}'`);
      }
    } finally {
      await test.cleanup();
    }
  }, 60_000);
});
