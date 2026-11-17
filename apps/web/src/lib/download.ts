// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Starts a browser download of an address on this site (a one-time ticket URL). It uses a link click, so the browser saves the
 * file as it arrives instead of this page holding a large file in memory. Tests replace this module.
 */
export function startDownload(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
