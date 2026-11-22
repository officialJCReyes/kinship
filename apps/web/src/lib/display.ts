// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_NAME_DISPLAY,
  DEFAULT_SHOW_DECEASED_MARK,
  DEFAULT_WEEK_START,
} from '@kinship/shared';
import type { AuthUser, DateFormat, NameDisplay, WeekStart } from '@kinship/shared';
import { useSyncExternalStore } from 'react';

/**
 * The signed-in account's display choices that change TEXT: how a date is shown, how a married woman's name is written, and whether prefixes and suffixes show. A tiny store
 * so plain functions (`formatDate`, `displayName`, the chart layout) can read them without every call site passing
 * them in. The app feeds it from `/api/auth/me`; signed out, it holds the defaults. (Color scheme and theme are not
 * here: they are attributes on <html>, see theme.ts.)
 */
export interface Display extends NameDisplay {
  dateFormat: DateFormat;
  /** Show † after the name of someone who has died, on the chart's cards and wedges. */
  showDeceasedMark: boolean;
  /** The first day of the week in the date picker. It changes no text on the page, so it does not remount anything. */
  weekStart: WeekStart;
}

export const DEFAULT_DISPLAY: Display = {
  dateFormat: DEFAULT_DATE_FORMAT,
  ...DEFAULT_NAME_DISPLAY,
  showDeceasedMark: DEFAULT_SHOW_DECEASED_MARK,
  weekStart: DEFAULT_WEEK_START,
};

let current: Display = DEFAULT_DISPLAY;
const listeners = new Set<() => void>();

export function getDisplay(): Display {
  return current;
}

/** Replaces the display choices. Subscribers are told only when something changed. */
export function setDisplay(next: Display): void {
  if (
    next.dateFormat === current.dateFormat &&
    next.nameForm === current.nameForm &&
    next.showPrefix === current.showPrefix &&
    next.showSuffix === current.showSuffix &&
    next.showDeceasedMark === current.showDeceasedMark &&
    next.weekStart === current.weekStart
  ) {
    return;
  }
  current = next;
  for (const listener of listeners) listener();
}

export function displayOf(
  user:
    | Pick<AuthUser, 'dateFormat' | 'nameForm' | 'showPrefix' | 'showSuffix' | 'showDeceasedMark' | 'weekStart'>
    | null
    | undefined,
): Display {
  return user
    ? {
        dateFormat: user.dateFormat,
        nameForm: user.nameForm,
        showPrefix: user.showPrefix,
        showSuffix: user.showSuffix,
        showDeceasedMark: user.showDeceasedMark,
        weekStart: user.weekStart,
      }
    : DEFAULT_DISPLAY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current display choices, re-rendering the component when they change. */
export function useDisplay(): Display {
  return useSyncExternalStore(subscribe, getDisplay, getDisplay);
}
