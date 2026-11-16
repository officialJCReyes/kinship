// SPDX-License-Identifier: AGPL-3.0-or-later
import { Kysely, PostgresDialect } from 'kysely';
import type { ColumnType, Generated } from 'kysely';
import pg from 'pg';
import type { DatePrecision, UnionStatus } from '@kinship/shared';
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

type DatePrecisionCode = DatePrecision;
type UnionStatusCode = UnionStatus;

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
    /** The person this account is linked to (0005). */
    person_id: string | null;
    /** Which family this account's charts follow for an adopted person (0006). */
    lineage_view: Generated<'adoptive' | 'birth'>;
    created_at: Date;
    updated_at: Date;
  };
  people: {
    id: Generated<string>;
    given_name: string;
    surname: string;
    /** The second (maternal) surname, optional (0007). */
    second_surname: string | null;
    /** The surname taken at marriage, optional (0007). */
    married_surname: string | null;
    gender: 'male' | 'female' | 'other' | null;
    /** As typed: YYYY, YYYY-MM or YYYY-MM-DD. The generated *_from and *_to columns exist but are only used in SQL. */
    birth_date: string | null;
    birth_precision: Generated<DatePrecisionCode>;
    deceased: Generated<boolean>;
    death_date: string | null;
    death_precision: Generated<DatePrecisionCode>;
    search_name: ColumnType<string, never, never>;
    /** Search text over the given name and all three surnames (0007). Replaces search_name, which is dropped in a later release. */
    search_names: ColumnType<string, never, never>;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, never, never>;
  };
  unions: {
    id: Generated<string>;
    partner_a_id: string;
    partner_b_id: string;
    status: UnionStatusCode;
    start_date: string | null;
    start_precision: Generated<DatePrecisionCode>;
    end_date: string | null;
    end_precision: Generated<DatePrecisionCode>;
    /** True when the database set Widowed itself (0007). Only the triggers write it. */
    status_auto: ColumnType<boolean, never, never>;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, never, never>;
  };
  person_parents: {
    child_id: string;
    /** Birth or adoptive (0006). A child has at most one set of each kind. */
    kind: Generated<'birth' | 'adoptive'>;
    union_id: string | null;
    parent_id: string | null;
    link_date: string | null;
    link_precision: Generated<DatePrecisionCode>;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
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
