// SPDX-License-Identifier: AGPL-3.0-or-later
import { keepPreviousData, queryOptions, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LineageView } from '@kinship/shared';
import * as api from '../api.js';

/** Everything people-related is cached under 'people', so one call refreshes it all after a change. */
export const peopleKey = ['people'] as const;

export function usePeopleSearch(q: string) {
  return useInfiniteQuery({
    queryKey: [...peopleKey, 'list', q],
    queryFn: ({ signal, pageParam }) => api.listPeople({ q, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
  });
}

export function usePersonDetail(id: string | undefined) {
  return useQuery({
    queryKey: [...peopleKey, 'detail', id],
    queryFn: ({ signal }) => api.fetchPerson(id ?? '', signal),
    enabled: id !== undefined,
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
/** What a spouse's family view asks for (half-siblings and everybody else are then dropped). */
export const FAMILY_SHAPE = { up: 3, down: 1, collateral: true } as const;

export function chartQuery(id: string) {
  return queryOptions({
    queryKey: [...peopleKey, 'chart', id],
    queryFn: ({ signal }) => api.fetchTree(id, CHART_SHAPE, signal),
  });
}

/** A spouse's (or adopted person's) family view. `lineage` overrides the viewer's own setting for the whole view. */
export function familyQuery(id: string, lineage?: LineageView) {
  return queryOptions({
    queryKey: [...peopleKey, 'family', id, lineage ?? 'mine'],
    queryFn: ({ signal }) => api.fetchTree(id, { ...FAMILY_SHAPE, ...(lineage ? { lineage } : {}) }, signal),
  });
}
