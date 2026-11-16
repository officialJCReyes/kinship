// SPDX-License-Identifier: AGPL-3.0-or-later

// Injected by vite.config.ts at build time.
declare const __WEB_VERSION__: string;
declare const __WEB_COMMIT__: string;
declare const __WEB_BUILD_DATE__: string;

// public/theme-init.js (loaded in <head>, before the first paint).
interface Window {
  kinshipTheme?: {
    apply(settings: { colorScheme?: string; theme?: string }, persist?: boolean): void;
    current(): { colorScheme: string; theme: string };
  };
}
