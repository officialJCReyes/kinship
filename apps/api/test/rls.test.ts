// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp, insertUser } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

let t: TestApp;
let alice: string;
let bob: string;

beforeAll(async () => {
  t = await createTestApp();
  alice = await insertUser(t.owner, { email: 'alice@example.com', displayName: 'Alice', role: 'superadmin' });
  bob = await insertUser(t.owner, { email: 'bob@example.com', displayName: 'Bob', role: 'member' });
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  await sql`insert into sessions (user_id, token_hash, expires_at, absolute_expires_at)
            values (${alice}, 'hash-of-a-secret-token', now() + interval '1 day', now() + interval '2 days')`.execute(
    t.owner,
  );
  await sql`insert into setup_token (id, token_hash) values (true, 'hash-of-the-setup-token')`.execute(t.owner);
});
afterAll(() => t.close());

const asUser = <T>(userId: string | null, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);

describe('users: row-level security', () => {
  // 0011 added users_select_admin: an admin (Alice, a SuperAdmin) now reads every account; the other roles still
  // read only their own row (Bob, a Member). This test used to say a SuperAdmin sees only their own row.
  it('shows a Member only their own row, and an admin every account', async () => {
    const seen = (userId: string) =>
      asUser(userId, async (trx) =>
        (await trx.selectFrom('users').select(['id', 'email']).orderBy('email').execute()).map((r) => r.email),
      );
    expect(await seen(bob)).toEqual(['bob@example.com']);
    expect(await seen(alice)).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('shows nothing to a request with nobody signed in', async () => {
    const rows = await asUser(null, (trx) => trx.selectFrom('users').select('id').execute());
    expect(rows).toEqual([]);
  });

  it("does not let a Member read another's row by asking for it", async () => {
    const rows = await asUser(bob, (trx) => trx.selectFrom('users').select('id').where('id', '=', alice).execute());
    expect(rows).toEqual([]);
  });

  it('shows nothing for a made-up user id', async () => {
    const rows = await asUser('99999999-9999-9999-9999-999999999999', (trx) =>
      trx.selectFrom('users').select('id').execute(),
    );
    expect(rows).toEqual([]);
  });

  it('cannot write: no insert, update or delete, not even on the own row', async () => {
    await expect(
      asUser(alice, (trx) => sql`update users set display_name = 'Hacked' where id = ${alice}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(alice, (trx) => sql`delete from users where id = ${alice}`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(alice, (trx) =>
        sql`insert into users (email, display_name, password_hash, role) values ('x@y.zz', 'X', 'h', 'superadmin')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    const names = await sql<{ display_name: string }>`select display_name from users order by email`.execute(t.owner);
    expect(names.rows.map((r) => r.display_name)).toEqual(['Alice', 'Bob']);
  });
});

describe('secrets are not readable by the app role, however it asks', () => {
  it('cannot select password_hash, directly or with *', async () => {
    await expect(asUser(alice, (trx) => sql`select password_hash from users`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(alice, (trx) => sql`select * from users`.execute(trx))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(alice, (trx) => sql`select u.password_hash from users u where u.id = ${alice}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot read or write sessions or the setup token, signed in or not', async () => {
    for (const user of [alice, null]) {
      await expect(asUser(user, (trx) => sql`select * from sessions`.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(user, (trx) => sql`select token_hash from sessions`.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(user, (trx) => sql`delete from sessions`.execute(trx))).rejects.toThrow(/permission denied/);
      await expect(asUser(user, (trx) => sql`select * from setup_token`.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        asUser(user, (trx) => sql`insert into setup_token (id, token_hash) values (true, 'x')`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('cannot reach the migration bookkeeping either', async () => {
    await expect(asUser(alice, (trx) => sql`select * from kysely_migration`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('only exposes the narrow functions, and they are not open to everyone', async () => {
    const open = await sql<{ name: string }>`
      select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kinship_auth' and (p.proacl is null or p.proacl::text ~ '(^\\{|,)=X/')`.execute(t.owner);
    expect(open.rows).toEqual([]); // no function in kinship_auth is executable by PUBLIC
    const definers = await sql<{ n: string }>`
      select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kinship_auth' and not p.prosecdef`.execute(t.owner);
    expect(Number(definers.rows[0]?.n)).toBe(0); // all run as the owner, with a fixed search_path
    const unsafePath = await sql<{ n: string }>`
      select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kinship_auth' and not coalesce(p.proconfig::text ilike '%search_path=pg_catalog, pg_temp%', false)`.execute(
      t.owner,
    );
    expect(Number(unsafePath.rows[0]?.n)).toBe(0);
  });
});

describe('family_tree: only for people who are signed in', () => {
  it('shows the tree name to a signed-in person and nothing to nobody', async () => {
    const signedIn = await asUser(bob, (trx) => trx.selectFrom('family_tree').select('name').execute());
    expect(signedIn).toEqual([{ name: 'Hale Family' }]);
    const anonymous = await asUser(null, (trx) => trx.selectFrom('family_tree').select('name').execute());
    expect(anonymous).toEqual([]);
  });

  it('cannot be changed by the app role', async () => {
    await expect(asUser(alice, (trx) => sql`update family_tree set name = 'Mine now'`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('the app role itself', () => {
  it('has row-level security switched on where it matters', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }>`
      select relname, relrowsecurity from pg_class where relname in ('users', 'family_tree') order by relname`.execute(
      t.owner,
    );
    expect(rows.rows).toEqual([
      { relname: 'family_tree', relrowsecurity: true },
      { relname: 'users', relrowsecurity: true },
    ]);
  });

  it('is still not a superuser, does not bypass row-level security, and owns nothing', async () => {
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>`
      select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = ${t.test.config.appUser}`.execute(
      t.owner,
    );
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    const owned = await sql<{ n: number }>`
      select count(*)::int as n from pg_shdepend d join pg_roles r on r.oid = d.refobjid
      where r.rolname = ${t.test.config.appUser} and d.deptype = 'o'`.execute(t.owner);
    expect(owned.rows[0]?.n).toBe(0);
  });
});
