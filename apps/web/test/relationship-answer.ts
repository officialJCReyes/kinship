// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What GET /api/relationship would answer, worked out by the shared finder on the Hale fixture (for the finder page and
// the person panel's relationship line).
import { findWithAdoptionHint } from '@kinship/shared';
import type { LineageView, Person, RelationshipResponse } from '@kinship/shared';
import { ADMIN } from './family.js';
import { HALE_PEOPLE, haleGraph } from './fixtures/hale.js';

const personOf = (key: string): Person => {
  const p = HALE_PEOPLE.find((candidate) => candidate.key === key)!;
  return {
    id: key,
    givenName: p.givenName,
    surname: p.surname,
    secondSurname: null,
    marriedSurname: null,
    namePrefix: null,
    nameSuffix: null,
    nickname: p.nickname ?? null,
    gender: p.gender,
    birth: { value: p.birth, precision: 'exactly' },
    deceased: p.death !== undefined,
    death: p.death ? { value: p.death, precision: 'exactly' } : null,
    isPlaceholder: false,
    photoMediaId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
};

/** What the API would answer, from the shared finder on the Hale fixture. */
export function answer(
  path: string,
  viewer: LineageView = ADMIN.lineageView,
): { status: number; body: RelationshipResponse } {
  const url = new URL(path, 'http://x');
  const a = url.searchParams.get('a')!;
  const b = url.searchParams.get('b')!;
  const lineage = (url.searchParams.get('lineage') as LineageView | null) ?? viewer;
  const { facts, other } = findWithAdoptionHint(haleGraph(), a, b, lineage);
  const named = new Set<string>([
    a,
    b,
    ...(facts.blood ? [...facts.blood.ancestors, ...facts.blood.lineA, ...facts.blood.lineB] : []),
    ...(facts.chain?.people ?? []),
    ...(facts.chain?.hops ?? []).flatMap((hop) => (hop ? [...hop.ancestors, ...hop.lineA, ...hop.lineB] : [])),
  ]);
  const people: RelationshipResponse['people'] = {};
  for (const key of named) {
    const full = personOf(key);
    people[key] = {
      id: full.id,
      givenName: full.givenName,
      surname: full.surname,
      secondSurname: null,
      marriedSurname: null,
      namePrefix: null,
      nameSuffix: null,
      gender: full.gender,
      birth: full.birth,
      deceased: full.deceased,
      death: full.death,
      isPlaceholder: false,
      photoMediaId: null,
    };
  }
  return { status: 200, body: { ...facts, lineage, a, b, other, people, labels: [] } };
}
