// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { loadActor } from './actor.js';
import type { Actor } from './actor.js';

/**
 * Runs a request's database work as the signed-in account: one transaction in which Postgres
 * knows who is asking (so row-level security applies), with the account's role and linked
 * person loaded first. Throws 401 when nobody is signed in.
 */
export function withActor<T>(
  request: FastifyRequest,
  fn: (trx: Transaction<Database>, actor: Actor) => Promise<T>,
): Promise<T> {
  return request.withTransaction(async (trx) => fn(trx, await loadActor(trx, request.user)));
}
