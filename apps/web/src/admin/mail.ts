// SPDX-License-Identifier: AGPL-3.0-or-later
import { useQuery } from '@tanstack/react-query';
import * as api from '../api.js';

export const mailKey = ['admin', 'mail'] as const;

/** How often the page asks for the result of a test it has just queued, and for how long (about 30 seconds in all). */
export const TEST_POLL_MS = 2000;
export const TEST_POLL_FOR_MS = 30_000;

/**
 * Admin → Storage & email: the email status. While `polling` is true it is asked again every 2 seconds, but only while the
 * page is visible (React Query does not run an interval in a hidden tab: `refetchIntervalInBackground` stays false).
 */
export function useMailStatus(enabled: boolean, polling: boolean) {
  return useQuery({
    queryKey: mailKey,
    queryFn: ({ signal }) => api.fetchMailStatus(signal),
    enabled,
    refetchInterval: polling ? TEST_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}
