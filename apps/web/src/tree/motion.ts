// SPDX-License-Identifier: AGPL-3.0-or-later

/** True when the device asks for no motion (and in environments with no way to ask, such as tests). */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
