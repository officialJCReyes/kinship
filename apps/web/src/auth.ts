// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MeResponse, SetupRequest } from '@kinship/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api.js';

export const setupStatusKey = ['setup', 'status'] as const;
export const meKey = ['auth', 'me'] as const;

/** Does this install still need its first-run setup? */
export function useSetupStatus() {
  return useQuery({ queryKey: setupStatusKey, queryFn: ({ signal }) => api.fetchSetupStatus(signal) });
}

/** The signed-in person (data is null when signed out). Only asks once setup is done. */
export function useSession(enabled: boolean) {
  return useQuery({
    queryKey: meKey,
    queryFn: ({ signal }) => api.fetchMe(signal),
    enabled,
    retry: false,
    // A change made in another browser or tab shows up as soon as this one is looked at again.
    refetchOnWindowFocus: 'always',
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.login,
    onSuccess: (me: MeResponse) => client.setQueryData(meKey, me),
  });
}

/** What "Create my tree" does: create the account, then (only when the switch was turned off) turn the update check off. */
export interface SetupRun {
  request: SetupRequest;
  checkUpdates: boolean;
}
export interface SetupResult {
  me: MeResponse;
  /** The update-settings call failed: the check stays on, and the finish screen says so. */
  updateError?: unknown;
}

export function useSetup() {
  const client = useQueryClient();
  const finish = (me: MeResponse) => {
    client.setQueryData(setupStatusKey, { needsSetup: false });
    client.setQueryData(meKey, me);
  };
  const mutation = useMutation({
    mutationFn: async ({ request, checkUpdates }: SetupRun): Promise<SetupResult> => {
      const me = await api.setup(request);
      if (checkUpdates) return { me };
      try {
        await api.updateUpdateSettings({ check: false });
        return { me };
      } catch (error) {
        return { me, updateError: error };
      }
    },
    // On a failure the page stays, so it can say so; "Continue" then calls finish.
    onSuccess: ({ me, updateError }) => {
      if (updateError === undefined) finish(me);
    },
  });
  return { mutation, finish };
}

/** Query keys that hold nothing private: setup status, who is signed in, and the public version/health. */
const KEPT_ON_SIGN_OUT = new Set(['setup', 'auth', 'api']);

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    // Whatever happened on the server, this browser stops showing a signed-in person, and drops anything
    // it fetched for them (people, photos, ... as those pages arrive).
    onSettled: () => {
      client.removeQueries({ predicate: (query) => !KEPT_ON_SIGN_OUT.has(String(query.queryKey[0])) });
      client.setQueryData(meKey, null);
    },
  });
}
