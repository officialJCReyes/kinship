// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which archives to keep. Daily, weekly and monthly counts mean "the newest archive of each of the last N days (weeks, months)
// that have one". The newest archive and anything the caller protects are never deleted. Only files whose names are ours are
// ever listed, and so only they can be deleted; the safety copies keep the newest three of each kind.
import { lstatSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupSettings } from '@kinship/shared';
import { listBackups } from './archive.js';
import type { ListedBackup } from './archive.js';
import { localDay, localMonth, localWeek } from './schedule-time.js';

export const KEEP_SAFETY_COPIES = 3;

/** When an archive was made: from its name (UTC) when it has one, otherwise the file's own time. */
export function archiveTime(item: ListedBackup): Date {
  const match = /^kinship-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-(\d+))?\.tar\.enc$/.exec(item.name);
  if (!match) return item.modified;
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])),
  );
}

const suffix = (item: ListedBackup): number =>
  Number(/^kinship-\d{4}-\d{2}-\d{2}-\d{4}-(\d+)\.tar\.enc$/.exec(item.name)?.[1] ?? 1);

export interface RetentionPlan {
  keep: string[];
  remove: string[];
}

export function planRetention(
  items: readonly ListedBackup[],
  settings: BackupSettings,
  protect: readonly string[] = [],
): RetentionPlan {
  const keep = new Set<string>(protect);

  // The kinship-* archives (manual and scheduled share a name pattern), newest first.
  const archives = items
    .filter((i) => i.kind === 'manual')
    .sort((a, b) => archiveTime(b).getTime() - archiveTime(a).getTime() || suffix(b) - suffix(a));
  const newest = archives[0];
  if (newest) keep.add(newest.name);
  const groups = (key: (item: ListedBackup) => string, count: number) => {
    const seen = new Set<string>();
    for (const item of archives) {
      const k = key(item);
      if (seen.has(k)) continue;
      seen.add(k);
      if (seen.size <= count) keep.add(item.name);
    }
  };
  const zone = settings.timeZone;
  groups((i) => localDay(archiveTime(i), zone), settings.keepDaily);
  groups((i) => localWeek(archiveTime(i), zone), settings.keepWeekly);
  groups((i) => localMonth(archiveTime(i), zone), settings.keepMonthly);

  // The safety copies: the newest few of each kind, by when they were written.
  for (const kind of ['pre-upgrade', 'pre-restore'] as const) {
    items
      .filter((i) => i.kind === kind)
      .sort((a, b) => b.modified.getTime() - a.modified.getTime() || b.name.localeCompare(a.name))
      .slice(0, KEEP_SAFETY_COPIES)
      .forEach((i) => keep.add(i.name));
  }
  return {
    keep: items.filter((i) => keep.has(i.name)).map((i) => i.name),
    remove: items.filter((i) => !keep.has(i.name)).map((i) => i.name),
  };
}

/** Deletes what the plan says, and only regular files in the folder whose names are ours. Returns what was deleted. */
export function applyRetention(dir: string, settings: BackupSettings, protect: readonly string[] = []): RetentionPlan {
  const plan = planRetention(listBackups(dir), settings, protect);
  const removed: string[] = [];
  for (const name of plan.remove) {
    const path = join(dir, name);
    try {
      if (lstatSync(path).isFile()) {
        rmSync(path);
        removed.push(name);
      }
    } catch {
      /* already gone */
    }
  }
  return { keep: plan.keep, remove: removed };
}
