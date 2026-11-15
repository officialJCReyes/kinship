// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { ConfigError } from './config.js';
import type { Database } from './db.js';

/**
 * The Postgres setting that row-level security policies read to learn who is
 * asking, for example:
 *   USING (owner_id = nullif(current_setting('kinship.user_id', true), '')::uuid)
 */
export const USER_SETTING = 'kinship.user_id';

export interface RequestUser {
  id: string;
}

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

// TODO(auth): STUB. Every request is this user until sign-in exists. The login
// step replaces this with the session lookup and deletes this constant,
// assertStubUserAllowed() and the check in buildApp().
export const STUB_USER: RequestUser = { id: '00000000-0000-0000-0000-000000000001' };

/**
 * TODO(auth): remove with the stub. Refuses to run the stub user in production,
 * so an image built before sign-in exists can never serve real requests as
 * someone who is "signed in" by default.
 */
export function assertStubUserAllowed(nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') {
    throw new ConfigError(
      'Refusing to start: sign-in is not built yet, so every request would run as a stub user. ' +
        'This guard goes away with the login step; until then NODE_ENV must not be "production".',
    );
  }
}
