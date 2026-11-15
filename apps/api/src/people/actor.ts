// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from '@kinship/shared';
import type { Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { ApiError } from '../errors.js';
import type { SessionUser } from '../auth/store.js';

/** The signed-in account for one request: who, in what role, and the person they are linked to. */
export interface Actor {
  id: string;
  role: Role;
  personId: string | null;
}

export const isAdmin = (actor: Actor): boolean => actor.role === 'superadmin' || actor.role === 'familyadmin';

/**
 * Reads the account's linked person (row-level security lets an account read only its own row).
 * Throws 401 when the session's account no longer exists.
 */
export async function loadActor(trx: Transaction<Database>, user: SessionUser | null): Promise<Actor> {
  if (!user) throw new ApiError(401, 'unauthenticated');
  const row = await trx
    .selectFrom('users')
    .select(['id', 'role', 'person_id'])
    .where('id', '=', user.id)
    .executeTakeFirst();
  if (!row) throw new ApiError(401, 'unauthenticated');
  return { id: row.id, role: row.role, personId: row.person_id };
}

/**
 * True when this person is the actor's own person or one of their descendants. It asks the same
 * database function the row-level security policies use, so the API and the policies cannot
 * disagree about what "in my line" means.
 */
export async function inMyLine(trx: Transaction<Database>, personId: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`select public.kinship_in_my_line(${personId}::uuid) as ok`.execute(trx);
  return result.rows[0]?.ok === true;
}

/** May the actor change this person's details? (Mirrors the people UPDATE policy.) */
export async function canEditPerson(
  trx: Transaction<Database>,
  actor: Actor,
  person: { id: string; created_by: string | null },
): Promise<boolean> {
  if (isAdmin(actor)) return true;
  if (actor.role !== 'member') return false;
  if (person.id === actor.personId) return true;
  return person.created_by === actor.id && (await inMyLine(trx, person.id));
}

/** May the actor add a child under this person? (Mirrors the person_parents INSERT policy.) */
export async function canAddChildUnder(trx: Transaction<Database>, actor: Actor, personId: string): Promise<boolean> {
  if (isAdmin(actor)) return true;
  if (actor.role !== 'member') return false;
  return inMyLine(trx, personId);
}

/** May the actor change this union's status and dates? (Mirrors the unions UPDATE policy.) */
export function canEditUnion(actor: Actor, union: { partner_a_id: string; partner_b_id: string }): boolean {
  if (isAdmin(actor)) return true;
  if (actor.role !== 'member' || actor.personId === null) return false;
  return actor.personId === union.partner_a_id || actor.personId === union.partner_b_id;
}
