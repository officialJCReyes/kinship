// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQuery } from '@tanstack/react-query';
import * as api from '../api.js';
import { peopleKey } from '../people/queries.js';

/** How the second person is related to the first. Cached under 'people', so a lineage change refreshes it. */
export function useRelationship(a: string | null, b: string | null) {
  return useQuery({
    queryKey: [...peopleKey, 'relationship', a, b],
    queryFn: ({ signal }) => api.fetchRelationship(a ?? '', b ?? '', undefined, signal),
    enabled: a !== null && b !== null,
  });
}

/** The pairs the mockup offers as "Try:", on the fictional Hale sample family. Given name and surname each. */
export const EXAMPLE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['Marcus Hale', 'Naomi Brooks'],
  ['Leo Hale', 'Naomi Brooks'],
  ['Marcus Hale', 'Lucas Moreno'],
  ['Marcus Hale', 'Elise Hale'],
  ['Marcus Hale', 'Samuel Hale'],
  ['Marcus Hale', 'Ines Hale'],
  ['Marcus Hale', 'Gabriel Hale'],
  ['Marcus Hale', 'Tomas Navarro'],
  ['Marcus Hale', 'Raj Nair'],
  ['Priya Nair', 'Sofia Hale'],
  ['Leo Hale', 'Beatriz Navarro'],
  ['Daniel Hale', 'Lucia Ortiz'],
];

/**
 * The example pairs whose people are on this tree. A small tree is read in one call; on a larger one there are none
 * (these are for the sample family only), and nothing is shown.
 */
export function useExamplePairs() {
  const people = useQuery({
    queryKey: [...peopleKey, 'examples'],
    queryFn: ({ signal }) => api.listPeople({ limit: 100 }, signal),
    staleTime: 5 * 60_000,
  });
  if (!people.data || people.data.nextCursor != null) return [];
  const byName = new Map(people.data.items.map((person) => [`${person.givenName} ${person.surname}`, person]));
  return EXAMPLE_PAIRS.flatMap(([first, second]) => {
    const a = byName.get(first);
    const b = byName.get(second);
    return a && b ? [{ a, b }] : [];
  });
}
