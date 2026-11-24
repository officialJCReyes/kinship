// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Linking children who already exist to a second parent (ADR 0039). A child who hangs from one parent alone (a set of one
// kind with that parent only) moves to hang from that parent's relationship with the second parent, keeping the kind.
import type { ApiWarning, LinkKind } from '@kinship/shared';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { ApiError, conflict, fromDatabaseError } from '../errors.js';
import { PERSON_COLUMNS, parentAgeWarnings } from './store.js';
import type { PersonRow, UnionRow } from './store.js';

type Trx = Transaction<Database>;

export interface Linkable {
  row: PersonRow;
  kind: LinkKind;
}

/**
 * The database's rule for one person in both of a child's sets (kinship_check_parentage, migration 0006), worked out ahead:
 * the new set [parent, partner] may share a person with the child's other set only when the adoptive set is a relationship
 * and only one person is shared (a stepparent adoption).
 */
function allowedWithOtherSet(
  kind: LinkKind,
  next: readonly string[],
  other: { parents: readonly string[]; isUnion: boolean } | undefined,
): boolean {
  if (!other) return true;
  const overlap = next.filter((p) => other.parents.includes(p)).length;
  if (overlap === 0) return true;
  const adoptiveIsUnion = kind === 'adoptive' ? true : other.isUnion;
  return adoptiveIsUnion && overlap === 1;
}

/**
 * The children who hang from `parentId` alone (either kind), oldest first. With `partnerId` (an existing person who would be
 * the second parent), the ones the database would refuse are left out: the partner themselves, a child who is the partner's
 * ancestor (a cycle), and a child whose other set already has the partner in a way the both-kinds rule forbids. With no
 * partner (a new person), no such refusal is possible. Two indexed queries plus one walk up from the partner.
 */
export async function linkableChildren(
  trx: Trx,
  parentId: string,
  partnerId: string | null,
  exclude: readonly string[] = [],
): Promise<Linkable[]> {
  const candidates = await trx
    .selectFrom('person_parents as pp')
    .innerJoin('people as c', 'c.id', 'pp.child_id')
    .select(PERSON_COLUMNS.map((column) => `c.${column}` as const))
    .select('pp.kind')
    .where('pp.parent_id', '=', parentId)
    .orderBy(sql`c.birth_from nulls last`)
    .orderBy('c.id')
    .execute();
  const rows = candidates.filter((r) => !exclude.includes(r.id));
  if (rows.length === 0 || partnerId === null) return rows.map(({ kind, ...row }) => ({ row: row as PersonRow, kind }));

  const ids = rows.map((r) => r.id);
  // The partner and every ancestor of theirs (any kind, as the cycle check walks), limited to the candidates.
  const ancestors = await sql<{ id: string }>`
    with recursive up(id) as (
      select ${partnerId}::uuid
      union
      select x.pid
        from up
        join person_parents pp on pp.child_id = up.id
        cross join lateral (
          select pp.parent_id where pp.parent_id is not null
          union all select u.partner_a_id from unions u where u.id = pp.union_id
          union all select u.partner_b_id from unions u where u.id = pp.union_id
        ) x(pid)
    )
    select id from up where id = any(${ids}::uuid[])`.execute(trx);
  const cyclic = new Set(ancestors.rows.map((r) => r.id));
  const otherSets = await sql<{ child_id: string; kind: LinkKind; parents: string[]; is_union: boolean }>`
    select pp.child_id, pp.kind, pp.union_id is not null as is_union,
           case when pp.parent_id is not null then array[pp.parent_id] else array[u.partner_a_id, u.partner_b_id] end as parents
      from person_parents pp
      left join unions u on u.id = pp.union_id
     where pp.child_id = any(${ids}::uuid[])`.execute(trx);
  const setOf = (child: string, kind: LinkKind) => {
    const found = otherSets.rows.find((r) => r.child_id === child && r.kind === kind);
    return found ? { parents: found.parents, isUnion: found.is_union } : undefined;
  };
  return rows
    .filter(
      (r) =>
        !cyclic.has(r.id) &&
        allowedWithOtherSet(r.kind, [parentId, partnerId], setOf(r.id, r.kind === 'birth' ? 'adoptive' : 'birth')),
    )
    .map(({ kind, ...row }) => ({ row: row as PersonRow, kind }));
}

/**
 * Moves each child from one partner of `union` alone to the relationship itself, keeping the kind of the link. `from` limits
 * which partner the children must hang from now (the add-partner and add-parent calls know it); without it either partner
 * will do. All or nothing: the first child that cannot be linked throws, naming the child, and the caller's transaction rolls
 * back. Returns the warnings for every child linked (a parent much too young, for birth links).
 */
export async function linkChildrenToUnion(
  trx: Trx,
  union: Pick<UnionRow, 'id' | 'partner_a_id' | 'partner_b_id'>,
  childIds: readonly string[],
  from?: string,
): Promise<ApiWarning[]> {
  const partners = from === undefined ? [union.partner_a_id, union.partner_b_id] : [from];
  const warnings: ApiWarning[] = [];
  const seen = new Set<string>();
  for (const childId of childIds) {
    const set = await trx
      .selectFrom('person_parents')
      .select(['kind', 'parent_id'])
      .where('child_id', '=', childId)
      .where('parent_id', 'in', partners)
      .executeTakeFirst();
    if (!set) throw conflict('child_not_linkable', { childId });
    try {
      await trx
        .updateTable('person_parents')
        .set({ union_id: union.id, parent_id: null })
        .where('child_id', '=', childId)
        .where('kind', '=', set.kind)
        .execute();
    } catch (error) {
      // The database's own rules (a cycle, one person in both sets) have the last word; say which child it was about.
      const known = fromDatabaseError(error);
      if (known) throw new ApiError(known.status, known.code, { ...known.extra, childId });
      throw error;
    }
    for (const warning of await parentAgeWarnings(trx, childId)) {
      const key = `${warning.childId}|${warning.parentId}`;
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(warning);
      }
    }
  }
  return warnings;
}
