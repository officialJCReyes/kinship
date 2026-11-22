// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The restore marker (ADR 0035). A restore that puts photo files back has two halves that cannot share one transaction: the
// database (one Postgres transaction) and the files folder (two renames). If the api dies between them, start-up has to know which
// side it is on. The restore writes an intent file naming a random restore id BEFORE the database transaction, and inside that
// transaction sets this marker: a comment on the `public` schema, which commits or rolls back together with everything else. At the
// next start, "the marker equals the intent's id" means the database committed (finish the file swap); anything else means it did
// not (throw the staged files away). A comment needs no migration, no table and no privilege to read.
import { sql } from 'kysely';
import type { UntypedDb } from '../db.js';

export const MARKER_PREFIX = 'kinship-restore:';
const RESTORE_ID = /^[0-9a-f]{32}$/;

export const isRestoreId = (id: string): boolean => RESTORE_ID.test(id);

/** The statement that sets the marker, for the restore script. The id is checked here, so nothing else can end up in the SQL. */
export function markerSql(restoreId: string): string {
  if (!isRestoreId(restoreId)) throw new Error('not a restore id');
  return `COMMENT ON SCHEMA public IS '${MARKER_PREFIX}${restoreId}';`;
}

/** The restore id the database carries, or null (no restore has written one, or someone changed the comment). */
export async function readRestoreMarker(db: UntypedDb): Promise<string | null> {
  const result = await sql<{ comment: string | null }>`
    select pg_catalog.obj_description('public'::pg_catalog.regnamespace, 'pg_namespace') as comment`.execute(db);
  const comment = result.rows[0]?.comment ?? null;
  if (comment === null || !comment.startsWith(MARKER_PREFIX)) return null;
  const id = comment.slice(MARKER_PREFIX.length);
  return isRestoreId(id) ? id : null;
}
