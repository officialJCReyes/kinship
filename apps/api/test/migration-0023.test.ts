// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreBackup } from '../src/backup/restore.js';
import { migrateWithSafetyCopy } from '../src/backup/upgrade.js';
import { createAppDb } from '../src/db.js';
import type { UntypedDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { listPeople, normalizeSearchWords } from '../src/people/store.js';
import { USER_SETTING } from '../src/request-context.js';
import { buildFamily } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

/** The newest migration number (never written into a test: a later migration moves it). */
const LATEST = readdirSync(realMigrationsDir).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length;
const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const hasSearchName = async (owner: UntypedDb) =>
  (
    await sql<{ n: string }>`select count(*)::text as n from information_schema.columns
      where table_schema = 'public' and table_name = 'people' and column_name = 'search_name'`.execute(owner)
  ).rows[0]?.n === '1';

/** A test database migrated up to `upTo` with the Hale family in it. */
async function populated(upTo: number) {
  const test = await createTestDatabase();
  cleanups.push(() => test.cleanup());
  const dir = await tempMigrationsDir(true);
  cleanups.push(() => dir.remove());
  await removeMigrationsFrom(dir.dir, upTo + 1);
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
  const family = await buildFamily(test.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(test.owner);
  // Accents and a married surname, so the search below has something to fold and something beyond the first surname.
  await sql`update people set given_name = 'Rosá', married_surname = 'Hale' where id = ${family.person.rosa}`.execute(
    test.owner,
  );
  return { test, dir, family };
}

/** Searches as the app role, through the same code as GET /api/people. */
async function search(test: Awaited<ReturnType<typeof populated>>['test'], userId: string, q: string) {
  const app = test.track(createAppDb(test.config));
  return app.transaction().execute(async (trx) => {
    await sql`select set_config(${USER_SETTING}, ${userId}, true)`.execute(trx);
    const words = await normalizeSearchWords(trx, q);
    return (await listPeople(trx, { words, limit: 50, after: undefined })).rows.map((r) => r.given_name);
  });
}

describe('migration 0023 drops people.search_name', () => {
  it('on a populated database: the column goes, every row stays, and search still works', async () => {
    const { test, dir, family } = await populated(22);
    expect(await hasSearchName(test.owner)).toBe(true);
    const rows = async () =>
      (
        await sql`select id, given_name, surname, married_surname, search_names from people order by id`.execute(
          test.owner,
        )
      ).rows;
    const before = await rows();

    await cp(join(realMigrationsDir, '0023_drop_search_name.sql'), join(dir.dir, '0023_drop_search_name.sql'));
    const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
    expect(result.applied).toEqual(['0023_drop_search_name']);

    expect(await hasSearchName(test.owner)).toBe(false);
    expect(await rows()).toEqual(before);
    // Accent- and case-insensitive, every word must match, the married surname counts.
    expect(await search(test, family.account.member.id, 'rosa hale')).toEqual(['Rosá']);
    expect(await search(test, family.account.member.id, 'ROSÁ mendez')).toEqual(['Rosá']);
    expect(await search(test, family.account.member.id, 'rosa nair')).toEqual([]);
  }, 60_000);

  it('from 0.2.1 (schema 16): the safety copy is named -0016-to-<latest>, and restoring it into this build drops the column again', async () => {
    const { test, family } = await populated(16);
    expect(await hasSearchName(test.owner)).toBe(true);
    const backups = mkdtempSync(join(tmpdir(), 'kinship-0023-'));
    cleanups.push(() => rmSync(backups, { recursive: true, force: true }));
    const config = { ...testConfig(test, backups, PASS), migrationsDir: realMigrationsDir };
    const ctx = { config, tools: testTools(), log: () => undefined, appVersion: '0.3.0-test', kdf: CHEAP };

    // The upgrade from 0.2.1, as the api does it at start-up: the copy first, then every migration up to this build's.
    const upgraded = await migrateWithSafetyCopy(ctx);
    const pad = (n: number) => String(n).padStart(4, '0');
    expect(LATEST).toBeGreaterThanOrEqual(23);
    expect(upgraded).toMatchObject({ fromSchema: 16, toSchema: LATEST });
    expect(upgraded.safetyCopy).toBe(`pre-upgrade-0016-to-${pad(LATEST)}.tar.enc`);
    expect(upgraded.applied).toContain('0023_drop_search_name');
    expect(await hasSearchName(test.owner)).toBe(false);
    const people = (await sql<{ n: string }>`select count(*)::text as n from people`.execute(test.owner)).rows[0]?.n;

    // The safety copy is a schema 16 backup that still holds the column. Restoring it into this build replays it and then runs
    // 0017 to the newest migration again, so the column is gone afterwards and nothing is lost.
    await sql`insert into people (given_name, surname) values ('Added', 'Later')`.execute(test.owner);
    const report = await restoreBackup(ctx, join(backups, upgraded.safetyCopy as string), {
      progress: () => undefined,
      confirm: () => Promise.resolve(true),
    });
    expect(report.cancelled).toBe(false);
    expect(report.manifest.schema).toBe(16);
    expect(report.migrationsApplied).toContain('0017_names');
    expect(report.migrationsApplied).toContain('0023_drop_search_name');
    expect(await hasSearchName(test.owner)).toBe(false);
    expect((await sql<{ n: number }>`select schema_number as n from schema_info`.execute(test.owner)).rows[0]?.n).toBe(
      LATEST,
    );
    expect((await sql<{ n: string }>`select count(*)::text as n from people`.execute(test.owner)).rows[0]?.n).toBe(
      people,
    );
    expect(await search(test, family.account.member.id, 'rosa hale')).toEqual(['Rosá']);
  }, 180_000);
});
