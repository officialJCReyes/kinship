// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a backup records about the database it came from, and what a restore is checked against: per-table row counts and
// digests, and a fingerprint of the protections (row-level security, policies, SECURITY DEFINER functions, grants).
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { UntypedDb } from '../db.js';
import { BackupError } from './errors.js';

export interface TableStats {
  rows: number;
  /** md5 of every row's text, sorted. Equal on both sides when the data is equal. */
  digest: string;
}

export interface Fingerprint {
  tables: string[];
  policies: string[];
  definerFunctions: string[];
  tableGrants: string[];
  columnGrants: string[];
  schemaPrivileges: string[];
  functionExecute: string[];
  defaultPrivileges: string[];
  appRole: { superuser: boolean; bypassRls: boolean; createDb: boolean; createRole: boolean };
}

/** Throws unless the connected role can read every row: a superuser, or BYPASSRLS. Otherwise a dump would miss rows. */
export async function assertOwnerReadsEverything(db: UntypedDb): Promise<void> {
  const result = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>`
    select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`.execute(db);
  const role = result.rows[0];
  if (!role) throw new BackupError('owner_cannot_read_all', 'Cannot read the database owner role.');
  if (!role.rolsuper && !role.rolbypassrls) {
    throw new BackupError(
      'owner_cannot_read_all',
      `The database owner role "${role.rolname}" is neither a superuser nor allowed to bypass row-level security, ` +
        'so a backup would miss rows. A superuser must run this once, then try again: ' +
        `ALTER ROLE "${role.rolname}" BYPASSRLS;`,
    );
  }
}

/** True when the owner can read every row (see assertOwnerReadsEverything). */
export async function ownerReadsEverything(db: UntypedDb): Promise<boolean> {
  try {
    await assertOwnerReadsEverything(db);
    return true;
  } catch (error) {
    if (error instanceof BackupError) return false;
    throw error;
  }
}

/** Every ordinary table in the public schema, so a table added by a later migration is covered without a code change. */
export async function listTables(db: Kysely<unknown>): Promise<string[]> {
  const result = await sql<{ relname: string }>`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by c.relname`.execute(db);
  return result.rows.map((row) => row.relname);
}

/** Row counts and digests of every table. Run inside the transaction whose snapshot the dump uses. */
export async function tableStats(db: Kysely<unknown>): Promise<Record<string, TableStats>> {
  await sql`set local time zone 'UTC'`.execute(db);
  const stats: Record<string, TableStats> = {};
  for (const table of await listTables(db)) {
    const result = await sql<{ n: string; digest: string }>`
      select count(*)::text as n, md5(coalesce(string_agg(t::text, E'\n' order by t::text), '')) as digest
        from ${sql.table(`public.${table}`)} t`.execute(db);
    const row = result.rows[0];
    stats[table] = { rows: Number(row?.n ?? 0), digest: row?.digest ?? '' };
  }
  return stats;
}

const strings = (rows: Array<Record<string, unknown>>, key: string): string[] =>
  rows.map((row) => String(row[key])).sort();

/** A description of the protections the database has, for the app role named `appRole`. */
export async function fingerprint(db: Kysely<unknown>, appRole: string): Promise<Fingerprint> {
  const q = async (query: ReturnType<typeof sql>) => (await query.execute(db)).rows as Array<Record<string, unknown>>;
  const tables = await q(sql`
    select c.relname || ':rls=' || c.relrowsecurity || ':force=' || c.relforcerowsecurity as v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`);
  const policies = await q(sql`
    select tablename || '.' || policyname || ':' || cmd || ':' || roles::text as v from pg_policies
     where schemaname = 'public'`);
  const definer = await q(sql`
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'kinship_auth') and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  const tableGrants = await q(sql`
    select table_name || ':' || privilege_type as v from information_schema.role_table_grants
     where grantee = ${appRole} and table_schema = 'public'`);
  const columnGrants = await q(sql`
    select table_name || '.' || column_name || ':' || privilege_type as v from information_schema.column_privileges
     where grantee = ${appRole} and table_schema = 'public'`);
  const schemaPrivileges = await q(sql`
    select s.nspname || ':' || p.priv || '=' || has_schema_privilege(${appRole}, s.nspname, p.priv) as v
      from pg_namespace s cross join (values ('USAGE'), ('CREATE')) as p(priv)
     where s.nspname in ('public', 'kinship_auth')`);
  const functionExecute = await q(sql`
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')='
           || has_function_privilege(${appRole}, p.oid, 'EXECUTE') as v
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'kinship_auth')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`);
  const defaults = await q(sql`
    select defaclobjtype::text || ':' || defaclacl::text as v from pg_default_acl
     where defaclnamespace = 'public'::regnamespace`);
  const role = await q(sql`
    select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = ${appRole}`);
  const attributes = role[0];
  return {
    tables: strings(tables, 'v'),
    policies: strings(policies, 'v'),
    definerFunctions: strings(definer, 'v'),
    tableGrants: strings(tableGrants, 'v'),
    columnGrants: strings(columnGrants, 'v'),
    schemaPrivileges: strings(schemaPrivileges, 'v'),
    functionExecute: strings(functionExecute, 'v'),
    defaultPrivileges: strings(defaults, 'v'),
    appRole: {
      superuser: attributes?.['rolsuper'] === true,
      bypassRls: attributes?.['rolbypassrls'] === true,
      createDb: attributes?.['rolcreatedb'] === true,
      createRole: attributes?.['rolcreaterole'] === true,
    },
  };
}

/** What differs between two fingerprints, in words (empty when they are the same). */
export function fingerprintDifferences(expected: Fingerprint, actual: Fingerprint): string[] {
  const out: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof Fingerprint>) {
    const a = expected[key];
    const b = actual[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      for (const item of a) if (!b.includes(item)) out.push(`${key}: missing ${item}`);
      for (const item of b) if (!a.includes(item)) out.push(`${key}: unexpected ${item}`);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(`${key}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`);
    }
  }
  return out;
}
