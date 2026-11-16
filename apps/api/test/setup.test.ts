// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as store from '../src/auth/store.js';
import { prepareSetupToken } from '../src/auth/startup.js';
import { hashToken } from '../src/auth/tokens.js';
import { CSRF, PASSWORD, createTestApp, insertUser, post, sessionCookie } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

// Wrap needsSetup so a test can make its next answer "yes" (as it was for a request that began before setup finished).
vi.mock('../src/auth/store.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/auth/store.js')>();
  return { ...original, needsSetup: vi.fn(original.needsSetup) };
});

const apps: TestApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function freshInstall(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(overrides);
  apps.push(t);
  let printed = '';
  await prepareSetupToken(t.db, 'http://kin.example', (text) => (printed = text));
  const token = /^\s{4}(\S+)$/m.exec(printed)?.[1];
  if (!token) throw new Error(`no token in the printed message:\n${printed}`);
  return { ...t, token, printed };
}

const body = (token: string, extra: Record<string, unknown> = {}) => ({
  token,
  displayName: 'Marcus Hale',
  email: 'Marcus@Example.com',
  password: PASSWORD,
  treeName: 'Hale Family',
  ...extra,
});

const userCount = async (t: TestApp) =>
  Number((await sql<{ n: string }>`select count(*) as n from users`.execute(t.owner)).rows[0]?.n);

describe('the setup token', () => {
  it('is printed once with the address to open, and only its hash is stored', async () => {
    const { owner, token, printed } = await freshInstall();
    expect(printed).toContain('http://kin.example/setup');
    expect(printed).toContain('one-time setup token');
    const rows = await sql<{ token_hash: string }>`select token_hash from setup_token`.execute(owner);
    expect(rows.rows).toEqual([{ token_hash: hashToken(token) }]);
    expect(rows.rows[0]?.token_hash).not.toContain(token);
  });

  it('is replaced when the api restarts before setup, and the old one stops working', async () => {
    const first = await freshInstall();
    let printed = '';
    await prepareSetupToken(first.db, 'http://kin.example', (text) => (printed = text));
    const second = /^\s{4}(\S+)$/m.exec(printed)?.[1] ?? '';
    expect(second).not.toBe(first.token);

    const old = await post(first.app, '/api/setup', body(first.token));
    expect(old.statusCode).toBe(403);
    const fresh = await post(first.app, '/api/setup', body(second));
    expect(fresh.statusCode).toBe(201);
  });

  it('is not made once an account exists', async () => {
    const t = await createTestApp();
    apps.push(t);
    await insertUser(t.owner, { email: 'someone@example.com', role: 'superadmin' });
    let printed = '';
    expect(await prepareSetupToken(t.db, 'http://kin.example', (text) => (printed = text))).toBe(false);
    expect(printed).toBe('');
    expect((await sql`select 1 from setup_token`.execute(t.owner)).rows).toHaveLength(0);
  });
});

describe('request-rate cap on setup', () => {
  it('refuses a flood from one address', async () => {
    const t = await freshInstall({ loginRequestsPerMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post(t.app, '/api/setup', body(`guess-${i}`))).statusCode);
    expect(codes).toEqual([403, 403, 403, 429, 429]);
  });
});

describe('GET /api/setup/status', () => {
  it('says setup is needed on a fresh install, and not after', async () => {
    const t = await freshInstall();
    expect((await t.app.inject({ url: '/api/setup/status' })).json()).toEqual({ needsSetup: true });
    expect((await post(t.app, '/api/setup', body(t.token))).statusCode).toBe(201);
    expect((await t.app.inject({ url: '/api/setup/status' })).json()).toEqual({ needsSetup: false });
  });
});

describe('POST /api/setup', () => {
  it('creates the SuperAdmin and the tree, signs them in, and removes the token', async () => {
    const t = await freshInstall();
    const response = await post(t.app, '/api/setup', body(t.token));
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      user: {
        id: expect.any(String),
        email: 'marcus@example.com',
        displayName: 'Marcus Hale',
        role: 'superadmin',
        personId: null,
        lineageView: 'adoptive',
      },
      treeName: 'Hale Family',
    });
    expect(JSON.stringify(response.json())).not.toMatch(/password|hash/i);

    const cookie = sessionCookie(response);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.secure).toBeFalsy(); // plain HTTP in this test

    expect(await userCount(t)).toBe(1);
    expect((await sql`select 1 from setup_token`.execute(t.owner)).rows).toHaveLength(0);
    const stored = await sql<{ password_hash: string }>`select password_hash from users`.execute(t.owner);
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0]?.password_hash).not.toContain(PASSWORD);
  });

  it('creates and links the first person when asked to', async () => {
    const t = await freshInstall();
    const response = await post(
      t.app,
      '/api/setup',
      body(t.token, { person: { givenName: '  Marcus ', surname: 'Hale' } }),
    );
    expect(response.statusCode).toBe(201);
    const { user } = response.json() as { user: { id: string; personId: string } };
    expect(user.personId).toEqual(expect.any(String));
    const rows = await sql<{ given_name: string; surname: string; created_by: string; person_id: string }>`
      select p.given_name, p.surname, p.created_by, u.person_id from people p join users u on u.person_id = p.id`.execute(
      t.owner,
    );
    expect(rows.rows).toEqual([
      { given_name: 'Marcus', surname: 'Hale', created_by: user.id, person_id: user.personId },
    ]);
    const cookie = sessionCookie(response);
    const me = await t.app.inject({ url: '/api/auth/me', cookies: { [cookie!.name]: cookie!.value } });
    expect((me.json() as { user: { personId: string } }).user.personId).toBe(user.personId);
  });

  it('refuses a person with a missing or empty name, and then creates nothing', async () => {
    const t = await freshInstall();
    for (const person of [
      { givenName: 'Marcus' },
      { givenName: '  ', surname: 'Hale' },
      { givenName: 'Marcus', surname: '' },
    ]) {
      const response = await post(t.app, '/api/setup', body(t.token, { person }));
      expect(response.statusCode).toBe(400);
    }
    expect(await userCount(t)).toBe(0);
    expect((await sql`select 1 from people`.execute(t.owner)).rows).toHaveLength(0);
  });

  it('refuses a wrong token, creates nothing, and says nothing about other fields', async () => {
    const t = await freshInstall();
    const response = await post(t.app, '/api/setup', body('not-the-token', { email: 'not an email', password: 'x' }));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'invalid_setup_token' });
    expect(sessionCookie(response)).toBeUndefined();
    expect(await userCount(t)).toBe(0);
  });

  it('refuses a missing token or one with the wrong shape', async () => {
    const t = await freshInstall();
    const noToken: Record<string, unknown> = { ...body('x') };
    delete noToken.token;
    expect((await post(t.app, '/api/setup', noToken)).statusCode).toBe(400);
    expect((await post(t.app, '/api/setup', body('x', { token: 42 }))).statusCode).toBe(400);
    expect((await post(t.app, '/api/setup', { ...body(t.token), role: 'superadmin' })).statusCode).toBe(400);
    expect(await userCount(t)).toBe(0);
  });

  it('checks the other fields (after the token), with clear error codes', async () => {
    const t = await freshInstall();
    const short = await post(t.app, '/api/setup', body(t.token, { password: 'only eleven' }));
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({ error: 'password_too_short', minLength: 12 });
    expect((await post(t.app, '/api/setup', body(t.token, { email: 'nope' }))).json()).toEqual({
      error: 'invalid_email',
    });
    expect((await post(t.app, '/api/setup', body(t.token, { displayName: '  ' }))).json()).toEqual({
      error: 'invalid_display_name',
    });
    expect((await post(t.app, '/api/setup', body(t.token, { treeName: '' }))).json()).toEqual({
      error: 'invalid_tree_name',
    });
    expect(await userCount(t)).toBe(0);
    // The token was not used up by those mistakes.
    expect((await post(t.app, '/api/setup', body(t.token))).statusCode).toBe(201);
  });

  it('accepts a password of exactly the minimum length, with no other rules', async () => {
    const t = await freshInstall();
    const response = await post(t.app, '/api/setup', body(t.token, { password: 'aaaaaaaaaaaa' }));
    expect(response.statusCode).toBe(201);
  });

  it('fails closed once an account exists, even with a valid-looking token', async () => {
    const t = await freshInstall();
    expect((await post(t.app, '/api/setup', body(t.token))).statusCode).toBe(201);
    const again = await post(t.app, '/api/setup', body(t.token, { email: 'attacker@example.com' }));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_set_up' });
    expect(await userCount(t)).toBe(1);
  });

  it('lets exactly one of several simultaneous attempts win', async () => {
    const t = await freshInstall();
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        post(t.app, '/api/setup', body(t.token, { email: `person${i}@example.com` })),
      ),
    );
    const codes = attempts.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await userCount(t)).toBe(1);
    expect(Number((await sql<{ n: string }>`select count(*) as n from family_tree`.execute(t.owner)).rows[0]?.n)).toBe(
      1,
    );
  });

  it('answers "already set up", not "wrong token", to a loser of a race, and does not count it as a bad guess', async () => {
    const t = await freshInstall();
    expect((await post(t.app, '/api/setup', body(t.token))).statusCode).toBe(201);

    // A request that checked "is setup needed?" just before the winner finished: its first check says yes ...
    vi.mocked(store.needsSetup).mockResolvedValueOnce(true);
    const late = await post(t.app, '/api/setup', body(t.token, { email: 'late@example.com' }));
    // ... but by the time it looks at the token, setup is done.
    expect(late.statusCode).toBe(409);
    expect(late.json()).toEqual({ error: 'already_set_up' });

    // Nor did it use up the address's allowance of bad guesses.
    for (let i = 0; i < 9; i++) expect((await post(t.app, '/api/setup', body(`guess-${i}`))).statusCode).toBe(409);
    expect(await userCount(t)).toBe(1);
  });

  it('needs the CSRF header', async () => {
    const t = await freshInstall();
    const response = await t.app.inject({ method: 'POST', url: '/api/setup', payload: body(t.token) });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'csrf' });
    expect(await userCount(t)).toBe(0);
  });

  it('slows down guessing: after 10 wrong tokens from one address it refuses everything, even the right token', async () => {
    const t = await freshInstall();
    for (let i = 0; i < 10; i++) {
      expect((await post(t.app, '/api/setup', body(`guess-${i}`))).statusCode).toBe(403);
    }
    const blocked = await post(t.app, '/api/setup', body(t.token));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(await userCount(t)).toBe(0);
    // Another address is not blocked by that one's failures.
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: body(t.token),
      headers: CSRF,
      remoteAddress: '10.9.9.9',
    });
    expect(other.statusCode).toBe(201);
  });

  it('also limits guessing spread over many addresses', async () => {
    const t = await freshInstall();
    for (let i = 0; i < 30; i++) {
      await t.app.inject({
        method: 'POST',
        url: '/api/setup',
        payload: body(`guess-${i}`),
        headers: CSRF,
        remoteAddress: `10.1.${Math.floor(i / 250)}.${i % 250}`,
      });
    }
    const blocked = await t.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: body(t.token),
      headers: CSRF,
      remoteAddress: '10.2.0.1',
    });
    expect(blocked.statusCode).toBe(429);
  });
});
