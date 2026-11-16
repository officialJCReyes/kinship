// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse, UserSettings } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api.js';
import { meKey } from '../auth.js';
import { peopleKey } from '../people/queries.js';

/**
 * Saves some of the signed-in account's own settings. The change is applied at once (the page, the theme and the mirror
 * all follow the cached account, see App), the account's answer replaces it, and if the save fails the earlier values are
 * put back and the error is left on the mutation for the page to show. It changes nothing for any other account.
 * Changing the family also refreshes everything that depends on it.
 */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<UserSettings>) => api.updateMe(patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: meKey });
      const previous = client.getQueryData<MeResponse>(meKey);
      if (previous) client.setQueryData<MeResponse>(meKey, { ...previous, user: { ...previous.user, ...patch } });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) client.setQueryData(meKey, context.previous);
    },
    onSuccess: async (me, patch) => {
      client.setQueryData(meKey, me);
      if (patch.lineageView !== undefined) await client.invalidateQueries({ queryKey: peopleKey });
    },
  });
}
