// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LineageView } from '@kinship/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api.js';
import { meKey } from '../auth.js';
import { peopleKey } from './queries.js';

/**
 * Changes which family this account's charts follow for an adopted person. It is the viewer's own setting:
 * nothing changes for anyone else. Every chart and list that depends on it is fetched again.
 */
export function useSetLineage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (lineageView: LineageView) => api.updateMe({ lineageView }),
    onSuccess: async (me) => {
      client.setQueryData(meKey, me);
      await client.invalidateQueries({ queryKey: peopleKey });
    },
  });
}
