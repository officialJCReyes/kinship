// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ApiWarning, LinkKind, PartialDateInput, Person, PersonInput, UnionInput } from '@kinship/shared';
import * as api from '../api.js';

/** A person was created but linking them failed, and removing them again failed too. */
export class CreatedButNotLinked extends Error {
  override name = 'CreatedButNotLinked';
  constructor(readonly person: Person) {
    super('A person was created but not linked');
  }
}

export interface Added {
  person: Person;
  warnings: ApiWarning[];
}

/**
 * The API links people with a second call (it has no "create a parent" or "create a partner" call). If the
 * link fails, the person just created is deleted again so nobody is left floating on the tree. If that
 * cleanup fails too, `CreatedButNotLinked` says so, and the screen offers a link to their profile.
 */
export async function createThenLink(
  input: PersonInput,
  link: (created: Person) => Promise<ApiWarning[]>,
): Promise<Added> {
  const created = await api.createPerson(input);
  try {
    const warnings = await link(created.person);
    return { person: created.person, warnings: [...created.warnings, ...warnings] };
  } catch (error) {
    try {
      await api.deletePerson(created.person.id, false);
    } catch {
      throw new CreatedButNotLinked(created.person);
    }
    throw error;
  }
}

export function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** The two parents' ids in the order they are linked, so the second call can name the shared relationship. */
export async function linkParents(
  childId: string,
  parentIds: readonly string[],
  unionId: string | null,
  kind: LinkKind = 'birth',
  link: PartialDateInput | null = null,
): Promise<ApiWarning[]> {
  const warnings: ApiWarning[] = [];
  for (const [index, parentId] of parentIds.entries()) {
    const base = { parentId, kind, ...(link ? { link } : {}) };
    const request = index > 0 && unionId ? { ...base, unionId } : base;
    warnings.push(...(await api.addParent(childId, request)).warnings);
  }
  return warnings;
}

export function newPartnerLink(focalId: string, union: Omit<UnionInput, 'partnerIds'>) {
  return async (partner: Person): Promise<ApiWarning[]> => {
    await api.createUnion({ ...union, partnerIds: sortedPair(focalId, partner.id) });
    return [];
  };
}
