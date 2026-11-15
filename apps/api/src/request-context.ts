// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from './db.js';

/**
 * The Postgres setting that row-level security policies read to learn who is
 * asking, for example:
 *   USING (owner_id = nullif(current_setting('kinship.user_id', true), '')::uuid)
 */
export const USER_SETTING = 'kinship.user_id';

export type { SessionUser as RequestUser } from './auth/store.js';
/**
 * Runs `fn` in one transaction, as the signed-in user, as far as Postgres is
 * concerned. The setting is transaction-local (set_config(..., true)), so it
 * is cleared on commit and on rollback and can never leak to the next request
 * that reuses the pooled connection. A null user means "nobody signed in".
 */
export async function withUserTransaction<T>(
  db: Kysely<Database>,
  userId: string | null,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config(${USER_SETTING}, ${userId ?? ''}, true)`.execute(trx);
    return fn(trx);
  });
}
