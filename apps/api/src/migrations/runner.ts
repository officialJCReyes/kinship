// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import type { UntypedDb } from '../db.js';
import { Migrator } from 'kysely/migration';
import type { Migration, MigrationProvider } from 'kysely/migration';
import { readMigrationFiles } from './files.js';
import type { MigrationFile } from './files.js';

// Arbitrary constant: serializes the runner's own setup step (not Kysely's lock).
const SETUP_LOCK_KEY = 7_302_041_118;

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export interface RunOptions {
  dir: string;
  /** Name of the app role. Migrations read it from the setting "kinship.app_role". */
  appRole: string;
  log?: (message: string) => void;
}

export interface RunResult {
  applied: string[];
}

/**
 * Applies the numbered .sql files in `dir` that have not been applied yet.
 *
 * - Kysely's Migrator takes a Postgres advisory lock for the whole run, runs
 *   the pending migrations in one transaction and refuses to start if an
 *   applied migration is missing or out of order.
 * - On top of that, this runner stores a SHA-256 of every file it applies and
 *   checks them before each run: an applied file that was edited fails loudly.
 * - Forward-only: there are no down migrations.
 * - `db` must be connected as the owner role.
 */
export async function runMigrations(db: UntypedDb, options: RunOptions): Promise<RunResult> {
  const files = await readMigrationFiles(options.dir);

  await prepareAndVerify(db, files);

  const migrator = new Migrator({ db, provider: new SqlFileProvider(files, options.appRole) });
  const { error, results } = await migrator.migrateToLatest();
  const applied: string[] = [];
  for (const result of results ?? []) {
    if (result.status === 'Success') {
      applied.push(result.migrationName);
      options.log?.(`applied migration ${result.migrationName}`);
    }
  }
  if (error) {
    throw new MigrationError(
      `Migration failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  return { applied };
}

/** Creates the checksum table and compares every already-applied file with its stored checksum. */
async function prepareAndVerify(db: UntypedDb, files: MigrationFile[]): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`.execute(trx);
    await sql`
      create table if not exists kinship_migration_checksum (
        name       text        primary key,
        sha256     text        not null,
        applied_at timestamptz not null default now()
      )`.execute(trx);

    const exists = await sql<{
      present: boolean;
    }>`select to_regclass('kysely_migration') is not null as present`.execute(trx);
    if (!exists.rows[0]?.present) return;

    const applied = await sql<{ name: string }>`select name from kysely_migration order by name`.execute(trx);
    const stored = await sql<{
      name: string;
      sha256: string;
    }>`select name, sha256 from kinship_migration_checksum`.execute(trx);
    const storedByName = new Map(stored.rows.map((row) => [row.name, row.sha256]));
    const filesByName = new Map(files.map((file) => [file.name, file]));

    for (const { name } of applied.rows) {
      const file = filesByName.get(name);
      if (!file) {
        throw new MigrationError(
          `Migration ${name} was applied to this database but its file is missing. Use the same version of KinShip that applied it, or newer.`,
        );
      }
      const expected = storedByName.get(name);
      if (expected === undefined) {
        throw new MigrationError(
          `Migration ${name} was applied but has no checksum recorded. The database was changed outside KinShip.`,
        );
      }
      if (expected !== file.sha256) {
        throw new MigrationError(
          `Migration ${name} was edited after it was applied (checksum differs). Applied migrations must never change; add a new migration instead.`,
        );
      }
    }
  });
}

class SqlFileProvider implements MigrationProvider {
  constructor(
    private readonly files: MigrationFile[],
    private readonly appRole: string,
  ) {}

  getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    for (const file of this.files) {
      migrations[file.name] = {
        up: async (db) => {
          // Transaction-local: gone when the migration run ends.
          await sql`select set_config('kinship.app_role', ${this.appRole}, true)`.execute(db);
          await sql.raw(file.sql).execute(db);
          await sql`insert into kinship_migration_checksum (name, sha256) values (${file.name}, ${file.sha256})`.execute(
            db,
          );
          await sql`
            insert into schema_info (id, schema_number) values (true, ${file.number})
            on conflict (id) do update set schema_number = excluded.schema_number, updated_at = now()`.execute(db);
        },
      };
    }
    return Promise.resolve(migrations);
  }
}
