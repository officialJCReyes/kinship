// SPDX-License-Identifier: AGPL-3.0-or-later
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DbConfig } from './config.js';

/**
 * Tables as the app role sees them. Hand-written for now; generating these
 * from the real schema is planned (ADR 0001) once there are more tables.
 */
/**
 * For code that works with tables it has no types for (the migration runner,
 * test setup). Kysely's own migration API is typed this way.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySchema = any;
export type UntypedDb = Kysely<AnySchema>;

export interface Database {
  schema_info: {
    id: boolean;
    schema_number: number;
    updated_at: Date;
  };
  /** The app role can read these columns, and only the signed-in person's own row (row-level security). */
  users: {
    id: string;
    email: string;
    display_name: string;
    role: 'superadmin' | 'familyadmin' | 'member' | 'user';
    created_at: Date;
    updated_at: Date;
  };
  /** Readable only when someone is signed in. */
  family_tree: {
    name: string;
    created_at: Date;
  };
}

/**
 * A Kysely instance connected as one of the two roles.
 *
 * An idle pooled connection can be dropped by the server (a Postgres restart,
 * a network blip). `pg` reports that as an "error" event on the pool, and an
 * unhandled one would crash the process. We log it instead; the pool discards
 * the dead connection and opens a new one when needed.
 */
export function createDb<T = Database>(
  db: Pick<DbConfig, 'host' | 'port' | 'name'>,
  user: string,
  password: string,
  max = 10,
): Kysely<T> {
  const pool = new pg.Pool({ host: db.host, port: db.port, database: db.name, user, password, max });
  pool.on('error', (error) => {
    console.error(
      JSON.stringify({ level: 'warn', time: Date.now(), msg: 'idle database connection dropped', err: error.message }),
    );
  });
  return new Kysely<T>({ dialect: new PostgresDialect({ pool }) });
}

/** Owner role: migrations and role setup only. Never used for requests. */
export function createOwnerDb(db: DbConfig): UntypedDb {
  return createDb<AnySchema>(db, db.ownerUser, db.ownerPassword, 2);
}

/** App role (not the owner, no BYPASSRLS): every request runs as this. */
export function createAppDb(db: DbConfig): Kysely<Database> {
  return createDb<Database>(db, db.appUser, db.appPassword);
}
