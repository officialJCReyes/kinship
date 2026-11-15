// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createAppDb } from '../src/db.js';
import { USER_SETTING } from '../src/request-context.js';
import { readVersion } from '../src/version.js';
import { cookieHeader, createTestApp, insertUser, login } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { readMigrationFiles } from '../src/migrations/files.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';

let t: TestApp;
let userId: string;

beforeAll(async () => {
  t = await createTestApp({}, (app) => {
    app.get('/test/whoami', (request) =>
      request.withTransaction(async (trx) => {
        const r = await sql<{ user_id: string; db_user: string }>`
          select current_setting(${USER_SETTING}, true) as user_id, current_user as db_user`.execute(trx);
        return r.rows[0];
      }),
    );
    app.get('/test/boom', () => {
      throw new Error('secret detail: password_hash=abc');
    });
  });
  userId = await insertUser(t.owner, { email: 'marcus@example.com', role: 'superadmin' });
});
afterAll(() => t.close());

describe('GET /api/health', () => {
  it('is ok when the database answers', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('is 503 when the database cannot be reached', async () => {
    const broken = createAppDb({ ...t.test.config, port: 1 });
    const app = buildApp({
      db: broken,
      version: readVersion('x'),
      logLevel: 'silent',
      sessions: { idleSeconds: 60, maxSeconds: 120 },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable', database: 'unreachable' });
    } finally {
      await app.close();
      await broken.destroy();
    }
  });

  it('needs no sign-in', async () => {
    expect((await t.app.inject({ url: '/api/health' })).statusCode).toBe(200);
  });
});

describe('GET /api/version', () => {
  it('returns the package version, the git commit and the database schema number, with no sign-in', async () => {
    const response = await t.app.inject({ method: 'GET', url: '/api/version' });
    const migrations = await readMigrationFiles(realMigrationsDir);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: 'kinship-api',
      version: '0.0.0',
      commit: 'abc1234',
      schema: migrations.length,
    });
  });

  it('still answers, with schema null, when the database is unreachable', async () => {
    const broken = createAppDb({ ...t.test.config, port: 1 });
    const app = buildApp({
      db: broken,
      version: readVersion('abc1234'),
      logLevel: 'silent',
      sessions: { idleSeconds: 60, maxSeconds: 120 },
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/version' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ name: 'kinship-api', version: '0.0.0', commit: 'abc1234', schema: null });
    } finally {
      await app.close();
      await broken.destroy();
    }
  });
});

describe('request.withTransaction', () => {
  it('runs as the signed-in person, from the session, and as nobody without one', async () => {
    const cookie = cookieHeader(await login(t.app, 'marcus@example.com'));

    const signedIn = await t.app.inject({ url: '/test/whoami', headers: { cookie } });
    expect(signedIn.json()).toEqual({ user_id: userId, db_user: t.test.config.appUser });

    const anonymous = await t.app.inject({ url: '/test/whoami' });
    expect(anonymous.json()).toEqual({ user_id: '', db_user: t.test.config.appUser }); // no user, and not the all-zero UUID
  });
});

describe('errors', () => {
  const json = { 'x-kinship-request': '1', 'content-type': 'application/json' };

  it('keeps a caller’s mistakes as 4xx: empty JSON body, broken JSON, too large', async () => {
    const empty = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: json });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual({ error: 'invalid_request' });

    const broken = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: json, payload: '{"email":' });
    expect(broken.statusCode).toBe(400);

    const huge = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: json,
      payload: JSON.stringify({ email: 'a'.repeat(100_000) }),
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json()).toEqual({ error: 'payload_too_large' });
  });

  it('answers an unknown route with a JSON content type and no body with a 4xx, never a 500', async () => {
    const response = await t.app.inject({ method: 'POST', url: '/api/set-password', headers: json });
    expect(response.statusCode).toBe(400); // the empty body is refused before routing
    const withBody = await t.app.inject({ method: 'POST', url: '/api/set-password', headers: json, payload: '{}' });
    expect(withBody.statusCode).toBe(404);
  });

  it('does not leak details of an internal error', async () => {
    const response = await t.app.inject({ url: '/test/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
  });
});
