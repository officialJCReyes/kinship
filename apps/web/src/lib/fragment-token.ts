// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The secret in an invitation or set-password link is in the URL FRAGMENT (/invite#<token>), which a browser never sends
 * to a server. This reads it and removes it from the address bar at once (history.replaceState), so it cannot be copied
 * from the bar, bookmarked, shown in the history list or left in a screenshot. It is held in memory for the page's
 * lifetime only: never in storage, never logged, and sent only in the body of a POST.
 */
let held: { path: string; token: string } | null = null;

export function takeFragmentToken(): string {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw !== '') {
    let token = raw;
    try {
      token = decodeURIComponent(raw);
    } catch {
      // Not valid percent-encoding: keep it as it is; the server will say the link does not work.
    }
    held = { path: window.location.pathname, token };
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return held && held.path === window.location.pathname ? held.token : '';
}

/** Forget the token (the link was used, or turned out not to work). */
export function forgetFragmentToken(): void {
  held = null;
}
