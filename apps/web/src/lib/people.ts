// SPDX-License-Identifier: AGPL-3.0-or-later
import { displayName } from '../lib/names.js';
import type { Parentage, Person, TreeResponse, Union } from '@kinship/shared';
import { t } from '../i18n.js';
import { formatYear } from './dates.js';

/** "1955 – 2020", "b. 1955", or "" when no years are known. */
export function lifespan(person: Pick<Person, 'birth' | 'death' | 'deceased'>): string {
  const born = formatYear(person.birth);
  const died = formatYear(person.death);
  if (person.deceased) return born || died ? `${born || '?'} – ${died || '?'}` : t('person.deceased');
  return born ? t('person.bornShort', { year: born }) : '';
}

/** A lookup of the people in a tree response, by id. */
export function peopleById(tree: TreeResponse | undefined): Map<string, Person> {
  return new Map((tree?.people ?? []).map((person) => [person.id, person]));
}

/** The ids of the parents a parentage points to (one for a single parent, two for a relationship). */
export function parentIdsOf(parentage: Parentage | null | undefined, unions: readonly Union[]): string[] {
  if (!parentage) return [];
  if (parentage.parentId) return [parentage.parentId];
  const union = unions.find((candidate) => candidate.id === parentage.unionId);
  return union ? [...union.partnerIds] : [];
}

export interface Siblings {
  full: Person[];
  half: Person[];
}

/** Brothers and sisters from a tree response (loaded with collateral=true). Half = shares only some parents. */
export function siblingsOf(tree: TreeResponse | undefined, personId: string): Siblings {
  const result: Siblings = { full: [], half: [] };
  if (!tree) return result;
  const mine = parentIdsOf(tree.parentage[personId], tree.unions);
  if (mine.length === 0) return result;
  const people = peopleById(tree);
  for (const [childId, parentage] of Object.entries(tree.parentage)) {
    if (childId === personId) continue;
    const theirs = parentIdsOf(parentage, tree.unions);
    const shared = theirs.filter((id) => mine.includes(id)).length;
    const person = people.get(childId);
    if (!person || shared === 0) continue;
    (shared === mine.length && shared === theirs.length ? result.full : result.half).push(person);
  }
  const byName = (a: Person, b: Person) => displayName(a).localeCompare(displayName(b));
  result.full.sort(byName);
  result.half.sort(byName);
  return result;
}

/**
 * Two responses about the same person, one per lineage view, as one: everyone and every relationship either knows.
 * Used by the profile, which lists both families. `parentage` is the first response's (the viewer's own).
 */
export function mergeTrees(mine: TreeResponse, other: TreeResponse | undefined): TreeResponse {
  if (!other) return mine;
  const people = new Map(mine.people.map((p) => [p.id, p]));
  for (const p of other.people) if (!people.has(p.id)) people.set(p.id, p);
  const unions = new Map(mine.unions.map((u) => [u.id, u]));
  for (const u of other.unions) if (!unions.has(u.id)) unions.set(u.id, u);
  return { ...mine, people: [...people.values()], unions: [...unions.values()] };
}

/**
 * How many relationships the SERVER set to Widowed between two readings of the same person's relationships: they
 * are Widowed and automatic now, and were not both before. Only what the server reports counts; nothing is guessed.
 */
export function newlyAutoWidowed(
  before: ReadonlyArray<Pick<Union, 'id' | 'status' | 'statusAuto'>>,
  after: ReadonlyArray<Pick<Union, 'id' | 'status' | 'statusAuto'>>,
): number {
  const was = new Map(before.map((u) => [u.id, u]));
  return after.filter((u) => {
    if (u.status !== 'widowed' || !u.statusAuto) return false;
    const old = was.get(u.id);
    return !(old && old.status === 'widowed' && old.statusAuto);
  }).length;
}
