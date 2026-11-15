// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { createDb } from '../../src/db.js';
import type { AnySchema, UntypedDb } from '../../src/db.js';
import type { DbConfig } from '../../src/config.js';

/**
 * Tests use a real Postgres 18: the one from compose.dev.yml
 *   docker compose -f compose.dev.yml up -d db
 * Override with TEST_DB_HOST, TEST_DB_PORT, TEST_DB_USER and TEST_DB_PASSWORD.
 * The user must be allowed to create databases and roles (the official image's
 * POSTGRES_USER is). Every test file gets its own database and its own app role.
 */
const server = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 5433),
  user: process.env.TEST_DB_USER ?? 'kinship',
  password: process.env.TEST_DB_PASSWORD ?? 'dev-owner-password',
};

export interface TestDatabase {
  /** Connection settings, with a fresh database name and app role. */
  config: DbConfig;
  /** Connected as the owner role. */
  owner: UntypedDb;
  /** Extra Kysely instances to close in cleanup. */
  track<T>(db: Kysely<T>): Kysely<T>;
  cleanup(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const id = randomBytes(5).toString('hex');
  const name = `kinship_test_${id}`;
  const appUser = `kinship_app_${id}`;

  const admin = createDb<AnySchema>(
    { host: server.host, port: server.port, name: 'postgres' },
    server.user,
    server.password,
    1,
  );
  try {
    await sql`create database ${sql.id(name)}`.execute(admin);
  } catch (error) {
    await admin.destroy();
    throw new Error(
      `Cannot reach the test Postgres at ${server.host}:${server.port} (${error instanceof Error ? error.message : String(error)}). ` +
        'Start it with: docker compose -f compose.dev.yml up -d db',
      { cause: error },
    );
  }

  const config: DbConfig = {
    host: server.host,
    port: server.port,
    name,
    ownerUser: server.user,
    ownerPassword: server.password,
    appUser,
    appPassword: `test-${id}-password`,
  };
  const tracked: Kysely<unknown>[] = [];
  const track = <T>(db: Kysely<T>): Kysely<T> => {
    tracked.push(db as Kysely<unknown>);
    return db;
  };
  const owner = track(createDb<AnySchema>(config, config.ownerUser, config.ownerPassword, 4));

  return {
    config,
    owner,
    track,
    async cleanup() {
      await Promise.allSettled(tracked.map((db) => db.destroy()));
      await sql`drop database if exists ${sql.id(name)} with (force)`.execute(admin);
      await sql`drop role if exists ${sql.id(appUser)}`.execute(admin);
      await admin.destroy();
    },
  };
}
