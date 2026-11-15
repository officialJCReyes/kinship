// SPDX-License-Identifier: AGPL-3.0-or-later
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
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
export function useFamilyAround(id: string | undefined) {
  return useQuery({
    queryKey: [...peopleKey, 'around', id],
    queryFn: ({ signal }) => api.fetchTree(id ?? '', { up: 1, down: 1, collateral: true }, signal),
    enabled: id !== undefined,
  });
}

export function useRefreshPeople() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: peopleKey });
}
