// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQuery } from '@tanstack/react-query';
import * as api from '../api.js';

export const backupsKey = ['admin', 'backups'] as const;

/** The status and the list. While a backup or a test is running the page asks again every two seconds. */
export function useBackups(enabled: boolean) {
  return useQuery({
    queryKey: backupsKey,
    queryFn: ({ signal }) => api.fetchBackups(signal),
    enabled,
    refetchInterval: (query) => (query.state.data?.status.running ? 2000 : false),
  });
}
