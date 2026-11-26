// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import type { AppOptions } from '../../src/app.js';
import { hashPassword } from '../../src/auth/passwords.js';
import { createAppDb } from '../../src/db.js';
import type { Database, UntypedDb } from '../../src/db.js';
import { ensureAppRole } from '../../src/migrations/roles.js';
import { runMigrations } from '../../src/migrations/runner.js';
import { readVersion } from '../../src/version.js';
import { createTestDatabase } from './db.js';
import type { TestDatabase } from './db.js';
import { realMigrationsDir } from './migrations-dir.js';

export const CSRF = { 'x-kinship-request': '1' } as const;
export const SESSION_COOKIE = 'kinship_session';

export interface TestApp {
  test: TestDatabase;
  app: FastifyInstance;
  /** The app role (what requests use). */
  db: Kysely<Database>;
  /** The owner role, for arranging and checking things the app role cannot touch. */
  owner: UntypedDb;
  close(): Promise<void>;
}

/** A migrated database with an app role, and the API built on top of it. */
export async function createTestApp(
  overrides: Partial<AppOptions> = {},
  /** Add routes (for example test-only ones) before the app starts accepting requests. */
  beforeReady?: (app: FastifyInstance) => void,
): Promise<TestApp> {
  const test = await createTestDatabase();
  await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
  await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
  const db = test.track(createAppDb(test.config));
  const app = buildApp({
    db,
    version: readVersion('abc1234', '2026-11-15T19:04:05Z'),
    logLevel: 'silent',
    sessions: { idleSeconds: 3600, maxSeconds: 86_400 },
    failureDelayMs: 0,
    // The per-account slow-down (ADR 0042) is not waited out in tests; tests that check it record the wait.
    pause: () => Promise.resolve(),
    // The failure limiters are what most tests exercise; the plain request cap has its own tests.
    loginRequestsPerMinute: 10_000,
    apiRequestsPerMinute: 100_000,
    ...overrides,
  });
  beforeReady?.(app);
  await app.ready();
  return {
    test,
    app,
    db,
    owner: test.owner,
    async close() {
      await app.close();
      await test.cleanup();
    },
  };
}

export const PASSWORD = 'correct horse battery staple';

/** Inserts an account directly (as the owner), the way the first-run setup would. */
export async function insertUser(
  owner: UntypedDb,
  fields: { email: string; displayName?: string; password?: string; role?: string; passwordHash?: string },
): Promise<string> {
  const hash = fields.passwordHash ?? (await hashPassword(fields.password ?? PASSWORD));
  const result = await sql<{ id: string }>`
    insert into users (email, display_name, password_hash, role)
    values (${fields.email.toLowerCase()}, ${fields.displayName ?? fields.email}, ${hash}, ${fields.role ?? 'member'})
    returning id`.execute(owner);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('insert failed');
  return id;
}

export function sessionCookie(response: LightMyRequestResponse) {
  return response.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

/** "name=value" for the Cookie header of the next request. */
export function cookieHeader(response: LightMyRequestResponse): string {
  const cookie = sessionCookie(response);
  if (!cookie) throw new Error('no session cookie in the response');
  return `${SESSION_COOKIE}=${cookie.value}`;
}

export function post(app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload: payload as object, headers: { ...CSRF, ...headers } });
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
  headers: Record<string, string> = {},
) {
  return post(app, '/api/auth/login', { email, password }, headers);
}
