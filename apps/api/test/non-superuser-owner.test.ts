// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ADR 0001 says the owner role is a superuser by default, and that a self-hoster who wants more can
// use a plain role that owns the database and may create roles. This proves it: every migration runs
// as such a role, and sign-in, first-run setup, people, relationships and row-level security (forced
// on the tree tables) all work. It also records why row-level security is NOT forced on `users` and
// `family_tree`: the SECURITY DEFINER sign-in and setup functions run as the owner, and forcing
// the policies on the owner would lock them out.
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prepareSetupToken } from '../src/auth/startup.js';
import type { DbConfig } from '../src/config.js';
import { createAppDb, createDb } from '../src/db.js';
import type { AnySchema, UntypedDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { readVersion } from '../src/version.js';
import { PASSWORD, cookieHeader, login, post, CSRF } from './helpers/app.js';
import { server } from './helpers/db.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';

const id = randomBytes(5).toString('hex');
const config: DbConfig = {
  host: server.host,
  port: server.port,
  name: `kinship_nsu_${id}`,
  ownerUser: `kinship_owner_${id}`,
  ownerPassword: `owner-${id}-password`,
  appUser: `kinship_nsuapp_${id}`,
  appPassword: `app-${id}-password`,
};

let admin: UntypedDb;
let owner: UntypedDb;
let db: ReturnType<typeof createAppDb>;
let app: ReturnType<typeof buildApp>;
let token = '';

beforeAll(async () => {
  admin = createDb<AnySchema>(
    { host: server.host, port: server.port, name: 'postgres' },
    server.user,
    server.password,
    1,
  );
  // A plain role: may log in, may create roles (to make the app role), owns its database. Nothing else.
  await sql`create role ${sql.id(config.ownerUser)} login nosuperuser nocreatedb createrole nobypassrls password ${sql.lit(config.ownerPassword)}`.execute(
    admin,
  );
  await sql`create database ${sql.id(config.name)} owner ${sql.id(config.ownerUser)}`.execute(admin);
  owner = createDb<AnySchema>(config, config.ownerUser, config.ownerPassword, 2);
  await ensureAppRole(owner, config.appUser, config.appPassword);
  await runMigrations(owner, { dir: realMigrationsDir, appRole: config.appUser });
  db = createAppDb(config);
  app = buildApp({
    db,
    version: readVersion('abc1234'),
    logLevel: 'silent',
    sessions: { idleSeconds: 3600, maxSeconds: 86_400 },
    failureDelayMs: 0,
    loginRequestsPerMinute: 10_000,
  });
  await app.ready();
  let printed = '';
  await prepareSetupToken(db, 'http://kin.example', (text) => (printed = text));
  token = /^\s{4}(\S+)$/m.exec(printed)?.[1] ?? '';
});

afterAll(async () => {
  await app.close();
  await db.destroy();
  await owner.destroy();
  await sql`drop database if exists ${sql.id(config.name)} with (force)`.execute(admin);
  await sql`drop role if exists ${sql.id(config.appUser)}`.execute(admin);
  await sql`drop role if exists ${sql.id(config.ownerUser)}`.execute(admin);
  await admin.destroy();
});

describe('migrations and flows run as a role that is not a superuser', () => {
  it('really is not a superuser, and the app role cannot bypass row-level security', async () => {
    const roles = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>`
      select rolname, rolsuper, rolbypassrls from pg_roles where rolname in (${config.ownerUser}, ${config.appUser})`.execute(
      admin,
    );
    expect(roles.rows.every((r) => !r.rolsuper && !r.rolbypassrls)).toBe(true);
    expect(roles.rows).toHaveLength(2);
  });

  it('forces row-level security on the people tables', async () => {
    const forced = await sql<{ relname: string; relforcerowsecurity: boolean }>`
      select relname, relforcerowsecurity from pg_class where relname in ('people', 'unions', 'person_parents') order by relname`.execute(
      owner,
    );
    expect(forced.rows).toEqual([
      { relname: 'people', relforcerowsecurity: true },
      { relname: 'person_parents', relforcerowsecurity: true },
      { relname: 'unions', relforcerowsecurity: true },
    ]);
  });

  it('first-run setup creates the account, the tree and the first person, linked', async () => {
    const response = await post(app, '/api/setup', {
      token,
      displayName: 'Marcus Hale',
      email: 'marcus@example.com',
      password: PASSWORD,
      treeName: 'Hale Family',
      person: { givenName: 'Marcus', surname: 'Hale' },
    });
    expect(response.statusCode).toBe(201);
    const me = response.json() as { user: { personId: string | null; role: string } };
    expect(me.user.role).toBe('superadmin');
    expect(me.user.personId).toEqual(expect.any(String));
    // Forced row-level security applies to the owner too: with nobody signed in it sees no people at all.
    const asOwner = await sql`select id from people`.execute(owner);
    expect(asOwner.rows).toEqual([]);
    const cookie = cookieHeader(await login(app, 'marcus@example.com'));
    const list = await app.inject({ method: 'GET', url: '/api/people', headers: { ...CSRF, cookie } });
    expect((list.json() as { items: Array<{ givenName: string }> }).items.map((p) => p.givenName)).toEqual(['Marcus']);
  });

  it('signs in, creates people and relationships, adds a child and deletes a person', async () => {
    const cookie = cookieHeader(await login(app, 'marcus@example.com'));
    const send = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
      const r = await app.inject({
        method,
        url,
        headers: { ...CSRF, cookie },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const me = (await send('GET', '/api/auth/me')).body?.user.personId as string;
    const priya = (await send('POST', '/api/people', { givenName: 'Priya', surname: 'Nair' })).body?.person
      .id as string;
    const union = await send('POST', '/api/unions', {
      partnerIds: [me, priya],
      status: 'married',
      start: { value: '2013-06-08' },
    });
    expect(union.status).toBe(201);
    const leo = await send('POST', `/api/people/${me}/children`, {
      child: { givenName: 'Leo', surname: 'Hale' },
      unionId: union.body?.union.id,
    });
    expect(leo.status).toBe(201);
    expect((await send('GET', `/api/tree/${me}?up=1&down=1`)).body?.people).toHaveLength(3);
    expect((await send('DELETE', `/api/people/${priya}`)).status).toBe(409);
    expect((await send('DELETE', `/api/people/${priya}?confirm=true`)).status).toBe(204);
    expect((await send('GET', `/api/people/${leo.body?.person.id}`)).body?.parents.birth).toMatchObject({
      unionId: null,
      parentId: me,
    });
  });

  it('applies the Member rules too (the helpers run as the non-superuser owner, under forced row-level security)', async () => {
    const adminCookie = cookieHeader(await login(app, 'marcus@example.com'));
    const created = await app.inject({
      method: 'POST',
      url: '/api/people',
      headers: { ...CSRF, cookie: adminCookie },
      payload: { givenName: 'Sofia', surname: 'Hale' },
    });
    const sofia = (created.json() as { person: { id: string } }).person.id;
    const hash = (await sql<{ password_hash: string }>`select password_hash from users limit 1`.execute(owner)).rows[0]!
      .password_hash;
    await sql`insert into users (email, display_name, password_hash, role, person_id)
              values ('member@example.com', 'Member', ${hash}, 'member', ${sofia})`.execute(owner);
    const cookie = cookieHeader(await login(app, 'member@example.com'));
    const asMember = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
      app.inject({ method, url, headers: { ...CSRF, cookie }, payload: payload as object });
    expect(
      (await asMember('POST', `/api/people/${sofia}/children`, { child: { givenName: 'Kid', surname: 'Hale' } }))
        .statusCode,
    ).toBe(201);
    expect((await asMember('PATCH', `/api/people/${sofia}`, { surname: 'Hale-Ruiz' })).statusCode).toBe(200);
    expect((await asMember('POST', '/api/people', { givenName: 'No', surname: 'Way' })).statusCode).toBe(403);
  });

  it('sets and reverts Widowed from a Member marking their descendant deceased, in a relationship the Member is not in', async () => {
    const adminCookie = cookieHeader(await login(app, 'marcus@example.com'));
    const memberCookie = cookieHeader(await login(app, 'member@example.com'));
    const call = async (cookie: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
      const r = await app.inject({
        method,
        url,
        headers: { ...CSRF, cookie },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return r.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const sofia = (await call(memberCookie, 'GET', '/api/auth/me')).user.personId as string;
    const kid = (
      await call(memberCookie, 'POST', `/api/people/${sofia}/children`, {
        child: { givenName: 'Widow', surname: 'Test' },
      })
    ).person.id as string;
    const spouse = (await call(adminCookie, 'POST', '/api/people', { givenName: 'Out', surname: 'Law' })).person
      .id as string;
    const union = (await call(adminCookie, 'POST', '/api/unions', { partnerIds: [kid, spouse], status: 'married' }))
      .union.id as string;
    // The Member cannot edit that relationship: it does not include them.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/unions/${union}`,
          headers: { ...CSRF, cookie: memberCookie },
          payload: { status: 'divorced' },
        })
      ).statusCode,
    ).toBe(403);

    await call(memberCookie, 'PATCH', `/api/people/${kid}`, { deceased: true });
    expect((await call(adminCookie, 'GET', `/api/unions/${union}`)).union).toMatchObject({
      status: 'widowed',
      statusAuto: true,
    });
    await call(memberCookie, 'PATCH', `/api/people/${kid}`, { deceased: false });
    expect((await call(adminCookie, 'GET', `/api/unions/${union}`)).union).toMatchObject({
      status: 'married',
      statusAuto: false,
    });
  });
});

describe('why row-level security is not forced on users and family_tree', () => {
  it('forcing it on users would lock the owner-run sign-in function out of the accounts', async () => {
    const before = await sql<{
      n: string;
    }>`select count(*) as n from kinship_auth.find_login('marcus@example.com')`.execute(db);
    expect(before.rows[0]?.n).toBe('1');
    await sql`alter table users force row level security`.execute(owner);
    try {
      const after = await sql<{
        n: string;
      }>`select count(*) as n from kinship_auth.find_login('marcus@example.com')`.execute(db);
      expect(after.rows[0]?.n).toBe('0'); // sign-in can no longer find anybody
    } finally {
      await sql`alter table users no force row level security`.execute(owner);
    }
    const restored = await sql<{
      n: string;
    }>`select count(*) as n from kinship_auth.find_login('marcus@example.com')`.execute(db);
    expect(restored.rows[0]?.n).toBe('1');
  });

  it('invites and accepts, with row-level security on account_links but not forced (the definer functions are the owner)', async () => {
    const flags = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'account_links'`.execute(owner);
    expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const cookie = cookieHeader(await login(app, 'marcus@example.com'));
    const made = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      headers: { ...CSRF, cookie },
      payload: { email: 'guest@example.com', role: 'user' },
    });
    expect(made.statusCode).toBe(201);
    const accepted = await post(app, '/api/links/accept', {
      token: (made.json() as { token: string }).token,
      password: PASSWORD,
      displayName: 'Guest Hale',
    });
    expect(accepted.statusCode).toBe(201);
    expect((accepted.json() as { user: { role: string } }).user.role).toBe('user');
  });
});

describe('linking an account to a person (migration 0016) as a role that is not a superuser', () => {
  it('previews, links, changes and unlinks; refuses a placeholder; the helpers stay out of the app role', async () => {
    const adminCookie = cookieHeader(await login(app, 'marcus@example.com'));
    const call = async (method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: unknown) => {
      const r = await app.inject({
        method,
        url,
        headers: { ...CSRF, cookie: adminCookie },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const guest = (await sql<{ id: string }>`select id from users where email = 'guest@example.com'`.execute(owner)).rows[0]!.id;
    const person = (await call('POST', '/api/people', { givenName: 'Ada', surname: 'Hale' })).body?.person.id as string;
    // A placeholder with a relationship (so it is not cleaned up): a sibling of a person with no parents.
    const lonely = (await call('POST', '/api/people', { givenName: 'Lone', surname: 'Hale' })).body?.person.id as string;
    const sibling = await call('POST', `/api/people/${lonely}/siblings`, { sibling: { givenName: 'Twin', surname: 'Hale' } });
    expect(sibling.status).toBe(201);
    const placeholder = (await sql<{ id: string }>`select id from people where is_placeholder limit 1`.execute(owner)).rows;
    // The owner sees nothing without a signed-in account (forced RLS); read the placeholder as the admin.
    const parents = (await call('GET', `/api/people/${lonely}`)).body?.parents.birth;
    expect(placeholder).toEqual([]);
    const placeholderId = (parents.unionId
      ? (await call('GET', `/api/unions/${parents.unionId}`)).body?.union.partnerIds[0]
      : parents.parentId) as string;

    expect((await call('GET', `/api/admin/accounts/${guest}/link-preview?personId=${person}`)).status).toBe(200);
    expect((await call('PUT', `/api/admin/accounts/${guest}/person`, { personId: placeholderId, currentPersonId: null })).body?.error).toBe('person_is_placeholder');
    expect((await call('PUT', `/api/admin/accounts/${guest}/person`, { personId: person, currentPersonId: null })).status).toBe(200);
    expect((await call('PUT', `/api/admin/accounts/${guest}/person`, { personId: lonely, currentPersonId: person })).status).toBe(200);
    expect((await call('DELETE', `/api/admin/accounts/${guest}/person?currentPersonId=${lonely}`)).status).toBe(204);
    expect(
      (await call('POST', '/api/admin/invitations', { email: 'ghost@example.com', role: 'user', personId: placeholderId })).body?.error,
    ).toBe('person_is_placeholder');

    // The two internal setup helpers are still out of the app role's reach (0016 grants by name, not "all functions").
    const reach = await sql<{ fn: string; ok: boolean }>`
      select p.proname as fn, has_function_privilege(${config.appUser}, p.oid, 'EXECUTE') as ok
        from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'kinship_auth' and p.proname in ('setup_insert_person', 'setup_insert_union') order by 1`.execute(owner);
    expect(reach.rows).toEqual([
      { fn: 'setup_insert_person', ok: false },
      { fn: 'setup_insert_union', ok: false },
    ]);
  });
});
