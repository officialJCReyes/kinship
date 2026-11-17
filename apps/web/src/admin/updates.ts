// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQuery } from '@tanstack/react-query';
import * as api from '../api.js';

export const updatesKey = ['admin', 'updates'] as const;
export const whatsNewKey = ['updates', 'whats-new'] as const;

/** The update status. Quiet when it fails (the banner must never be an error on every Admin page). */
export function useUpdates(enabled: boolean) {
  return useQuery({
    queryKey: updatesKey,
    queryFn: ({ signal }) => api.fetchUpdates(signal),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
