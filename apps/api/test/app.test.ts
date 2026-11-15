// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createAppDb } from '../src/db.js';
import type { Database } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { ConfigError } from '../src/config.js';
import { STUB_USER, USER_SETTING, assertStubUserAllowed } from '../src/request-context.js';
import { readVersion } from '../src/version.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';
import type { Kysely } from 'kysely';

let test: TestDatabase;
let db: Kysely<Database>;
const apps: FastifyInstance[] = [];

function makeApp(database: Kysely<Database> = db, gitCommit = 'abc1234'): FastifyInstance {
  const app = buildApp({ db: database, version: readVersion(gitCommit), nodeEnv: 'test', logLevel: 'silent' });
  apps.push(app);
  return app;
}

beforeAll(async () => {
  test = await createTestDatabase();
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
  db = test.track(createAppDb(test.config));
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
afterAll(() => test.cleanup());

describe('GET /api/health', () => {
  it('is ok when the database answers', async () => {
    const response = await makeApp().inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });

  it('is 503 when the database cannot be reached', async () => {
    const broken = createAppDb({ ...test.config, port: 1 });
    try {
      const response = await makeApp(broken).inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'unavailable', database: 'unreachable' });
    } finally {
      await broken.destroy();
    }
  });
});

describe('GET /api/version', () => {
  it('returns the package version and the git commit, without needing the database', async () => {
    const broken = createAppDb({ ...test.config, port: 1 });
    try {
      const response = await makeApp(broken, 'abc1234').inject({ method: 'GET', url: '/api/version' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ name: 'kinship-api', version: '0.0.0', commit: 'abc1234' });
    } finally {
      await broken.destroy();
    }
  });
});

describe('stub user guard (TODO(auth): remove with the stub)', () => {
  it('refuses to build the app when NODE_ENV is production', () => {
    expect(() => buildApp({ db, version: readVersion('x'), nodeEnv: 'production', logLevel: 'silent' })).toThrow(
      /Refusing to start: sign-in is not built yet/,
    );
  });

  it('assertStubUserAllowed only refuses production', () => {
    expect(() => assertStubUserAllowed('production')).toThrow(ConfigError);
    for (const env of ['development', 'test', undefined]) {
      expect(() => assertStubUserAllowed(env)).not.toThrow();
    }
  });
});

describe('request.withTransaction', () => {
  it('runs a route inside a transaction as the (stub) signed-in user', async () => {
    const app = makeApp();
    app.get('/test/whoami', (request) =>
      request.withTransaction(async (trx) => {
        const r = await sql<{ user_id: string; db_user: string }>`
          select current_setting(${USER_SETTING}, true) as user_id, current_user as db_user`.execute(trx);
        return r.rows[0];
      }),
    );
    const response = await app.inject({ method: 'GET', url: '/test/whoami' });
    expect(response.json()).toEqual({ user_id: STUB_USER.id, db_user: test.config.appUser });
  });
});
