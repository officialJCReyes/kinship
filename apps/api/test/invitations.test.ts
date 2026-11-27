// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Invitations by copied link (migration 0011, ADR 0012): who may invite whom, what the database refuses on its own,
// what a link can and cannot do, and that every bad link looks the same.
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_ERROR_CODES, ACCOUNT_ROUTES, en, ROLES_INVITABLE_BY } from '@kinship/shared';
import type { Role } from '@kinship/shared';
import { withUserTransaction } from '../src/request-context.js';
import { cookieHeader, login, post, sessionCookie, CSRF } from './helpers/app.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, signInAll } from './helpers/family.js';
import type { Family, Json, Who } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const registered: string[] = [];
let counter = 0;
const email = (prefix = 'new') => `${prefix}${(counter += 1)}@hale.example`;
const NEW_PASSWORD = 'a long new passphrase';

beforeAll(async () => {
  t = await createTestApp({}, (app) => {
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) registered.push(`${method} ${route.url}`);
    });
  });
  f = await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

const asUser = <T>(userId: string | null, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

async function invite(who: Who, role: string, extra: Json = {}) {
  return as(who, 'POST', '/api/admin/invitations', { email: email(), role, ...extra });
}
const lookup = (token: string) => post(t.app, '/api/links/lookup', { token });
const accept = (token: string, body: Json = {}) =>
  post(t.app, '/api/links/accept', { token, password: NEW_PASSWORD, displayName: 'Nina Okafor', ...body });
const parse = (response: { statusCode: number; body: string }) => ({
  status: response.statusCode,
  body: response.body ? (JSON.parse(response.body) as Json) : null,
});

describe('routes and messages', () => {
  it('registers exactly the account routes the shared package lists', () => {
    // The backup, files and mail routes (also under /api/admin) have their own tables and checks in contract.test.ts.
    const mine = registered
      .filter(
        (r) =>
          /^\w+ \/api\/(admin|links)\//.test(r) &&
          !/\/api\/admin\/(backups|files|mail)/.test(r) &&
          !r.startsWith('HEAD '),
      )
      .sort();
    const declared = ACCOUNT_ROUTES.filter((r) => /^\/api\/(admin|links)\//.test(r.path))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(mine).toEqual(declared);
  });

  it('has an English message for every account error code', () => {
    for (const code of ACCOUNT_ERROR_CODES) expect(en, code).toHaveProperty(`error.${code}`);
  });
});

describe('who may invite which role', () => {
  const callers: Who[] = ['anonymous', 'superadmin', 'familyadmin', 'member', 'unlinked', 'user'];
  const callerRole: Record<Who, Role | null> = {
    anonymous: null,
    superadmin: 'superadmin',
    familyadmin: 'familyadmin',
    member: 'member',
    unlinked: 'member',
    user: 'user',
  };
  const roles: Role[] = ['superadmin', 'familyadmin', 'member', 'user'];

  for (const caller of callers) {
    for (const role of roles) {
      const allowed = callerRole[caller] !== null && ROLES_INVITABLE_BY[callerRole[caller]].includes(role);
      it(`${caller} inviting a ${role}: ${allowed ? 'allowed' : 'refused'}`, async () => {
        const response = await invite(caller, role);
        if (allowed) {
          expect(response.status).toBe(201);
          expect(response.body).toMatchObject({ kind: 'invite' });
        } else if (caller === 'anonymous') {
          expect(response.status).toBe(401);
        } else {
          expect(response.status).toBe(403);
          expect(response.body?.['error']).toBe(
            ['superadmin', 'familyadmin'].includes(callerRole[caller]!) ? 'role_not_allowed' : 'forbidden',
          );
        }
      });

      it(`the database says the same to ${caller} inviting a ${role}, whatever the API does`, async () => {
        const id = caller === 'anonymous' ? null : f.account[caller].id;
        const attempt = asUser(id, (trx) =>
          sql`select * from kinship_auth.create_invitation(${email()}, ${role}, null, null, ${sha256(email())})`.execute(
            trx,
          ),
        );
        if (allowed) await expect(attempt).resolves.toBeDefined();
        else await expect(attempt).rejects.toThrow(/forbidden|role_not_allowed/);
      });
    }
  }

  it('lists, regenerates and revokes only for admins', async () => {
    const made = await invite('superadmin', 'member');
    const linkId = made.body?.['linkId'] as string;
    for (const caller of ['anonymous', 'member', 'unlinked', 'user'] as Who[]) {
      const status = caller === 'anonymous' ? 401 : 403;
      expect((await as(caller, 'GET', '/api/admin/accounts')).status).toBe(status);
      expect((await as(caller, 'POST', `/api/admin/links/${linkId}/regenerate`)).status).toBe(status);
      expect((await as(caller, 'POST', `/api/admin/links/${linkId}/revoke`)).status).toBe(status);
    }
    expect((await as('familyadmin', 'GET', '/api/admin/accounts')).status).toBe(200);
    expect((await as('familyadmin', 'POST', `/api/admin/links/${linkId}/regenerate`)).status).toBe(200);
    expect((await as('superadmin', 'POST', `/api/admin/links/${linkId}/revoke`)).status).toBe(204);
  });

  it('a Family Admin cannot touch an invitation for a Family Admin (and is told so), a SuperAdmin can', async () => {
    const made = await invite('superadmin', 'familyadmin');
    const linkId = made.body?.['linkId'] as string;
    expect((await as('familyadmin', 'POST', `/api/admin/links/${linkId}/regenerate`)).body).toEqual({
      error: 'role_not_allowed',
    });
    expect((await as('familyadmin', 'POST', `/api/admin/links/${linkId}/revoke`)).body).toEqual({
      error: 'role_not_allowed',
    });
    const list = (await as('familyadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    expect(list.find((a) => a['id'] === linkId)?.['invitation']).toMatchObject({ canManage: false });
    const asSuper = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    expect(asSuper.find((a) => a['id'] === linkId)?.['invitation']).toMatchObject({ canManage: true });
    expect((await as('superadmin', 'POST', `/api/admin/links/${linkId}/regenerate`)).status).toBe(200);
  });

  it('regenerating keeps the role', async () => {
    const made = await invite('superadmin', 'user');
    const again = await as('superadmin', 'POST', `/api/admin/links/${made.body?.['linkId']}/regenerate`);
    expect(again.body?.['linkId']).toBe(made.body?.['linkId']);
    const info = await lookup(again.body?.['token'] as string);
    expect(parse(info).body).toMatchObject({ kind: 'invite', role: 'user' });
  });
});

describe('the app role cannot reach the table, and the functions guard themselves', () => {
  it('has no access to account_links, signed in or not', async () => {
    for (const user of [f.account.superadmin.id, null]) {
      await expect(asUser(user, (trx) => sql`select * from account_links`.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(user, (trx) => sql`select token_hash from account_links`.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asUser(user, (trx) => sql`delete from account_links`.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        asUser(user, (trx) =>
          sql`insert into account_links (kind, token_hash, expires_at, email, role) values ('invite', 'x', now(), 'a@b.cc', 'user')`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('is also closed by row-level security, which is on and has no policy (checked with a grant added by mistake)', async () => {
    await invite('superadmin', 'member');
    const flags = await sql<{
      on: boolean;
    }>`select relrowsecurity as on from pg_class where relname = 'account_links'`.execute(t.owner);
    expect(flags.rows[0]?.on).toBe(true);
    const policies = await sql`select 1 from pg_policies where tablename = 'account_links'`.execute(t.owner);
    expect(policies.rows).toHaveLength(0);
    const appRole = t.test.config.appUser;
    await sql`grant select, update, delete on account_links to ${sql.id(appRole)}`.execute(t.owner);
    try {
      const seen = await asUser(f.account.superadmin.id, (trx) => sql`select * from account_links`.execute(trx));
      expect(seen.rows).toHaveLength(0);
      const changed = await asUser(f.account.superadmin.id, (trx) =>
        sql`update account_links set note = 'x'`.execute(trx),
      );
      expect(changed.numAffectedRows ?? 0n).toBe(0n);
      const deleted = await asUser(f.account.superadmin.id, (trx) => sql`delete from account_links`.execute(trx));
      expect(deleted.numAffectedRows ?? 0n).toBe(0n);
    } finally {
      await sql`revoke all on account_links from ${sql.id(appRole)}`.execute(t.owner);
    }
  });

  it('refuses every admin function to a Member, a User and nobody', async () => {
    const made = await invite('superadmin', 'member');
    const linkId = made.body?.['linkId'] as string;
    for (const user of [f.account.member.id, f.account.unlinked.id, f.account.user.id, null]) {
      const calls = [
        sql`select * from kinship_auth.list_open_links()`,
        sql`select * from kinship_auth.list_inviters()`,
        sql`select * from kinship_auth.regenerate_link(${linkId}::uuid, 'h1')`,
        sql`select kinship_auth.revoke_link(${linkId}::uuid)`,
        sql`select * from kinship_auth.create_reset_link(${f.account.user.id}::uuid, 'h2')`,
      ];
      for (const call of calls) await expect(asUser(user, (trx) => call.execute(trx))).rejects.toThrow(/forbidden/);
    }
  });

  it('lets an admin read every account but never the password hash', async () => {
    const rows = await asUser(f.account.familyadmin.id, (trx) => trx.selectFrom('users').select('id').execute());
    expect(rows).toHaveLength(5);
    await expect(
      asUser(f.account.superadmin.id, (trx) => sql`select password_hash from users`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    const own = await asUser(f.account.member.id, (trx) => trx.selectFrom('users').select('id').execute());
    expect(own).toHaveLength(1);
  });

  it('stores only the SHA-256 of the token', async () => {
    const made = await invite('superadmin', 'member');
    const token = made.body?.['token'] as string;
    const rows = await sql<{
      row: string;
      token_hash: string;
    }>`select account_links::text as row, token_hash from account_links where id = ${made.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    expect(rows.rows[0]?.token_hash).toBe(sha256(token));
    expect(rows.rows[0]?.row).not.toContain(token);
  });
});

describe('what an invitation checks', () => {
  it('refuses an email that already has an account, ignoring case', async () => {
    for (const address of ['member@example.com', 'MEMBER@Example.com', '  Member@EXAMPLE.com ']) {
      const response = await as('superadmin', 'POST', '/api/admin/invitations', { email: address, role: 'user' });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: 'email_taken' });
    }
  });

  it('is case-insensitively unique in the database itself, not only in the API', async () => {
    await expect(
      sql`insert into users (email, display_name, password_hash, role) values ('Member@example.com', 'X', 'h', 'user')`.execute(
        t.owner,
      ),
    ).rejects.toThrow();
    const index = await sql<{
      indexdef: string;
    }>`select indexdef from pg_indexes where indexname = 'users_email_lower_key'`.execute(t.owner);
    expect(index.rows[0]?.indexdef).toContain('lower(email)');
  });

  it('allows one open invitation per email (any case) and one per person', async () => {
    const address = email('dup');
    const first = await as('superadmin', 'POST', '/api/admin/invitations', { email: address, role: 'user' });
    expect(first.status).toBe(201);
    for (const again of [address, address.toUpperCase()]) {
      const second = await as('familyadmin', 'POST', '/api/admin/invitations', { email: again, role: 'member' });
      expect(second).toMatchObject({ status: 409, body: { error: 'invitation_exists' } });
    }
    const priya = await invite('superadmin', 'member', { personId: f.person.priya });
    expect(priya.status).toBe(201);
    const second = await invite('superadmin', 'user', { personId: f.person.priya });
    expect(second).toMatchObject({ status: 409, body: { error: 'invitation_exists' } });
  });

  it('refuses a person who already has an account, and one who does not exist', async () => {
    expect(await invite('superadmin', 'member', { personId: f.person.marcus })).toMatchObject({
      status: 409,
      body: { error: 'person_already_linked' },
    });
    expect(await invite('superadmin', 'member', { personId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({
      status: 404,
      body: { error: 'person_not_found' },
    });
    expect(await invite('superadmin', 'member', { personId: 'not-a-uuid' })).toMatchObject({ status: 404 });
  });

  it('refuses a bad email, a note over 500 characters and unknown fields', async () => {
    expect(await invite('superadmin', 'user', { email: 'nobody' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_email' },
    });
    expect((await invite('superadmin', 'user', { note: 'x'.repeat(501) })).status).toBe(400);
    expect((await invite('superadmin', 'user', { note: 'x'.repeat(500) })).status).toBe(201);
    expect((await invite('superadmin', 'user', { extra: 1 })).status).toBe(400);
    expect((await invite('superadmin', 'boss')).status).toBe(400);
  });

  it('never caches a response about links', async () => {
    const made = await t.app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      headers: { ...CSRF, cookie: await loginCookie('superadmin') },
      payload: { email: email(), role: 'user' },
    });
    expect(made.headers['cache-control']).toBe('no-store');
    const token = (made.json() as Json)['token'] as string;
    expect((await lookup(token)).headers['cache-control']).toBe('no-store');
    expect((await lookup('nonsense')).headers['cache-control']).toBe('no-store');
    expect((await accept('nonsense')).headers['cache-control']).toBe('no-store');
  });
});

async function loginCookie(who: 'superadmin' | 'familyadmin' | 'member' | 'user') {
  return cookieHeader(await login(t.app, f.account[who].email));
}

describe('accepting an invitation', () => {
  it('creates the right role, person and default settings, and signs the new account in', async () => {
    const made = await invite('superadmin', 'member', { personId: f.person.tomas, note: 'Welcome, Tomas!' });
    const token = made.body?.['token'] as string;

    const info = parse(await lookup(token));
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      kind: 'invite',
      treeName: 'Hale Family',
      role: 'member',
      person: { name: 'Tomas Navarro' },
      note: 'Welcome, Tomas!',
      invitedBy: 'superadmin',
    });
    expect(JSON.stringify(info.body)).not.toContain(token);

    const accepted = await accept(token, { displayName: 'ignored: the person has a name' });
    expect(accepted.statusCode).toBe(201);
    const me = accepted.json() as Json;
    expect(me['user']).toMatchObject({
      role: 'member',
      personId: f.person.tomas,
      displayName: 'Tomas Navarro',
      colorScheme: 'forest',
      theme: 'device',
      dateFormat: 'mdy',
      nameForm: 'maiden_married',
      showPrefix: true,
      showSuffix: true,
      treeWheel: 'zoom',
      treeDefaultView: 'family',
      showExtendedRelatives: false,
      showDeceasedMark: true,
      weekStart: 'sunday',
      lineageView: 'adoptive',
    });
    // The cookie works, and the password works.
    const cookie = cookieHeader(accepted);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    expect(sessionCookie(accepted)?.httpOnly).toBe(true);
    const row =
      await sql<Json>`select last_sign_in_at, password_changed_via, password_changed_at, email from users where id = ${(me['user'] as Json)['id']}`.execute(
        t.owner,
      );
    expect(row.rows[0]).toMatchObject({
      password_changed_via: 'invitation',
      email: expect.stringContaining('@hale.example'),
    });
    expect(row.rows[0]?.['last_sign_in_at']).toBeInstanceOf(Date);
    expect(row.rows[0]?.['password_changed_at']).toBeInstanceOf(Date);
    expect((await login(t.app, row.rows[0]?.['email'] as string, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('asks for a name only when no person is linked, and refuses a missing one', async () => {
    const made = await invite('familyadmin', 'user');
    const token = made.body?.['token'] as string;
    expect(parse(await lookup(token)).body).toMatchObject({ person: null, invitedBy: 'familyadmin' });
    expect(parse(await accept(token, { displayName: '   ' }))).toMatchObject({
      status: 400,
      body: { error: 'invalid_display_name' },
    });
    const response = await post(t.app, '/api/links/accept', { token, password: NEW_PASSWORD });
    expect(response.statusCode).toBe(400);
    const done = await accept(token, { displayName: ' Nina Okafor ' });
    expect(done.statusCode).toBe(201);
    expect((done.json() as Json)['user']).toMatchObject({ role: 'user', personId: null, displayName: 'Nina Okafor' });
  });

  it('refuses a short password without using up the link', async () => {
    const token = (await invite('superadmin', 'user')).body?.['token'] as string;
    const short = await accept(token, { password: 'short' });
    expect(parse(short)).toMatchObject({ status: 400, body: { error: 'password_too_short' } });
    expect((await accept(token)).statusCode).toBe(201);
  });

  it('works once: the second try gets the generic answer', async () => {
    const token = (await invite('superadmin', 'user')).body?.['token'] as string;
    expect((await accept(token)).statusCode).toBe(201);
    expect(parse(await accept(token))).toEqual({ status: 404, body: { error: 'invalid_link' } });
    expect(parse(await lookup(token))).toEqual({ status: 404, body: { error: 'invalid_link' } });
  });

  it('ten accepts at once make exactly one account and nine identical generic errors', async () => {
    const address = email('race');
    const made = await as('superadmin', 'POST', '/api/admin/invitations', { email: address, role: 'member' });
    const token = made.body?.['token'] as string;
    const results = await Promise.all(Array.from({ length: 10 }, () => accept(token)));
    const created = results.filter((r) => r.statusCode === 201);
    const refused = results.filter((r) => r.statusCode !== 201).map(parse);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(9);
    for (const answer of refused) expect(answer).toEqual({ status: 404, body: { error: 'invalid_link' } });
    const users = await sql`select 1 from users where email = ${address}`.execute(t.owner);
    expect(users.rows).toHaveLength(1);
  });

  it('answers the same for an unknown, an expired, a used and a revoked link', async () => {
    const used = (await invite('superadmin', 'user')).body?.['token'] as string;
    await accept(used);
    const revoked = await invite('superadmin', 'user');
    await as('superadmin', 'POST', `/api/admin/links/${revoked.body?.['linkId']}/revoke`);
    const expired = await invite('superadmin', 'user');
    await sql`update account_links set expires_at = now() - interval '1 second' where id = ${expired.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    const countUsers = async () =>
      Number((await sql<{ n: string }>`select count(*) as n from users`.execute(t.owner)).rows[0]?.n);
    const usersBefore = await countUsers();
    const tokens = ['never-issued', used, revoked.body?.['token'] as string, expired.body?.['token'] as string];

    const lookups = await Promise.all(
      tokens.map(async (token) => {
        const r = await lookup(token);
        return { status: r.statusCode, body: r.body, headers: r.headers['content-type'] };
      }),
    );
    const accepts = await Promise.all(
      tokens.map(async (token) => {
        const r = await accept(token);
        return { status: r.statusCode, body: r.body, headers: r.headers['content-type'] };
      }),
    );
    for (const all of [lookups, accepts]) {
      expect(all[0]?.status).toBe(404);
      for (const answer of all) expect(answer).toEqual(all[0]);
      expect(JSON.parse(all[0]!.body)).toEqual({ error: 'invalid_link' });
    }
    // None of them created an account.
    expect(await countUsers()).toBe(usersBefore);
  });

  it('uses one indexed lookup for every kind of bad link', async () => {
    const plan = await sql<{ 'QUERY PLAN': string }>`
      explain select kind from account_links where token_hash = 'x' and accepted_at is null and revoked_at is null and expires_at > now()`.execute(
      t.owner,
    );
    expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/account_links_token_hash_key|Index/);
  });

  it('an expired link stops working, shows as Expired, and does not block a new invitation', async () => {
    const address = email('late');
    const old = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: address,
      role: 'member',
      personId: f.person.leo,
    });
    await sql`update account_links set expires_at = now() - interval '1 minute' where id = ${old.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    expect(parse(await lookup(old.body?.['token'] as string)).status).toBe(404);
    const list = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    expect(list.find((a) => a['id'] === old.body?.['linkId'])).toMatchObject({ status: 'expired', kind: 'invitation' });

    const again = await as('familyadmin', 'POST', '/api/admin/invitations', {
      email: address,
      role: 'user',
      personId: f.person.leo,
    });
    expect(again.status).toBe(201);
    expect(parse(await lookup(again.body?.['token'] as string)).status).toBe(200);
    const after = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Json[];
    expect(after.find((a) => a['id'] === old.body?.['linkId'])).toBeUndefined();
  });

  it('regenerating an expired invitation gives a fresh 7 days, and the old link stays dead', async () => {
    const made = await invite('superadmin', 'user');
    await sql`update account_links set expires_at = now() - interval '1 minute' where id = ${made.body?.['linkId'] as string}`.execute(
      t.owner,
    );
    const fresh = await as('superadmin', 'POST', `/api/admin/links/${made.body?.['linkId']}/regenerate`);
    expect(fresh.status).toBe(200);
    expect(parse(await lookup(made.body?.['token'] as string)).status).toBe(404);
    expect(parse(await lookup(fresh.body?.['token'] as string)).status).toBe(200);
    const days = (new Date(fresh.body?.['expiresAt'] as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('regenerate invalidates the old link, and a used or revoked link cannot be regenerated', async () => {
    const made = await invite('superadmin', 'user');
    const fresh = await as('superadmin', 'POST', `/api/admin/links/${made.body?.['linkId']}/regenerate`);
    expect((await accept(made.body?.['token'] as string)).statusCode).toBe(404);
    expect((await accept(fresh.body?.['token'] as string)).statusCode).toBe(201);
    expect(await as('superadmin', 'POST', `/api/admin/links/${made.body?.['linkId']}/regenerate`)).toMatchObject({
      status: 404,
      body: { error: 'link_not_found' },
    });
    const other = await invite('superadmin', 'user');
    await as('superadmin', 'POST', `/api/admin/links/${other.body?.['linkId']}/revoke`);
    expect((await as('superadmin', 'POST', `/api/admin/links/${other.body?.['linkId']}/regenerate`)).status).toBe(404);
    expect((await as('superadmin', 'POST', `/api/admin/links/${other.body?.['linkId']}/revoke`)).status).toBe(404);
    expect((await accept(other.body?.['token'] as string)).statusCode).toBe(404);
  });

  it('a person deleted while invited takes the invitation with them', async () => {
    const person = await insertPersonRow(t.owner, 'Temp', 'Hale');
    const made = await invite('superadmin', 'member', { personId: person });
    expect(parse(await lookup(made.body?.['token'] as string)).status).toBe(200);
    await sql`delete from people where id = ${person}`.execute(t.owner);
    expect(parse(await lookup(made.body?.['token'] as string))).toEqual({
      status: 404,
      body: { error: 'invalid_link' },
    });
    expect((await accept(made.body?.['token'] as string)).statusCode).toBe(404);
    const gone = await sql`select 1 from account_links where id = ${made.body?.['linkId'] as string}`.execute(t.owner);
    expect(gone.rows).toHaveLength(0);
  });

  it('loses a race for the email or the person quietly: the generic answer, nothing created', async () => {
    const address = email('taken');
    const person = await insertPersonRow(t.owner, 'Race', 'Hale');
    const made = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: address,
      role: 'member',
      personId: person,
    });
    // Somebody else gets the address after the invitation was made.
    await sql`insert into users (email, display_name, password_hash, role) values (${address}, 'Squatter', 'h', 'user')`.execute(
      t.owner,
    );
    expect(parse(await accept(made.body?.['token'] as string))).toEqual({
      status: 404,
      body: { error: 'invalid_link' },
    });
    await sql`delete from users where email = ${address}`.execute(t.owner);

    // The same for the person: an account takes them before the invitation is accepted.
    const other = await insertPersonRow(t.owner, 'Race', 'Two');
    const second = await as('superadmin', 'POST', '/api/admin/invitations', {
      email: email('taken'),
      role: 'member',
      personId: other,
    });
    await sql`insert into users (email, display_name, password_hash, role, person_id) values (${email('squat')}, 'Squatter', 'h', 'user', ${other})`.execute(
      t.owner,
    );
    expect(parse(await accept(second.body?.['token'] as string))).toEqual({
      status: 404,
      body: { error: 'invalid_link' },
    });
    const users = await sql`select 1 from users where display_name = 'Nina Okafor' and email like 'taken%'`.execute(
      t.owner,
    );
    expect(users.rows).toHaveLength(0);
  });
});

describe('what the Users page reads', () => {
  it('lists accounts and invitations with status, inviter and the password trace', async () => {
    const made = await invite('superadmin', 'member', { note: 'Hi' });
    const body = (await as('familyadmin', 'GET', '/api/admin/accounts')).body as Json;
    const accounts = body['accounts'] as Json[];
    const mine = accounts.find((a) => a['id'] === made.body?.['linkId']);
    expect(mine).toMatchObject({
      kind: 'invitation',
      status: 'invited',
      role: 'member',
      displayName: null,
      invitedBy: 'superadmin',
      invitation: { note: 'Hi', expired: false, canManage: true },
    });
    const marcus = accounts.find((a) => a['email'] === 'member@example.com');
    expect(marcus).toMatchObject({
      kind: 'account',
      status: 'active',
      person: { name: 'Marcus Hale' },
      passwordChangedVia: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/token|password_hash/i);
  });

  it('shows who invited an account made by accepting', async () => {
    const made = await invite('familyadmin', 'user');
    const done = await accept(made.body?.['token'] as string);
    const id = ((done.json() as Json)['user'] as Json)['id'];
    const accounts = ((await as('superadmin', 'GET', '/api/admin/accounts')).body as Json)['accounts'] as Json[];
    expect(accounts.find((a) => a['id'] === id)).toMatchObject({
      invitedBy: 'familyadmin',
      passwordChangedVia: 'invitation',
    });
  });
});

describe('limits on the public routes', () => {
  it('counts a bad link as a failure and then answers 429 for that address', async () => {
    const limited = await createTestApp();
    try {
      for (let i = 0; i < 20; i += 1) {
        expect((await post(limited.app, '/api/links/lookup', { token: `nope-${i}` })).statusCode).toBe(404);
      }
      const blocked = await post(limited.app, '/api/links/lookup', { token: 'nope-again' });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      expect((await post(limited.app, '/api/links/accept', { token: 'x', password: NEW_PASSWORD })).statusCode).toBe(
        429,
      );
    } finally {
      await limited.close();
    }
  });

  it('only slows links down when bad links come from everywhere, so real links keep working (ADR 0042)', async () => {
    const waits: number[] = [];
    const flooded = await createTestApp({ pause: async (ms) => void waits.push(ms) });
    try {
      const from = (address: string, token: string) =>
        flooded.app.inject({
          method: 'POST',
          url: '/api/links/lookup',
          headers: { 'x-kinship-request': '1' },
          payload: { token },
          remoteAddress: address,
        });
      // 200 bad links from 20 addresses, 10 each (under the per-address limit of 20).
      for (let a = 0; a < 20; a += 1)
        for (let i = 0; i < 10; i += 1)
          expect((await from(`203.0.113.${a + 1}`, `nope-${a}-${i}`)).statusCode).toBe(404);
      expect(waits).toEqual([]);
      // A new address is answered, not refused, after a short wait.
      expect((await from('198.51.100.4', 'mine')).statusCode).toBe(404);
      expect(waits).toEqual([1_000]);
    } finally {
      await flooded.close();
    }
  });

  it('has a plain per-address request cap, like sign-in', async () => {
    const capped = await createTestApp({ loginRequestsPerMinute: 3 });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1)
        statuses.push((await post(capped.app, '/api/links/lookup', { token: 'x' })).statusCode);
      expect(statuses).toEqual([404, 404, 404, 429, 429]);
    } finally {
      await capped.close();
    }
  });

  it('rejects a token in a URL: there is no GET route for links', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/api/links/lookup?token=x' })).statusCode).toBe(404);
  });
});
