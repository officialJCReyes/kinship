// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AuthUser } from '@kinship/shared';

/**
 * Applies an account's color scheme and theme to the page and rewrites the browser's mirror of them (the mirror is what
 * /theme-init.js reads before the first paint on the next load, login page included). The account is the source of
 * truth: call this whenever the account's settings are learned or saved. A no-op where the script is not loaded.
 */
export function applyTheme(settings: Pick<AuthUser, 'colorScheme' | 'theme'>): void {
  window.kinshipTheme?.apply({ colorScheme: settings.colorScheme, theme: settings.theme }, true);
}
