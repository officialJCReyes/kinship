// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { withUserTransaction } from '../src/request-context.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

const FILE = '0026_mail_outbox_and_templates.sql';

describe('migration 0026 on a populated database (migrations 0001 to 0025 with the Hale family)', () => {
  it('changes no data, adds two empty tables, and gives the app role only what it needs', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 26);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0025_drop_surname_particle');
      const family = await buildFamily(test.owner);
      await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);

      const snapshot = async () => ({
        users: (await sql`select * from users order by id`.execute(test.owner)).rows,
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        settings: (await sql`select * from app_settings order by key`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();

      await cp(join(realMigrationsDir, FILE), join(dir.dir, FILE));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0026_mail_outbox_and_templates']);
      expect(await snapshot()).toEqual(beforeData);
      expect((await sql`select schema_number from schema_info`.execute(test.owner)).rows).toEqual([
        { schema_number: 26 },
      ]);
      expect((await sql`select * from mail_outbox`.execute(test.owner)).rows).toEqual([]);
      expect((await sql`select * from mail_template_overrides`.execute(test.owner)).rows).toEqual([]);

      // Row-level security on both, forced on neither (the owner sends the mail and makes the backups).
      const rls = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>`
        select relname, relrowsecurity, relforcerowsecurity from pg_class
         where relname in ('mail_outbox', 'mail_template_overrides') order by relname`.execute(test.owner);
      expect(rls.rows).toEqual([
        { relname: 'mail_outbox', relrowsecurity: true, relforcerowsecurity: false },
        { relname: 'mail_template_overrides', relrowsecurity: true, relforcerowsecurity: false },
      ]);
      const grants = await sql<{ table_name: string; privilege_type: string }>`
        select table_name, privilege_type from information_schema.role_table_grants
         where grantee = ${test.config.appUser} and table_name in ('mail_outbox', 'mail_template_overrides')
         order by table_name, privilege_type`.execute(test.owner);
      expect(grants.rows).toEqual([
        { table_name: 'mail_template_overrides', privilege_type: 'DELETE' },
        { table_name: 'mail_template_overrides', privilege_type: 'INSERT' },
        { table_name: 'mail_template_overrides', privilege_type: 'SELECT' },
        { table_name: 'mail_template_overrides', privilege_type: 'UPDATE' },
      ]);

      // Template text: anyone may read it (a message can be queued with nobody signed in), only the SuperAdmin may change it.
      const app = createAppDb(test.config);
      try {
        const write = (who: string | null, subject: string) =>
          withUserTransaction(app, who, (trx) =>
            sql`insert into mail_template_overrides (template, subject) values ('invitation', ${subject})
                on conflict (template) do update set subject = excluded.subject`.execute(trx),
          );
        for (const who of [family.account.familyadmin.id, family.account.member.id, null]) {
          await expect(write(who, 'Not allowed')).rejects.toThrow(/row-level security/);
        }
        await write(family.account.superadmin.id, 'Join the Hale tree');
        for (const who of [family.account.user.id, null]) {
          const read = await withUserTransaction(app, who, (trx) =>
            sql<{ subject: string }>`select subject from mail_template_overrides`.execute(trx),
          );
          expect(read.rows).toEqual([{ subject: 'Join the Hale tree' }]);
        }
        const removed = await withUserTransaction(app, family.account.familyadmin.id, (trx) =>
          sql`delete from mail_template_overrides`.execute(trx),
        );
        expect(Number(removed.numAffectedRows)).toBe(0);
        // A subject with a line break, or blocks that are not an object, are refused by the table itself.
        await expect(write(family.account.superadmin.id, 'Hi\r\nBcc: x@y.example')).rejects.toThrow(/check/);
        await expect(
          withUserTransaction(app, family.account.superadmin.id, (trx) =>
            sql`insert into mail_template_overrides (template, blocks) values ('password_reset', '[]'::jsonb)`.execute(
              trx,
            ),
          ),
        ).rejects.toThrow(/check/);
      } finally {
        await app.destroy();
      }
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
