// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The relationship finder's data (ADR 0028): the family graph as the pure finder in `@kinship/shared` needs it, and the
// facts of the answer (the people it names, and the custom labels between the pair). Everything is read in the
// request's own transaction, so row-level security applies.
import { findWithAdoptionHint } from '@kinship/shared';
import { createRelGraph } from '@kinship/shared';
import type {
  LineageView,
  RelGraphInput,
  RelPerson,
  RelationshipPairLabel,
  RelationshipResponse,
  UnionStatus,
} from '@kinship/shared';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { PERSON_COLUMNS, toPerson } from './store.js';

type Trx = Transaction<Database>;

/**
 * Every person's parents in each family, every relationship and the few facts about people the finder reads. Three
 * queries whatever the size of the family; the walk itself is pure and bounded (30 generations).
 */
export async function loadRelGraphInput(trx: Trx): Promise<RelGraphInput> {
  // placeholders: included (a placeholder may be a hop on a path, never a result; the route refuses one as an end)
  const people = await trx.selectFrom('people').select(['id', 'gender', 'deceased', 'is_placeholder']).execute();
  const unions = await trx.selectFrom('unions').select(['id', 'partner_a_id', 'partner_b_id', 'status']).execute();
  const links = await trx.selectFrom('person_parents').select(['child_id', 'kind', 'union_id', 'parent_id']).execute();
  const partnersOf = new Map(unions.map((union) => [union.id, [union.partner_a_id, union.partner_b_id]]));
  const parents: Record<string, { birth?: string[]; adoptive?: string[] }> = {};
  for (const link of links) {
    const ids = link.union_id ? (partnersOf.get(link.union_id) ?? []) : link.parent_id ? [link.parent_id] : [];
    parents[link.child_id] = { ...parents[link.child_id], [link.kind]: ids };
  }
  return {
    people: people.map((row) => ({
      id: row.id,
      gender: row.gender,
      deceased: row.deceased,
      isPlaceholder: row.is_placeholder,
    })),
    unions: unions.map((row) => ({ a: row.partner_a_id, b: row.partner_b_id, status: row.status as UnionStatus })),
    parents,
  };
}

export const toRelPerson = (row: Parameters<typeof toPerson>[0]): RelPerson => {
  const person = toPerson(row);
  return {
    id: person.id,
    givenName: person.givenName,
    surname: person.surname,
    secondSurname: person.secondSurname,
    marriedSurname: person.marriedSurname,
    namePrefix: person.namePrefix,
    nameSuffix: person.nameSuffix,
    gender: person.gender,
    birth: person.birth,
    deceased: person.deceased,
    death: person.death,
    isPlaceholder: person.isPlaceholder,
    photoMediaId: person.photoMediaId,
  };
};

/** The custom labels between two people, from the first person's side (ADR 0009). */
async function pairLabels(trx: Trx, a: string, b: string): Promise<RelationshipPairLabel[]> {
  const rows = await trx
    .selectFrom('relationship_labels')
    .select(['from_id', 'label', 'reverse_label'])
    .where((eb) =>
      eb.or([
        eb.and([eb('from_id', '=', a), eb('to_id', '=', b)]),
        eb.and([eb('from_id', '=', b), eb('to_id', '=', a)]),
      ]),
    )
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    direction: row.from_id === a ? 'from' : 'to',
    label: row.label,
    reverseLabel: row.reverse_label,
  }));
}

/**
 * How `b` is related to `a`, following `lineage` for adopted people. The caller has checked that both exist and are
 * real people (not placeholders).
 */
export async function relationshipBetween(
  trx: Trx,
  a: string,
  b: string,
  lineage: LineageView,
): Promise<RelationshipResponse> {
  const graph = createRelGraph(await loadRelGraphInput(trx));
  const { facts, other } = findWithAdoptionHint(graph, a, b, lineage);
  const named = new Set<string>([a, b]);
  for (const id of [
    ...(facts.blood ? [...facts.blood.ancestors, ...facts.blood.lineA, ...facts.blood.lineB] : []),
    ...(facts.chain?.people ?? []),
  ]) {
    named.add(id);
  }
  // placeholders: included (an unknown parent may be named in the ancestors and the line)
  const rows = await trx
    .selectFrom('people')
    .select(PERSON_COLUMNS)
    .where('id', 'in', [...named])
    .execute();
  const people: Record<string, RelPerson> = {};
  for (const row of rows) people[row.id] = toRelPerson(row);
  return { ...facts, lineage, a, b, other, people, labels: await pairLabels(trx, a, b) };
}
