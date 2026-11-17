// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

const FILE = '0015_union_place.sql';

describe('migration 0015 on a populated database (migrations 0001 to 0014 with the Hale family)', () => {
  it('changes no data, gives every relationship an empty place, and lets the app role write it, with the row-level rules unchanged', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 15);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0014_updates_and_whats_new');
      const family = await buildFamily(test.owner);

      const snapshot = async () => ({
        people: (await sql`select * from people order by id`.execute(test.owner)).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();
      expect(beforeData.unions.length).toBeGreaterThan(0);

      await cp(join(realMigrationsDir, FILE), join(dir.dir, FILE));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0015_union_place']);
      expect((await sql`select schema_number from schema_info`.execute(test.owner)).rows).toEqual([
        { schema_number: 15 },
      ]);

      // Every row is as it was, plus an empty place.
      const after = await snapshot();
      expect(after.people).toEqual(beforeData.people);
      expect(after.parents).toEqual(beforeData.parents);
      expect(after.unions).toEqual(beforeData.unions.map((row) => ({ ...(row as object), place: null })));

      // The column refuses blank text and text with stray spaces; NULL is "none".
      const owner = (value: string | null) =>
        sql`update unions set place = ${value} where id = ${family.union.walterRosa}`.execute(test.owner);
      await expect(owner('')).rejects.toThrow();
      await expect(owner(' Madrid')).rejects.toThrow();
      await expect(owner('x'.repeat(201))).rejects.toThrow();
      await owner('Madrid, Spain');
      await owner(null);

      // The app role may write it, only on the rows row-level security lets it change.
      const app = test.track(createAppDb(test.config));
      const as = async (id: string, query: ReturnType<typeof sql>) =>
        app.transaction().execute(async (trx) => {
          await sql`select set_config('kinship.user_id', ${id}, true)`.execute(trx);
          return query.execute(trx);
        });
      const set = (union: string) => sql`update unions set place = 'Madrid, Spain' where id = ${union}`;
      expect((await as(family.account.superadmin.id, set(family.union.walterRosa))).numAffectedRows).toBe(1n);
      // The Member is Marcus: in his own relationship, yes; in his grandparents', no.
      expect((await as(family.account.member.id, set(family.union.marcusPriya))).numAffectedRows).toBe(1n);
      expect((await as(family.account.member.id, set(family.union.walterRosa))).numAffectedRows).toBe(0n);
      expect((await as(family.account.user.id, set(family.union.marcusPriya))).numAffectedRows).toBe(0n);
      const places = await sql<{ id: string; place: string | null }>`select id, place from unions order by id`.execute(
        test.owner,
      );
      expect(
        places.rows
          .filter((r) => r.place !== null)
          .map((r) => r.id)
          .sort(),
      ).toEqual([family.union.walterRosa, family.union.marcusPriya].sort());
      // It can still not write what it never could.
      await expect(
        as(
          family.account.superadmin.id,
          sql`update unions set status_auto = true where id = ${family.union.walterRosa}`,
        ),
      ).rejects.toThrow();
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});
