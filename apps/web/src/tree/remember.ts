// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-viewer conveniences for the chart, kept in this browser only: the last person the chart was rooted on, whether the person
// panel is collapsed and whether the legend is open. The page works the same without them, and storage can be missing or blocked.
const ROOT_KEY = 'kinship.tree.root';
const PANEL_KEY = 'kinship.tree.panelCollapsed';
const LEGEND_KEY = 'kinship.tree.legendOpen';

export function rememberRoot(id: string): void {
  try {
    window.localStorage.setItem(ROOT_KEY, id);
  } catch {
    // storage unavailable: nothing to remember
  }
}

export function recallRoot(): string | null {
  try {
    return window.localStorage.getItem(ROOT_KEY);
  } catch {
    return null;
  }
}

export function recallPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPanelCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0');
  } catch {
    // storage unavailable: nothing to remember
  }
}

/**
 * Whether the chart's legend is open. It starts hidden; once the person opens or closes it, that choice holds for every chart, view
 * and family view (each of which draws its own legend) until they change it. Kept in memory as well, so that with storage blocked
 * the choice still holds for the rest of the visit.
 */
let legendOpen: boolean | null = null;

export function recallLegendOpen(): boolean {
  if (legendOpen !== null) return legendOpen;
  try {
    return window.localStorage.getItem(LEGEND_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberLegendOpen(open: boolean): void {
  legendOpen = open;
  try {
    window.localStorage.setItem(LEGEND_KEY, open ? '1' : '0');
  } catch {
    // storage unavailable: remembered for this visit only
  }
}

/** For tests: forget the in-memory choice (storage is cleared by the test itself). */
export function forgetLegendOpen(): void {
  legendOpen = null;
}
