// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api.js';

/** The Users page list. It holds no link tokens: those live only in the dialog that shows them. */
export const accountsKey = ['admin', 'accounts'] as const;

export function useAccounts() {
  return useQuery({ queryKey: accountsKey, queryFn: ({ signal }) => api.fetchAccounts(signal) });
}

export function useRefreshAccounts() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: accountsKey });
}
