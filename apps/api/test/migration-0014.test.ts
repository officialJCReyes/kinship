// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { readCheckState, writeCheckState } from '../src/updates/state.js';
import { readUpdateSettings, writeUpdateSettings } from '../src/updates/settings.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

const FILE = '0014_updates_and_whats_new.sql';

describe('migration 0014 on a populated database (migrations 0001 to 0013 with the Hale family)', () => {
  it('changes no data, leaves existing accounts untracked, and keeps the new table and columns to the right roles', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 14);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0013_backup_settings_and_upgrade_log');
      const family = await buildFamily(test.owner);
      await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
      await sql`update schema_info set app_version = '0.1.0-alpha.2'`.execute(test.owner);

      const snapshot = async () => ({
        users: (
          await sql`select id, email, display_name, role, person_id, color_scheme, theme from users order by id`.execute(
            test.owner,
          )
        ).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
        settings: (await sql`select * from app_settings`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();

      await cp(join(realMigrationsDir, FILE), join(dir.dir, FILE));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0014_updates_and_whats_new']);
      expect(await snapshot()).toEqual(beforeData);
      expect((await sql`select schema_number from schema_info`.execute(test.owner)).rows).toEqual([
        { schema_number: 14 },
      ]);

      // Accounts that existed before the migration predate tracking: NULL (the api reads that as 0.1.0-alpha.2).
      const tracked = await sql<{
        last_seen_version: string | null;
        last_seen_at: Date | null;
        update_dismissed_version: string | null;
        update_backup_ack_version: string | null;
      }>`select last_seen_version, last_seen_at, update_dismissed_version, update_backup_ack_version from users`.execute(
        test.owner,
      );
      expect(tracked.rows).toHaveLength(5);
      for (const row of tracked.rows) {
        expect(row).toEqual({
          last_seen_version: null,
          last_seen_at: null,
          update_dismissed_version: null,
          update_backup_ack_version: null,
        });
      }

      // A new account starts at the running version (a fresh install, every later invitation): no popup for it.
      await sql`update schema_info set app_version = '0.2.0'`.execute(test.owner);
      await sql`insert into users (email, display_name, password_hash, role) values ('new@example.test', 'New', 'x', 'member')`.execute(
        test.owner,
      );
      const fresh = await sql<{ last_seen_version: string; last_seen_at: Date }>`
        select last_seen_version, last_seen_at from users where email = 'new@example.test'`.execute(test.owner);
      expect(fresh.rows[0]?.last_seen_version).toBe('0.2.0');
      expect(fresh.rows[0]?.last_seen_at).toBeInstanceOf(Date);
      // Where the version is not known yet, it stays NULL; an explicit value is kept.
      await sql`update schema_info set app_version = null`.execute(test.owner);
      await sql`insert into users (email, display_name, password_hash, role) values ('later@example.test', 'Later', 'x', 'member')`.execute(
        test.owner,
      );
      await sql`insert into users (email, display_name, password_hash, role, last_seen_version) values ('given@example.test', 'Given', 'x', 'member', '0.0.1')`.execute(
        test.owner,
      );
      const rest = await sql<{ email: string; last_seen_version: string | null }>`
        select email, last_seen_version from users where email in ('later@example.test', 'given@example.test') order by email`.execute(
        test.owner,
      );
      expect(rest.rows).toEqual([
        { email: 'given@example.test', last_seen_version: '0.0.1' },
        { email: 'later@example.test', last_seen_version: null },
      ]);
      await expect(
        sql`update users set last_seen_version = '' where email = 'new@example.test'`.execute(test.owner),
      ).rejects.toThrow();

      const app = test.track(createAppDb(test.config));
      const as = async (id: string, query: ReturnType<typeof sql>) =>
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${id}, true)`.execute(trx);
          return query.execute(trx);
        });
      const superadmin = family.account.superadmin.id;

      // Each account may read and set its own four columns, and nobody else's; nothing else about it.
      for (const id of [superadmin, family.account.familyadmin.id, family.account.member.id]) {
        await as(
          id,
          sql`update users set last_seen_version = '0.2.0', last_seen_at = now(), update_dismissed_version = '0.3.0', update_backup_ack_version = '0.3.0' where id = ${id}`,
        );
        const mine = await as(id, sql`select last_seen_version, update_dismissed_version from users where id = ${id}`);
        expect(mine.rows).toEqual([{ last_seen_version: '0.2.0', update_dismissed_version: '0.3.0' }]);
      }
      const other = await as(
        family.account.member.id,
        sql`update users set last_seen_version = 'x' where id = ${superadmin}`,
      );
      expect(other.numAffectedRows).toBe(0n);
      await expect(as(superadmin, sql`update users set role = 'user' where id = ${superadmin}`)).rejects.toThrow(
        /permission denied/,
      );

      // update_check: one row, only a SuperAdmin reads it, nobody writes it as the app role.
      expect((await as(superadmin, sql`select status from update_check`)).rows).toEqual([{ status: 'never' }]);
      for (const other of [family.account.familyadmin.id, family.account.member.id, family.account.user.id]) {
        expect((await as(other, sql`select status from update_check`)).rows).toEqual([]);
      }
      for (const statement of [
        sql`update update_check set status = 'ok'`,
        sql`insert into update_check (id) values (false)`,
        sql`delete from update_check`,
      ]) {
        await expect(as(superadmin, statement)).rejects.toThrow(/permission denied/);
      }
      await expect(sql`insert into update_check (id) values (false)`.execute(test.owner)).rejects.toThrow();
      await expect(sql`update update_check set status = 'weird'`.execute(test.owner)).rejects.toThrow();

      // The state round-trips as the owner, and a SuperAdmin sees it.
      const now = new Date('2026-12-01T10:00:00Z');
      await writeCheckState(test.owner, {
        status: 'ok',
        lastAttemptAt: now,
        lastSuccessAt: now,
        nextCheckAt: new Date('2026-12-02T10:00:00Z'),
        failures: 0,
        etag: 'W/"abc"',
        releases: [
          {
            version: '0.3.0',
            date: '2026-12-01',
            channel: 'stable',
            security: false,
            breaking: false,
            migration: true,
            notes: 'x',
            upgradeNotes: null,
            details: true,
            githubUpdatedAt: '2026-12-01T09:00:00Z',
          },
        ],
      });
      const state = await readCheckState(test.owner);
      expect(state).toMatchObject({ status: 'ok', etag: 'W/"abc"', failures: 0 });
      expect(state.releases.map((r) => r.version)).toEqual(['0.3.0']);
      expect((await as(superadmin, sql`select etag from update_check`)).rows).toEqual([{ etag: 'W/"abc"' }]);

      // The three switches: defaults, then saved by a SuperAdmin through the same table.
      expect(await readUpdateSettings(test.owner)).toEqual({ check: true, preReleases: false, safetyCopy: true });
      await app.transaction().execute(async (trx) => {
        await sql`select set_config('kinship.user_id', ${superadmin}, true)`.execute(trx);
        await writeUpdateSettings(trx, { check: false, safetyCopy: false }, superadmin);
        expect(await readUpdateSettings(trx)).toEqual({ check: false, preReleases: false, safetyCopy: false });
      });
      expect(await readUpdateSettings(test.owner)).toEqual({ check: false, preReleases: false, safetyCopy: false });
      // A value that is not true or false is ignored.
      await sql`update app_settings set value = '"yes"'::jsonb where key = 'updates.check'`.execute(test.owner);
      expect((await readUpdateSettings(test.owner)).check).toBe(true);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);

  it('reads the defaults, and an empty state, on a database that has not been migrated to 0013 or 0014 yet', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 13);
      await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(await readUpdateSettings(test.owner)).toEqual({ check: true, preReleases: false, safetyCopy: true });
      expect((await readCheckState(test.owner)).status).toBe('never');
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
