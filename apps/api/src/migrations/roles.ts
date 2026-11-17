// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import type { UntypedDb } from '../db.js';

/**
 * Makes sure the app role exists with the password from the settings.
 *
 * The password is a secret, so it cannot live in a .sql migration. This runs
 * before the migrations, as the owner role, on every start; changing the
 * password in .env therefore takes effect on the next restart.
 * The role can log in and nothing else: no superuser, no CREATE, and it does
 * not bypass row-level security.
 */
export async function ensureAppRole(owner: UntypedDb, role: string, password: string): Promise<void> {
  const existing = await sql<{
    rolcanlogin: boolean;
    rolsuper: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolbypassrls: boolean;
  }>`select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       from pg_roles where rolname = ${role}`.execute(owner);
  const attributes = sql`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`;
  const current = existing.rows[0];
  if (!current) {
    await sql`CREATE ROLE ${sql.id(role)} ${attributes} PASSWORD ${sql.lit(password)}`.execute(owner);
    return;
  }
  // Attributes are only touched when they are not already the safe ones: a plain owner role (ADR 0001 allows one) may change
  // the password of a role it made, but may not "change" attributes it does not hold itself, so rewriting them on every start
  // would fail for it.
  const safe =
    current.rolcanlogin &&
    !current.rolsuper &&
    !current.rolcreatedb &&
    !current.rolcreaterole &&
    !current.rolreplication &&
    !current.rolbypassrls;
  if (safe) await sql`ALTER ROLE ${sql.id(role)} PASSWORD ${sql.lit(password)}`.execute(owner);
  else await sql`ALTER ROLE ${sql.id(role)} ${attributes} PASSWORD ${sql.lit(password)}`.execute(owner);
}
