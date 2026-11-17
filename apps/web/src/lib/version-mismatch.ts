// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The api answers 503 version_mismatch when the web container and the api are on different versions (ADR 0015). The first such
// answer is remembered here, and the whole app is replaced by a full-page message until the page is reloaded.
import { useSyncExternalStore } from 'react';

export interface Mismatch {
  web: string;
  api: string;
}

let current: Mismatch | null = null;
const listeners = new Set<() => void>();

export function reportVersionMismatch(mismatch: Mismatch): void {
  if (current?.web === mismatch.web && current.api === mismatch.api) return;
  current = mismatch;
  for (const listener of listeners) listener();
}

export function clearVersionMismatch(): void {
  current = null;
  for (const listener of listeners) listener();
}

export function useVersionMismatch(): Mismatch | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
