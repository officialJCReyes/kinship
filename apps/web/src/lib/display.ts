// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_DATE_FORMAT, DEFAULT_SURNAME_CHOICE } from '@kinship/shared';
import type { AuthUser, DateFormat, SurnameChoice } from '@kinship/shared';
import { useSyncExternalStore } from 'react';

/**
 * The signed-in account's display choices that change TEXT: how a date is shown and which surname shows. A tiny store
 * so plain functions (`formatDate`, `displayName`, the chart layout) can read them without every call site passing
 * them in. The app feeds it from `/api/auth/me`; signed out, it holds the defaults. (Color scheme and theme are not
 * here: they are attributes on <html>, see theme.ts.)
 */
export interface Display {
  dateFormat: DateFormat;
  surnameChoice: SurnameChoice;
}

export const DEFAULT_DISPLAY: Display = { dateFormat: DEFAULT_DATE_FORMAT, surnameChoice: DEFAULT_SURNAME_CHOICE };

let current: Display = DEFAULT_DISPLAY;
const listeners = new Set<() => void>();

export function getDisplay(): Display {
  return current;
}

/** Replaces the display choices. Subscribers are told only when something changed. */
export function setDisplay(next: Display): void {
  if (next.dateFormat === current.dateFormat && next.surnameChoice === current.surnameChoice) return;
  current = next;
  for (const listener of listeners) listener();
}

export function displayOf(user: Pick<AuthUser, 'dateFormat' | 'surnameChoice'> | null | undefined): Display {
  return user ? { dateFormat: user.dateFormat, surnameChoice: user.surnameChoice } : DEFAULT_DISPLAY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current display choices, re-rendering the component when they change. */
export function useDisplay(): Display {
  return useSyncExternalStore(subscribe, getDisplay, getDisplay);
}
