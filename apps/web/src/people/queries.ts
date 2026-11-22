// SPDX-License-Identifier: AGPL-3.0-or-later
import { keepPreviousData, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LineageView } from '@kinship/shared';
import { useDebounced } from '../lib/useDebounced.js';
import * as api from '../api.js';

/** Everything people-related is cached under 'people', so one call refreshes it all after a change. */
export const peopleKey = ['people'] as const;

/**
 * A name lookup for a combobox: the text is debounced, then the first `limit` matches are asked for (the same endpoint and
 * matching as the People page). `hasMore` says the list was cut, so a box can ask for a longer word.
 */
export function usePeopleLookup(
  text: string,
  { limit = 8, enabled = true }: { limit?: number; enabled?: boolean } = {},
) {
  const query = useDebounced(text.trim(), 200);
  const results = useQuery({
    queryKey: [...peopleKey, 'lookup', query, limit],
    queryFn: ({ signal }) => api.listPeople({ q: query, limit }, signal),
    enabled: enabled && query !== '',
  });
  return {
    query,
    items: results.data?.items ?? [],
    hasMore: results.data?.nextCursor != null,
    isFetching: results.isFetching,
  };
}

export function usePeopleSearch(q: string) {
  return useInfiniteQuery({
    queryKey: [...peopleKey, 'list', q],
    queryFn: ({ signal, pageParam }) => api.listPeople({ q, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function usePersonDetail(id: string | undefined, options: { quiet?: boolean } = {}) {
  return useQuery({
    queryKey: [...peopleKey, 'detail', id],
    queryFn: ({ signal }) => api.fetchPerson(id ?? '', signal),
    enabled: id !== undefined,
    // `quiet`: something decorative (the picture on the account button) that must never get in the way if it fails.
    ...(options.quiet ? { retry: false } : {}),
  });
}

/** Parents, partners, children and siblings, with names, in one request. */
export function useFamilyAround(id: string | undefined, lineage?: LineageView, enabled = true) {
  return useQuery({
    queryKey: [...peopleKey, 'around', id, lineage ?? 'mine'],
    queryFn: ({ signal }) =>
      api.fetchTree(id ?? '', { up: 1, down: 1, collateral: true, ...(lineage ? { lineage } : {}) }, signal),
    enabled: id !== undefined && enabled,
  });
}

export function useRefreshPeople() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: peopleKey });
}

/** What the Family tree chart asks for: three generations up, two down, and the other descendants of the top ancestors. */
export const CHART_SHAPE = { up: 3, down: 2, collateral: true } as const;
/** What the chart asks for while "Show aunts, uncles and cousins" is off (the default): no aunts, uncles or cousins (ADR 0027). */
export const CHART_SHAPE_SIBLINGS = { up: 3, down: 2, collateral: 'siblings' } as const;
/** What a spouse's family view asks for (half-siblings and everybody else are then dropped). */
export const FAMILY_SHAPE = { up: 3, down: 1, collateral: true } as const;

export function chartQuery(id: string, extended = false) {
  return queryOptions({
    queryKey: [...peopleKey, 'chart', id, extended ? 'extended' : 'siblings'],
    queryFn: ({ signal }) => api.fetchTree(id, extended ? CHART_SHAPE : CHART_SHAPE_SIBLINGS, signal),
    // Turning the setting on or off for the same person keeps the chart (and the settings panel over it) on screen until
    // the other chart has arrived; a different person shows "Loading" as it always did.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey.at(-2) === id ? previous : undefined),
  });
}

/**
 * Pedigree and Fan: the blood ancestors of a person, `gen` generations (the person is the first). `lineage=birth`
 * makes the walk follow birth parents whatever the viewer's own setting is (ADR 0026).
 */
export function ancestorsQuery(id: string, gen: number) {
  return queryOptions({
    queryKey: [...peopleKey, 'ancestors', id, gen],
    queryFn: ({ signal }) =>
      api.fetchTree(id, { up: gen - 1, down: 0, collateral: false, lineage: 'birth' as LineageView }, signal),
  });
}

/**
 * Descendants: everyone below a person, `gen` generations (the person is the first) and one more, so a card at the
 * limit can say how many children are below it. The viewer's own lineage view applies (ADR 0026).
 */
export function descendantsQuery(id: string, gen: number) {
  return queryOptions({
    queryKey: [...peopleKey, 'descendants', id, gen],
    queryFn: ({ signal }) => api.fetchTree(id, { up: 0, down: gen, collateral: false }, signal),
  });
}

/** A spouse's (or adopted person's) family view. `lineage` overrides the viewer's own setting for the whole view. */
export function familyQuery(id: string, lineage?: LineageView) {
  return queryOptions({
    queryKey: [...peopleKey, 'family', id, lineage ?? 'mine'],
    queryFn: ({ signal }) => api.fetchTree(id, { ...FAMILY_SHAPE, ...(lineage ? { lineage } : {}) }, signal),
  });
}
