// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LinkCreated } from '@kinship/shared';

/**
 * The address to hand over. The token is in the URL FRAGMENT (after the #): a browser never sends that to a server, so it
 * is in no access log and no Referer. The page that opens it removes it from the address bar at once.
 */
export function linkAddress(created: Pick<LinkCreated, 'kind' | 'token'>, origin = window.location.origin): string {
  return `${origin}/${created.kind === 'invite' ? 'invite' : 'reset'}#${created.token}`;
}
