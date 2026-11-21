// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Disable and enable an account (#56, migration 0019, ADR 0029): who may, every refusal, a disabled account refused at
// sign-in with the same answer as a wrong password, its sessions gone at once, its set-password link revoked, the old
// password working again after enable, the last SuperAdmin, and the log lines. Fictional Hale family only.
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canDisableAccount } from '@kinship/shared';
import type { Role } from '@kinship/shared';
import { PASSWORD, cookieHeader, createTestApp, insertUser, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { AccountKey, Family, Who } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const logged: string[] = [];

const ROLE: Record<AccountKey, Role> = {
  superadmin: 'superadmin',
  familyadmin: 'familyadmin',
  member: 'member',
  unlinked: 'member',
  user: 'user',
};
const NOBODY = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  const logStream = new Writable({ write: (chunk: Buffer, _enc, done) => (logged.push(chunk.toString()), done()) });
  t = await createTestApp({ logLevel: 'info', logStream });
  f = await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

beforeEach(async () => {
  await sql`update users set disabled_at = null`.execute(t.owner);
  // Disabling deletes the account's sessions (that is the point), so every test starts with fresh sign-ins.
  as = await signInAll(t.app, f);
  logged.length = 0;
});

const idOf = (target: AccountKey | string) => (target in f.account ? f.account[target as AccountKey].id : target);
const disable = (who: Who, target: AccountKey | string) =>
  as(who, 'POST', `/api/admin/accounts/${idOf(target)}/disable`);
const enable = (who: Who, target: AccountKey | string) => as(who, 'POST', `/api/admin/accounts/${idOf(target)}/enable`);
const disabledAt = async (key: AccountKey | string) =>
  (await sql<{ d: Date | null }>`select disabled_at as d from users where id = ${idOf(key)}`.execute(t.owner)).rows[0]!
    .d;

describe('who may disable and enable whom (the API, the shared rule and the database agree)', () => {
  const callers: Who[] = ['anonymous', ...ACCOUNTS];
  for (const caller of callers) {
    for (const target of ACCOUNTS) {
      const allowed =
        caller !== 'anonymous' &&
        canDisableAccount({ id: caller, role: ROLE[caller] }, { id: target, role: ROLE[target] });
      it(`${caller} for ${target}: ${allowed ? 'allowed' : 'refused'}`, async () => {
        const admin = caller === 'superadmin' || caller === 'familyadmin';
        const response = await disable(caller, target);
        if (allowed) {
          expect(response.status).toBe(200);
          expect(response.body).toMatchObject({ accountId: f.account[target].id, status: 'disabled' });
          expect(await disabledAt(target)).not.toBeNull();
          expect((await enable(caller, target)).status).toBe(200);
          expect(await disabledAt(target)).toBeNull();
        } else {
          expect(response.status).toBe(caller === 'anonymous' ? 401 : 403);
          const error = !admin ? 'forbidden' : caller === target ? 'self_not_allowed' : 'role_not_allowed';
          if (caller !== 'anonymous') {
            expect(response.body?.['error']).toBe(error);
            expect((await enable(caller, target)).body?.['error']).toBe(error);
          }
          expect(await disabledAt(target)).toBeNull();
        }
      });
    }
  }

  it('the database function agrees with the shared rule for every pair of roles', async () => {
    const roles: Role[] = ['superadmin', 'familyadmin', 'member', 'user'];
    for (const actor of roles) {
      for (const target of roles) {
        const shared = canDisableAccount({ id: 'a', role: actor }, { id: 'b', role: target });
        const db = (
          await sql<{ ok: boolean }>`select kinship_auth.can_disable_for(${actor}, ${target}) as ok`.execute(t.owner)
        ).rows[0]!.ok;
        expect(db, `${actor} ${target}`).toBe(shared);
      }
    }
  });
});

describe('refusals', () => {
  it('a Family Admin cannot reach above the ceiling; nobody disables themselves; unknown accounts', async () => {
    const other = await insertUser(t.owner, { email: 'other-fa@example.com', role: 'familyadmin' });
    expect(await disable('familyadmin', other)).toMatchObject({ status: 403, body: { error: 'role_not_allowed' } });
    expect(await disable('familyadmin', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    expect(await disable('familyadmin', 'familyadmin')).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect(await disable('superadmin', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect(await disable('superadmin', NOBODY)).toMatchObject({ status: 404, body: { error: 'account_not_found' } });
    expect((await disable('superadmin', 'nope')).status).toBe(404);
    expect(await disabledAt(other)).toBeNull();
    await sql`delete from users where id = ${other}`.execute(t.owner);
  });

  it('the last active SuperAdmin is protected on every route: the only one cannot act on itself, others cannot reach it', async () => {
    const accounts = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<
      Record<string, unknown>
    >;
    const mine = accounts.find((a) => a['id'] === f.account.superadmin.id)!;
    expect(mine).toMatchObject({ lastSuperAdmin: true, canDisable: false });
    expect(await disable('superadmin', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'self_not_allowed' },
    });
    expect(await disable('familyadmin', 'superadmin')).toMatchObject({
      status: 403,
      body: { error: 'role_not_allowed' },
    });
    // Even the owner of the database is refused (the trigger), so no route at all can leave the tree without a SuperAdmin.
    await expect(
      sql`update users set disabled_at = now() where id = ${f.account.superadmin.id}`.execute(t.owner),
    ).rejects.toMatchObject({
      code: 'KS044',
    });
    // With a second active SuperAdmin either may be disabled by the other, and the rows say which is the last.
    const second = await insertUser(t.owner, { email: 'second-sa@example.com', role: 'superadmin' });
    const both = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<
      Record<string, unknown>
    >;
    expect(both.find((a) => a['id'] === second)).toMatchObject({ lastSuperAdmin: false, canDisable: true });
    expect(both.find((a) => a['id'] === f.account.superadmin.id)).toMatchObject({ lastSuperAdmin: false });
    expect(await disable('superadmin', second)).toMatchObject({ status: 200 });
    const after = (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<
      Record<string, unknown>
    >;
    expect(after.find((a) => a['id'] === f.account.superadmin.id)).toMatchObject({ lastSuperAdmin: true });
    await sql`delete from users where id = ${second}`.execute(t.owner);
  });

  it('disabling or enabling twice is a quiet no-op (200, no log line)', async () => {
    expect((await disable('superadmin', 'user')).status).toBe(200);
    expect(logged.filter((l) => l.includes('account_disabled'))).toHaveLength(1);
    logged.length = 0;
    const again = await disable('superadmin', 'user');
    expect(again).toMatchObject({ status: 200, body: { status: 'disabled' } });
    expect((await enable('superadmin', 'user')).status).toBe(200);
    logged.length = 0;
    expect(await enable('superadmin', 'user')).toMatchObject({
      status: 200,
      body: { status: 'active', disabledAt: null },
    });
    expect(logged.join('')).not.toContain('account_enabled');
  });
});

describe('a disabled account', () => {
  it('is signed out at once: its cookie stops working on the very next request', async () => {
    const cookie = cookieHeader(await login(t.app, f.account.user.email));
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    expect((await disable('familyadmin', 'user')).status).toBe(200);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
    expect((await sql`select 1 from sessions where user_id = ${f.account.user.id}`.execute(t.owner)).rows).toHaveLength(
      0,
    );
  });

  it('gets exactly the answer a wrong password gets, even with the right password', async () => {
    await disable('superadmin', 'user');
    const right = await login(t.app, f.account.user.email, PASSWORD);
    const wrong = await login(t.app, f.account.member.email, 'not the password at all');
    const unknown = await login(t.app, 'nobody@example.com', PASSWORD);
    for (const response of [right, wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_credentials' });
      expect(response.cookies).toHaveLength(0);
    }
    const strip = (headers: Record<string, unknown>) => {
      return Object.fromEntries(
        Object.entries(headers).filter(
          ([name]) => !['date', 'content-length'].includes(name) && !name.startsWith('x-ratelimit'),
        ),
      );
    };
    expect(strip(right.headers)).toEqual(strip(wrong.headers));
  });

  it('can sign in again after enable, with its old password, and its old sessions stay gone', async () => {
    const old = cookieHeader(await login(t.app, f.account.user.email));
    await disable('superadmin', 'user');
    expect((await enable('superadmin', 'user')).status).toBe(200);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie: old } })).statusCode).toBe(401);
    const again = await login(t.app, f.account.user.email, PASSWORD);
    expect(again.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie: cookieHeader(again) } })).statusCode).toBe(
      200,
    );
  });

  it('keeps its person link, its history and its row; its open set-password link is revoked and cannot be used', async () => {
    await sql`update users set person_id = ${f.person.priya} where id = ${f.account.user.id}`.execute(t.owner);
    const made = await as('superadmin', 'POST', `/api/admin/accounts/${f.account.user.id}/set-password-link`);
    expect(made.status).toBe(201);
    const token = made.body!['token'] as string;
    await disable('superadmin', 'user');
    expect(
      (await sql<{ person_id: string }>`select person_id from users where id = ${f.account.user.id}`.execute(t.owner))
        .rows[0]!.person_id,
    ).toBe(f.person.priya);
    const accept = (token_: string) =>
      t.app.inject({
        method: 'POST',
        url: '/api/links/accept',
        headers: { 'x-kinship-request': '1' },
        payload: { token: token_, password: 'a brand new password' },
      });
    expect((await accept(token)).statusCode).toBe(404);
    // even a link that somehow stayed open is refused, and no session or password change follows
    await sql`update account_links set revoked_at = null where user_id = ${f.account.user.id}`.execute(t.owner);
    const lingering = await accept(token);
    expect(lingering.statusCode).toBe(404);
    expect(lingering.json()).toEqual({ error: 'invalid_link' });
    expect(lingering.cookies).toHaveLength(0);
    expect((await login(t.app, f.account.user.email, 'a brand new password')).statusCode).toBe(401);
    await sql`delete from account_links where user_id = ${f.account.user.id}`.execute(t.owner);
    await sql`update users set person_id = null where id = ${f.account.user.id}`.execute(t.owner);
  });

  it('cannot be given a new set-password link (409 account_disabled), and the list says so', async () => {
    await disable('superadmin', 'user');
    expect(await as('superadmin', 'POST', `/api/admin/accounts/${f.account.user.id}/set-password-link`)).toMatchObject({
      status: 409,
      body: { error: 'account_disabled' },
    });
    // the matrix still comes first: a Family Admin for a Family Admin is role_not_allowed
    expect(
      (await as('familyadmin', 'POST', `/api/admin/accounts/${f.account.superadmin.id}/set-password-link`)).body?.[
        'error'
      ],
    ).toBe('role_not_allowed');
    const row = (
      (await as('superadmin', 'GET', '/api/admin/accounts')).body!['accounts'] as Array<Record<string, unknown>>
    ).find((a) => a['id'] === f.account.user.id)!;
    expect(row).toMatchObject({ status: 'disabled', canSetPasswordLink: false, canDisable: true });
    expect(typeof row['disabledAt']).toBe('string');
  });

  it('writes one log line per change with ids only', async () => {
    await disable('superadmin', 'user');
    await enable('superadmin', 'user');
    const lines = logged
      .filter((l) => l.includes('account_disabled') || l.includes('account_enabled'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => l['event'])).toEqual(['account_disabled', 'account_enabled']);
    for (const line of lines) {
      expect(line).toMatchObject({ actor: f.account.superadmin.id, account: f.account.user.id });
      expect(JSON.stringify(line)).not.toContain('@');
    }
  });
});
