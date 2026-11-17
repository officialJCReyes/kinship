// SPDX-License-Identifier: AGPL-3.0-or-later

/** A time as people read it, in the family's time zone (the same zone the schedule uses). */
export function formatInstant(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(iso),
    );
  } catch {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
      new Date(iso),
    );
  }
}

/** "33 KB", "4.2 MB", "1.3 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
