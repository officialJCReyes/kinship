// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Changing your own password (POST /api/auth/password).
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserTransaction } from '../src/request-context.js';
import { CSRF, PASSWORD, cookieHeader, createTestApp, insertUser, login, post, sessionCookie } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

let t: TestApp;
const NEW = 'a brand new passphrase';
let n = 0;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function account(role = 'member') {
  n += 1;
  const email = `pw${n}@hale.example`;
  const id = await insertUser(t.owner, { email, role });
  return { id, email };
}
const me = (cookie: string) => t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
const change = (cookie: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: { ...CSRF, cookie, ...headers },
    payload: body,
  });

describe('changing your own password', () => {
  it('needs a signed-in account', async () => {
    const response = await post(t.app, '/api/auth/password', { currentPassword: PASSWORD, newPassword: NEW });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const { email } = await account();
    const cookie = cookieHeader(await login(t.app, email));
    const response = await change(cookie, { currentPassword: 'not my password', newPassword: NEW });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_current_password' });
    expect((await login(t.app, email, PASSWORD)).statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(200);
  });

  it('refuses a new password that is too short, without counting it against the account', async () => {
    const { email } = await account();
    const cookie = cookieHeader(await login(t.app, email));
    for (let i = 0; i < 15; i += 1) {
      const response = await change(cookie, { currentPassword: PASSWORD, newPassword: 'short' });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'password_too_short', minLength: 12 });
    }
    expect((await change(cookie, { currentPassword: PASSWORD, newPassword: NEW })).statusCode).toBe(204);
  });

  it('rotates this session, signs every other one out, and the new password works and the old one does not', async () => {
    const { id, email } = await account();
    const first = await login(t.app, email);
    const here = cookieHeader(first);
    const other1 = cookieHeader(await login(t.app, email));
    const other2 = cookieHeader(await login(t.app, email));
    const bystander = await account();
    const bystanderCookie = cookieHeader(await login(t.app, bystander.email));

    const changed = await change(here, { currentPassword: PASSWORD, newPassword: NEW });
    expect(changed.statusCode).toBe(204);
    expect(changed.headers['cache-control']).toBe('no-store');
    const fresh = sessionCookie(changed);
    expect(fresh?.httpOnly).toBe(true);
    expect(fresh?.value).toBeTruthy();
    const freshCookie = `kinship_session=${fresh?.value}`;
    expect(freshCookie).not.toBe(here);

    expect((await me(freshCookie)).statusCode).toBe(200); // this browser stays signed in, on a new token
    expect((await me(here)).statusCode).toBe(401); // the old token is dead
    expect((await me(other1)).statusCode).toBe(401);
    expect((await me(other2)).statusCode).toBe(401);
    expect((await me(bystanderCookie)).statusCode).toBe(200); // someone else's sessions are untouched
    expect((await login(t.app, email, PASSWORD)).statusCode).toBe(401);
    expect((await login(t.app, email, NEW)).statusCode).toBe(200);

    const sessions = await sql<{ n: string }>`select count(*) as n from sessions where user_id = ${id}`.execute(
      t.owner,
    );
    expect(Number(sessions.rows[0]?.n)).toBe(2); // the rotated one and the sign-in just above
  });

  it('records how: self, with the time', async () => {
    const { id, email } = await account();
    const cookie = cookieHeader(await login(t.app, email));
    const before = await sql<
      Record<string, unknown>
    >`select password_changed_via, password_changed_at from users where id = ${id}`.execute(t.owner);
    expect(before.rows[0]).toEqual({ password_changed_via: null, password_changed_at: null });
    await change(cookie, { currentPassword: PASSWORD, newPassword: NEW });
    const after = await sql<{
      password_changed_via: string;
      password_changed_at: Date;
    }>`select password_changed_via, password_changed_at from users where id = ${id}`.execute(t.owner);
    expect(after.rows[0]?.password_changed_via).toBe('self');
    expect(Date.now() - (after.rows[0]?.password_changed_at.getTime() ?? 0)).toBeLessThan(10_000);
    const mine = (await me(cookie)).json() as { user: Record<string, unknown> };
    expect(JSON.stringify(mine)).not.toContain('password');
  });

  it('retires an open set-password link for the account', async () => {
    const { id, email } = await account();
    const admin = await insertUser(t.owner, { email: `boss${n}@hale.example`, role: 'superadmin' });
    const adminCookie = cookieHeader(await login(t.app, `boss${n}@hale.example`));
    const link = await t.app.inject({
      method: 'POST',
      url: `/api/admin/accounts/${id}/set-password-link`,
      headers: { ...CSRF, cookie: adminCookie },
    });
    expect(link.statusCode).toBe(201);
    const cookie = cookieHeader(await login(t.app, email));
    await change(cookie, { currentPassword: PASSWORD, newPassword: NEW });
    expect(
      (await post(t.app, '/api/links/lookup', { token: (link.json() as { token: string }).token })).statusCode,
    ).toBe(404);
    expect(admin).toBeDefined();
  });

  it('stores only an argon2id hash of the new password', async () => {
    const { id, email } = await account();
    const cookie = cookieHeader(await login(t.app, email));
    await change(cookie, { currentPassword: PASSWORD, newPassword: NEW });
    const stored = await sql<{ password_hash: string }>`select password_hash from users where id = ${id}`.execute(
      t.owner,
    );
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0]?.password_hash).not.toContain(NEW);
  });

  it('is not a way to change anyone else’s password: the function insists on the caller and its own session', async () => {
    const mine = await account();
    const theirs = await account();
    const theirCookie = cookieHeader(await login(t.app, theirs.email));
    void theirCookie;
    await login(t.app, mine.email);
    const theirHash = await sql<{
      token_hash: string;
    }>`select token_hash from sessions where user_id = ${theirs.id} limit 1`.execute(t.owner);
    // As me, naming their id, or naming their session: refused.
    await expect(
      withUserTransaction(t.db, mine.id, (trx) =>
        sql`select kinship_auth.change_password(${theirs.id}::uuid, 'h', ${theirHash.rows[0]!.token_hash}, 'n1')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      withUserTransaction(t.db, mine.id, (trx) =>
        sql`select kinship_auth.change_password(${mine.id}::uuid, 'h', ${theirHash.rows[0]!.token_hash}, 'n2')`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/forbidden/);
    await expect(
      withUserTransaction(t.db, null, (trx) =>
        sql`select kinship_auth.change_password(${mine.id}::uuid, 'h', 'x', 'n3')`.execute(trx),
      ),
    ).rejects.toThrow(/forbidden/);
  });
});

describe('limits', () => {
  it('stops guessing the current password: 10 wrong answers lock the account out of this form, correct or not', async () => {
    const { email } = await account();
    const cookie = cookieHeader(await login(t.app, email));
    for (let i = 0; i < 10; i += 1) {
      expect((await change(cookie, { currentPassword: `wrong guess ${i}`, newPassword: NEW })).statusCode).toBe(400);
    }
    const blocked = await change(cookie, { currentPassword: PASSWORD, newPassword: NEW });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect((await login(t.app, email, PASSWORD)).statusCode).toBe(200); // nothing changed
  });

  it('limits per address too, across accounts', async () => {
    const limited = await createTestApp();
    try {
      for (let i = 0; i < 4; i += 1) {
        const email = `ip${i}@hale.example`;
        await insertUser(limited.owner, { email });
        const cookie = cookieHeader(await login(limited.app, email));
        for (let j = 0; j < 5; j += 1) {
          const r = await limited.app.inject({
            method: 'POST',
            url: '/api/auth/password',
            headers: { ...CSRF, cookie },
            payload: { currentPassword: 'wrong', newPassword: NEW },
          });
          expect(r.statusCode).toBe(400);
        }
      }
      // 20 failures from one address, spread over four accounts: the fifth account is stopped too.
      await insertUser(limited.owner, { email: 'ip9@hale.example' });
      const cookie = cookieHeader(await login(limited.app, 'ip9@hale.example'));
      const r = await limited.app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: { ...CSRF, cookie },
        payload: { currentPassword: PASSWORD, newPassword: NEW },
      });
      expect(r.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('has the same per-address request cap as sign-in, before any hashing', async () => {
    const capped = await createTestApp({ loginRequestsPerMinute: 3 });
    try {
      await insertUser(capped.owner, { email: 'cap@hale.example' });
      const cookie = cookieHeader(await login(capped.app, 'cap@hale.example'));
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const r = await capped.app.inject({
          method: 'POST',
          url: '/api/auth/password',
          headers: { ...CSRF, cookie },
          payload: { currentPassword: 'wrong', newPassword: NEW },
        });
        statuses.push(r.statusCode);
      }
      expect(statuses).toEqual([400, 400, 400, 429]); // three requests a minute for this route, then 429
    } finally {
      await capped.close();
    }
  });
});
