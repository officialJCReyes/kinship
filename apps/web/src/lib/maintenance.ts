// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The api answers 503 "maintenance" while an in-app restore has paused the site (ADR 0031). The first such answer, or the start
// of a restore from this page, is remembered here, and the whole app is replaced by the maintenance page until it is left.
import { useSyncExternalStore } from 'react';

let current = false;
const listeners = new Set<() => void>();

export function enterMaintenance(): void {
  if (current) return;
  current = true;
  for (const listener of listeners) listener();
}

export function leaveMaintenance(): void {
  if (!current) return;
  current = false;
  for (const listener of listeners) listener();
}

export function useMaintenance(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => false,
  );
}
