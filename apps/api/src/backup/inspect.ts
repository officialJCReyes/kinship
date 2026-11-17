// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a backup records about the database it came from, and what a restore is checked against: per-table row counts and
// digests, and a fingerprint of the protections (row-level security, policies, SECURITY DEFINER functions, grants).
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';
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
  appRole: { superuser: boolean; bypassRls: boolean; createDb: boolean; createRole: boolean } | null;
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
export async function listTables(db: QueryExecutorProvider): Promise<string[]> {
  const result = await sql<{ relname: string }>`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by c.relname`.execute(db);
  return result.rows.map((row) => row.relname);
}

/** Row counts and digests of every table. Run inside the transaction whose snapshot the dump uses. */
export async function tableStats(db: QueryExecutorProvider): Promise<Record<string, TableStats>> {
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

/** SQL text with a quoted literal (role names are validated elsewhere; this still escapes). */
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * One SELECT that returns the fingerprint as a jsonb value, for the app role named `appRole`. The same text runs from Node
 * (to make and to check a fingerprint) and INSIDE the restore transaction, so a restore can compare before it commits. Every
 * list is sorted with the C collation, so two databases give byte-identical arrays when they are the same.
 */
export function fingerprintQuery(appRole: string): string {
  const app = literal(appRole);
  const list = (inner: string) =>
    `coalesce((select jsonb_agg(v order by v collate "C") from (${inner}) x), '[]'::jsonb)`;
  const nonExtension = (alias: string) =>
    `not exists (select 1 from pg_catalog.pg_depend d where d.objid = ${alias}.oid and d.deptype = 'e')`;
  return `select jsonb_build_object(
    'tables', ${list(`select c.relname || ':rls=' || c.relrowsecurity || ':force=' || c.relforcerowsecurity as v
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'`)},
    'policies', ${list(`select tablename || '.' || policyname || ':' || cmd || ':' || roles::text as v
      from pg_catalog.pg_policies where schemaname = 'public'`)},
    'definerFunctions', ${list(`select n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as v
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'kinship_auth') and p.prosecdef and ${nonExtension('p')}`)},
    'tableGrants', ${list(`select c.relname || ':' || a.privilege_type || ':' || a.is_grantable as v
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(c.relacl) a join pg_catalog.pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and c.relkind in ('r', 'S', 'v', 'm', 'p') and r.rolname = ${app}`)},
    'columnGrants', ${list(`select c.relname || '.' || t.attname || ':' || a.privilege_type as v
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute t on t.attrelid = c.oid and t.attacl is not null
      cross join lateral pg_catalog.aclexplode(t.attacl) a join pg_catalog.pg_roles r on r.oid = a.grantee
     where n.nspname = 'public' and r.rolname = ${app}`)},
    'schemaPrivileges', ${list(`select s.nspname || ':' || p.priv || '=' || pg_catalog.has_schema_privilege(${app}, s.nspname, p.priv) as v
      from pg_catalog.pg_namespace s cross join (values ('USAGE'), ('CREATE')) as p(priv)
     where s.nspname in ('public', 'kinship_auth')`)},
    'functionExecute', ${list(`select n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')='
           || pg_catalog.has_function_privilege(${app}, p.oid, 'EXECUTE') as v
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'kinship_auth') and ${nonExtension('p')}`)},
    'defaultPrivileges', ${list(`select defaclobjtype::text || ':' || defaclacl::text as v from pg_catalog.pg_default_acl
     where defaclnamespace = 'public'::pg_catalog.regnamespace`)},
    'appRole', (select jsonb_build_object('superuser', rolsuper, 'bypassRls', rolbypassrls, 'createDb', rolcreatedb, 'createRole', rolcreaterole)
                  from pg_catalog.pg_roles where rolname = ${app})
  ) as fingerprint`;
}

/** A description of the protections the database has, for the app role named `appRole`. */
export async function fingerprint(db: QueryExecutorProvider, appRole: string): Promise<Fingerprint> {
  const result = await sql<{ fingerprint: Fingerprint }>`${sql.raw(fingerprintQuery(appRole))}`.execute(db);
  const value = result.rows[0]?.fingerprint;
  if (!value) throw new Error('the database gave no fingerprint');
  return value;
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
