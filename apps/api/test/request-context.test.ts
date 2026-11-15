// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import type { Database } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { USER_SETTING, withUserTransaction } from '../src/request-context.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import type { Kysely } from 'kysely';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

let test: TestDatabase;
/** One connection only, so the "reset" checks run on the very connection the transaction used. */
let db: Kysely<Database>;

async function currentSetting(
  executor: Kysely<Database> | Parameters<Parameters<typeof withUserTransaction>[2]>[0],
): Promise<string | null> {
  const result = await sql<{ value: string | null }>`select current_setting(${USER_SETTING}, true) as value`.execute(
    executor,
  );
  return result.rows[0]?.value ?? null;
}

beforeAll(async () => {
  test = await createTestDatabase();
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
  db = test.track(createDb<Database>(test.config, test.config.appUser, test.config.appPassword, 1));

  // A table protected by row-level security, the way real tables will be.
  await sql`create table notes (id serial primary key, owner_id uuid not null, body text not null)`.execute(test.owner);
  await sql`alter table notes enable row level security`.execute(test.owner);
  await sql`alter table notes force row level security`.execute(test.owner);
  await sql`create policy own_notes on notes using (owner_id = nullif(current_setting('kinship.user_id', true), '')::uuid)`.execute(
    test.owner,
  );
  await sql`insert into notes (owner_id, body) values (${ALICE}, 'alice note'), (${BOB}, 'bob note')`.execute(
    test.owner,
  );
});
afterAll(() => test.cleanup());

describe('withUserTransaction', () => {
  it('makes the user visible to Postgres inside the transaction', async () => {
    const seen = await withUserTransaction(db, ALICE, (trx) => currentSetting(trx));
    expect(seen).toBe(ALICE);
  });

  it('runs as the app role, not the owner', async () => {
    const who = await withUserTransaction(db, ALICE, async (trx) => {
      const r = await sql<{ current_user: string }>`select current_user`.execute(trx);
      return r.rows[0]?.current_user;
    });
    expect(who).toBe(test.config.appUser);
  });

  it('resets the setting after commit, on the same connection', async () => {
    await withUserTransaction(db, ALICE, async () => undefined);
    expect(await currentSetting(db)).toSatisfy((value: string | null) => value === null || value === '');
  });

  it('resets the setting after a rollback, on the same connection', async () => {
    await expect(
      withUserTransaction(db, ALICE, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await currentSetting(db)).toSatisfy((value: string | null) => value === null || value === '');
  });

  it('gives each request its own user even when they share a connection', async () => {
    expect(await withUserTransaction(db, ALICE, (trx) => currentSetting(trx))).toBe(ALICE);
    expect(await withUserTransaction(db, BOB, (trx) => currentSetting(trx))).toBe(BOB);
    expect(await withUserTransaction(db, null, (trx) => currentSetting(trx))).toBe('');
  });

  it('drives row-level security: each user sees only their own rows, nobody sees none', async () => {
    const bodies = (userId: string | null) =>
      withUserTransaction(db, userId, async (trx) => {
        const r = await sql<{ body: string }>`select body from notes order by id`.execute(trx);
        return r.rows.map((row) => row.body);
      });
    expect(await bodies(ALICE)).toEqual(['alice note']);
    expect(await bodies(BOB)).toEqual(['bob note']);
    expect(await bodies(null)).toEqual([]);
  });

  it('refuses to write a row for someone else', async () => {
    await expect(
      withUserTransaction(db, ALICE, (trx) =>
        sql`insert into notes (owner_id, body) values (${BOB}, 'forged')`.execute(trx),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
