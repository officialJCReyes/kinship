// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The last person the chart was rooted on, kept in this browser only (a per-viewer convenience: the page works
// the same without it, and storage can be missing or blocked).
const ROOT_KEY = 'kinship.tree.root';
const PANEL_KEY = 'kinship.tree.panelCollapsed';

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
