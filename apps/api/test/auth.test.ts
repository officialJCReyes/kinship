// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as passwordModule from '../src/auth/passwords.js';
import {
  PASSWORD,
  SESSION_COOKIE,
  cookieHeader,
  createTestApp,
  insertUser,
  login,
  post,
  sessionCookie,
} from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

// Count password checks without changing them.
vi.mock('../src/auth/passwords.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/auth/passwords.js')>();
  return { ...original, verifyPassword: vi.fn(original.verifyPassword) };
});

const apps: TestApp[] = [];
afterEach(async () => {
  vi.mocked(passwordModule.verifyPassword).mockClear();
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function withUser(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(overrides);
  apps.push(t);
  const userId = await insertUser(t.owner, {
    email: 'marcus@example.com',
    displayName: 'Marcus Hale',
    role: 'superadmin',
  });
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  return { ...t, userId };
}

describe('POST /api/auth/login', () => {
  it('signs in with the right email and password, and sets a safe session cookie', async () => {
    const t = await withUser();
    const response = await login(t.app, 'marcus@example.com');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: t.userId,
        email: 'marcus@example.com',
        displayName: 'Marcus Hale',
        role: 'superadmin',
        personId: null,
        lineageView: 'adoptive',
        colorScheme: 'forest',
        theme: 'device',
        dateFormat: 'mdy',
        surnameChoice: 'married',
        passwordChangedAt: null, // set directly in the database by the test, so how it changed is unknown
        passwordChangedVia: null,
      },
      treeName: 'Hale Family',
    });
    const cookie = sessionCookie(response);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expires = cookie?.expires ? new Date(cookie.expires).getTime() : 0;
    expect(expires - Date.now()).toBeGreaterThan(3500 * 1000); // about the 1 hour idle time of this test app
    expect(expires - Date.now()).toBeLessThan(3700 * 1000);
  });

  it('ignores the case and spaces of the email', async () => {
    const t = await withUser();
    expect((await login(t.app, '  Marcus@EXAMPLE.com ')).statusCode).toBe(200);
  });

  it('stores only a hash of the session token', async () => {
    const t = await withUser();
    const cookie = sessionCookie(await login(t.app, 'marcus@example.com'));
    const rows = await sql<{ token_hash: string }>`select token_hash from sessions`.execute(t.owner);
    expect(rows.rows).toEqual([
      {
        token_hash: createHash('sha256')
          .update(cookie?.value ?? '')
          .digest('hex'),
      },
    ]);
    expect(JSON.stringify(rows.rows)).not.toContain(cookie?.value ?? 'x');
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    const t = await withUser();
    const wrong = await login(t.app, 'marcus@example.com', 'not the password at all');
    const unknown = await login(t.app, 'nobody@example.com', 'not the password at all');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'invalid_credentials' });
    expect(unknown.body).toBe(wrong.body);
    expect(Object.keys(unknown.headers).sort()).toEqual(Object.keys(wrong.headers).sort());
    expect(sessionCookie(wrong)).toBeUndefined();
    expect(sessionCookie(unknown)).toBeUndefined();
  });

  it('runs a full password check even when the email is unknown, so timing does not give it away', async () => {
    const t = await withUser();
    const verify = vi.mocked(passwordModule.verifyPassword);

    await login(t.app, 'nobody@example.com', 'whatever password');
    expect(verify).toHaveBeenCalledTimes(1);
    expect(String(verify.mock.calls[0]?.[0])).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/); // the dummy hash

    verify.mockClear();
    await login(t.app, 'marcus@example.com', 'whatever password');
    expect(verify).toHaveBeenCalledTimes(1);

    verify.mockClear();
    await login(t.app, 'not-an-email', 'whatever password'); // even an invalid email takes the same path
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('upgrades an older password hash after a successful sign-in', async () => {
    const t = await createTestApp();
    apps.push(t);
    const weak = await hash(PASSWORD, { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    await insertUser(t.owner, { email: 'old@example.com', passwordHash: weak });
    expect((await login(t.app, 'old@example.com')).statusCode).toBe(200);
    const stored = await sql<{ password_hash: string }>`select password_hash from users`.execute(t.owner);
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect((await login(t.app, 'old@example.com')).statusCode).toBe(200);
  });

  it('rejects bodies with the wrong shape', async () => {
    const t = await withUser();
    expect((await post(t.app, '/api/auth/login', { email: 'marcus@example.com' })).statusCode).toBe(400);
    expect((await post(t.app, '/api/auth/login', { email: 1, password: 2 })).statusCode).toBe(400);
    expect((await post(t.app, '/api/auth/login', { email: 'a@b.co', password: 'x', admin: true })).statusCode).toBe(
      400,
    );
  });

  it('never returns a password hash or token hash', async () => {
    const t = await withUser();
    const response = await login(t.app, 'marcus@example.com');
    expect(response.body).not.toMatch(/argon2|token|hash|"password"/i);
  });
});

describe('CSRF protection', () => {
  it('refuses a state-changing request without the custom header', async () => {
    const t = await withUser();
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'marcus@example.com', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'csrf' });
  });

  it('refuses a request from another origin, even with the header', async () => {
    const t = await withUser();
    const response = await login(t.app, 'marcus@example.com', PASSWORD, { origin: 'https://evil.example' });
    expect(response.statusCode).toBe(403);
    expect(sessionCookie(response)).toBeUndefined();
  });

  it('refuses a request the browser marks cross-site, and an Origin of "null"', async () => {
    const t = await withUser();
    expect((await login(t.app, 'marcus@example.com', PASSWORD, { 'sec-fetch-site': 'cross-site' })).statusCode).toBe(
      403,
    );
    expect((await login(t.app, 'marcus@example.com', PASSWORD, { origin: 'null' })).statusCode).toBe(403);
  });

  it('accepts a request from this site, matched on the Host', async () => {
    const t = await withUser();
    const response = await login(t.app, 'marcus@example.com', PASSWORD, {
      host: 'kin.example',
      origin: 'https://kin.example',
      'sec-fetch-site': 'same-origin',
    });
    expect(response.statusCode).toBe(200);
  });

  it('matches the Origin against X-Forwarded-Host when the proxy is trusted (a proxy that rewrites Host)', async () => {
    const trusting = await withUser({ trustProxy: true });
    const viaProxy = await login(trusting.app, 'marcus@example.com', PASSWORD, {
      host: 'web:8080',
      origin: 'https://kin.example',
      'x-forwarded-host': 'kin.example',
      'x-forwarded-proto': 'https',
    });
    expect(viaProxy.statusCode).toBe(200);

    // Without trust, the header means nothing: the Origin must match the real Host.
    const notTrusting = await withUser();
    const spoofed = await login(notTrusting.app, 'marcus@example.com', PASSWORD, {
      host: 'web:8080',
      origin: 'https://kin.example',
      'x-forwarded-host': 'kin.example',
    });
    expect(spoofed.statusCode).toBe(403);
  });

  it('does not get in the way of reading', async () => {
    const t = await withUser();
    expect((await t.app.inject({ url: '/api/auth/me', headers: { origin: 'https://evil.example' } })).statusCode).toBe(
      401,
    );
  });

  it('applies to logout too', async () => {
    const t = await withUser();
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    const response = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(response.statusCode).toBe(403);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('GET /api/auth/me and sessions', () => {
  it('returns the signed-in person, and 401 with no or a bad cookie', async () => {
    const t = await withUser();
    expect((await t.app.inject({ url: '/api/auth/me' })).statusCode).toBe(401);

    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    const me = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: 'marcus@example.com', role: 'superadmin' },
      treeName: 'Hale Family',
    });

    const bad = await t.app.inject({ url: '/api/auth/me', headers: { cookie: `${SESSION_COOKIE}=${'a'.repeat(43)}` } });
    expect(bad.statusCode).toBe(401);
    expect(bad.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe(''); // cleared
  });

  it('slides the idle expiry forward while the session is used, never past the absolute cap', async () => {
    const t = await withUser({ sessions: { idleSeconds: 3600, maxSeconds: 7200 } });
    const first = await login(t.app, 'marcus@example.com');
    const cookie = cookieHeader(first);

    // Pretend it was last used 5 minutes ago and is about to idle out.
    await sql`update sessions set last_seen_at = now() - interval '5 minutes', expires_at = now() + interval '10 minutes'`.execute(
      t.owner,
    );
    const used = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(used.statusCode).toBe(200);
    const renewed = sessionCookie(used);
    expect(renewed?.value).toBe(sessionCookie(first)?.value); // same token, new expiry
    const rows = await sql<{
      left: number;
    }>`select extract(epoch from (expires_at - now())) as left from sessions`.execute(t.owner);
    expect(Number(rows.rows[0]?.left)).toBeGreaterThan(3500);

    // Near the absolute cap the renewal stops at the cap.
    await sql`update sessions set last_seen_at = now() - interval '5 minutes', expires_at = now() + interval '10 minutes', absolute_expires_at = now() + interval '20 minutes'`.execute(
      t.owner,
    );
    await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
    const capped = await sql<{
      left: number;
    }>`select extract(epoch from (expires_at - now())) as left from sessions`.execute(t.owner);
    expect(Number(capped.rows[0]?.left)).toBeLessThanOrEqual(20 * 60);
  });

  it('does not write on every request', async () => {
    const t = await withUser();
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    const before = await sql<{ t: string }>`select last_seen_at::text as t from sessions`.execute(t.owner);
    const response = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
    const after = await sql<{ t: string }>`select last_seen_at::text as t from sessions`.execute(t.owner);
    expect(after.rows).toEqual(before.rows);
    expect(sessionCookie(response)).toBeUndefined(); // no renewal, no new Set-Cookie
  });

  it('rejects an idle-expired session, and an expired-absolute one', async () => {
    const t = await withUser();
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    await sql`update sessions set expires_at = now() - interval '1 second'`.execute(t.owner);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);

    const cookie2 = cookieHeader(await login(t.app, 'marcus@example.com'));
    await sql`update sessions set expires_at = now() + interval '1 hour' where token_hash = ${createHash('sha256')
      .update(cookie2.split('=')[1] ?? '')
      .digest('hex')}`.execute(t.owner);
    await sql`update sessions set absolute_expires_at = now() - interval '1 second', expires_at = now() - interval '2 seconds'`.execute(
      t.owner,
    );
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie: cookie2 } })).statusCode).toBe(401);
  });

  it('marks the cookie Secure over HTTPS only when the proxy header is trusted', async () => {
    const trusting = await withUser({ trustProxy: true });
    const viaProxy = await login(trusting.app, 'marcus@example.com', PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(sessionCookie(viaProxy)?.secure).toBe(true);
    const plain = await login(trusting.app, 'marcus@example.com');
    expect(sessionCookie(plain)?.secure).toBeFalsy();

    const notTrusting = await withUser();
    const spoofed = await login(notTrusting.app, 'marcus@example.com', PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(sessionCookie(spoofed)?.secure).toBeFalsy(); // the header is ignored unless configured
  });

  it('uses the forwarded address for rate limits only when the proxy is trusted', async () => {
    const trusting = await withUser({ trustProxy: true });
    for (let i = 0; i < 20; i++)
      await login(trusting.app, `nobody${i}@example.com`, 'x', { 'x-forwarded-for': '203.0.113.7' });
    const blocked = await login(trusting.app, 'marcus@example.com', PASSWORD, { 'x-forwarded-for': '203.0.113.7' });
    expect(blocked.statusCode).toBe(429);
    const elsewhere = await login(trusting.app, 'marcus@example.com', PASSWORD, { 'x-forwarded-for': '203.0.113.8' });
    expect(elsewhere.statusCode).toBe(200);

    const notTrusting = await withUser();
    for (let i = 0; i < 20; i++)
      await login(notTrusting.app, `nobody${i}@example.com`, 'x', { 'x-forwarded-for': `203.0.113.${i}` });
    // Different forwarded addresses do not help an attacker: they all count as the real one.
    expect((await login(notTrusting.app, 'marcus@example.com')).statusCode).toBe(429);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session on the server and clears the cookie', async () => {
    const t = await withUser();
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    const response = await post(t.app, '/api/auth/logout', {}, { cookie });
    expect(response.statusCode).toBe(204);
    expect(response.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBe('');
    expect((await sql`select 1 from sessions`.execute(t.owner)).rows).toHaveLength(0);
    // The old cookie no longer works, even if someone kept a copy.
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('only ends that session, not the person’s other devices', async () => {
    const t = await withUser();
    const phone = cookieHeader(await login(t.app, 'marcus@example.com'));
    const laptop = cookieHeader(await login(t.app, 'marcus@example.com'));
    await post(t.app, '/api/auth/logout', {}, { cookie: phone });
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie: phone } })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie: laptop } })).statusCode).toBe(200);
  });

  it('is fine when nobody is signed in', async () => {
    const t = await withUser();
    expect((await post(t.app, '/api/auth/logout', {})).statusCode).toBe(204);
  });
});

describe('sign-in rate limiting', () => {
  it('locks an account after 10 failures, and says the same for unknown emails', async () => {
    const t = await withUser();
    for (let i = 0; i < 10; i++)
      expect((await login(t.app, 'marcus@example.com', 'wrong wrong wrong')).statusCode).toBe(401);
    const blocked = await login(t.app, 'marcus@example.com'); // even the right password
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json().retryAfterSeconds).toBeGreaterThan(0);

    for (let i = 0; i < 10; i++) await login(t.app, 'ghost@example.com', 'wrong wrong wrong');
    const ghost = await login(t.app, 'ghost@example.com', 'wrong wrong wrong');
    expect(ghost.statusCode).toBe(429);
    expect(ghost.json()).toMatchObject({ error: 'rate_limited' }); // same as for the real account
  });

  it('limits one address across many accounts', async () => {
    const t = await withUser();
    for (let i = 0; i < 20; i++) await login(t.app, `someone${i}@example.com`, 'wrong wrong wrong');
    const blocked = await login(t.app, 'marcus@example.com');
    expect(blocked.statusCode).toBe(429);
  });

  it('lets the account in again after the window, and clears the count on success', async () => {
    let now = Date.now();
    const t = await withUser({ now: () => now });
    for (let i = 0; i < 9; i++) await login(t.app, 'marcus@example.com', 'wrong wrong wrong');
    expect((await login(t.app, 'marcus@example.com')).statusCode).toBe(200); // a success resets the account
    for (let i = 0; i < 9; i++) await login(t.app, 'marcus@example.com', 'wrong wrong wrong');
    expect((await login(t.app, 'marcus@example.com')).statusCode).toBe(200);

    for (let i = 0; i < 10; i++) await login(t.app, 'marcus@example.com', 'wrong wrong wrong');
    expect((await login(t.app, 'marcus@example.com')).statusCode).toBe(429);
    now += 16 * 60 * 1000;
    expect((await login(t.app, 'marcus@example.com')).statusCode).toBe(200);
  });

  it('pauses after a failure', async () => {
    const t = await withUser({ failureDelayMs: 150 });
    const started = Date.now();
    await login(t.app, 'marcus@example.com', 'wrong wrong wrong');
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });
});

describe('request-rate cap on sign-in', () => {
  it('refuses a flood from one address, successful or not, and says when to retry', async () => {
    const t = await withUser({ loginRequestsPerMinute: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await login(t.app, 'marcus@example.com')).statusCode); // all correct
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    const blocked = await login(t.app, 'marcus@example.com');
    expect(blocked.json()).toMatchObject({ error: 'rate_limited' });
    expect(blocked.json().retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each address separately', async () => {
    const t = await withUser({ loginRequestsPerMinute: 2 });
    for (let i = 0; i < 3; i++)
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {},
        headers: { 'x-kinship-request': '1' },
      });
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'marcus@example.com', password: PASSWORD },
      headers: { 'x-kinship-request': '1' },
      remoteAddress: '10.7.7.7',
    });
    expect(other.statusCode).toBe(200);
  });

  it('does not apply to reading who is signed in', async () => {
    const t = await withUser({ loginRequestsPerMinute: 1 });
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    for (let i = 0; i < 5; i++)
      expect((await t.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('what is not exposed', () => {
  it('has no HTTP route for password recovery or user listing', async () => {
    const t = await withUser();
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));
    for (const [method, url] of [
      ['POST', '/api/set-password'],
      ['POST', '/api/auth/set-password'],
      ['POST', '/api/cli/set-password'],
      ['GET', '/api/users'],
      ['GET', '/api/sessions'],
    ] as const) {
      const response = await t.app.inject({ method, url, headers: { ...{ 'x-kinship-request': '1' }, cookie } });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});
