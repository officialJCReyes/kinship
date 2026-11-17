// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What an admin should be told after the version changed: the sections of the bundled changelog they have not seen, a note when
// the database was migrated, the breaking-change instructions, and a notice when an older backup was restored.
import { LAST_UNTRACKED_VERSION, compareSemver, parseSemver, releasePageUrl, sectionsBetween } from '@kinship/shared';
import type { ChangelogSection, SafetyNoteCode, WhatsNewMigration, WhatsNewResponse } from '@kinship/shared';
import { SAFETY_NOTES } from '@kinship/shared';
import type { BundledDocs } from './docs.js';

export interface LogRow {
  event: 'migrate' | 'restore';
  from_schema: number | null;
  to_schema: number;
  from_version: string | null;
  to_version: string;
  safety_copy: string | null;
  safety_note: string | null;
  created_at: Date;
}

const MAX_SECTIONS = 30;

const safetyNote = (note: string | null): SafetyNoteCode | null =>
  note !== null && (SAFETY_NOTES as readonly string[]).includes(note) ? (note as SafetyNoteCode) : null;

export function computeWhatsNew(input: {
  running: string;
  lastSeenVersion: string | null;
  lastSeenAt: Date | null;
  log: LogRow[];
  docs: BundledDocs;
}): WhatsNewResponse {
  const { running, lastSeenVersion, lastSeenAt, log, docs } = input;
  const runningSemver = parseSemver(running);
  const releaseUrl = releasePageUrl(running);
  const none: WhatsNewResponse = {
    show: false,
    kind: 'none',
    from: lastSeenVersion,
    to: running,
    sections: [],
    migrations: [],
    checkNow: [],
    restore: null,
    releaseUrl,
  };
  if (!runningSemver) return none;

  // An account that predates tracking (null) is treated as having seen the last release that did not track it.
  const from = lastSeenVersion ?? LAST_UNTRACKED_VERSION;
  const fromSemver = parseSemver(from);
  if (!fromSemver) return none;
  const order = compareSemver(runningSemver, fromSemver);

  const newerThanSeen = (row: LogRow) => lastSeenAt === null || row.created_at > lastSeenAt;
  const restoreRow = [...log].reverse().find((row) => row.event === 'restore' && newerThanSeen(row)) ?? null;
  const restore = restoreRow
    ? {
        fromVersion: restoreRow.from_version,
        toVersion: restoreRow.to_version,
        at: restoreRow.created_at.toISOString(),
      }
    : null;
  const wentDown =
    order < 0 ||
    (restoreRow !== null &&
      restoreRow.from_version !== null &&
      (() => {
        const before = parseSemver(restoreRow.from_version);
        const after = parseSemver(restoreRow.to_version);
        return before !== null && after !== null && compareSemver(before, after) > 0;
      })());

  if (order > 0) {
    const sections: ChangelogSection[] = sectionsBetween(docs.changelog, from, running).slice(0, MAX_SECTIONS);
    const migrations: WhatsNewMigration[] = log
      .filter((row) => row.event === 'migrate' && row.safety_note !== 'fresh_install' && newerThanSeen(row))
      .map((row) => ({
        fromSchema: row.from_schema,
        toSchema: row.to_schema,
        safetyCopy: row.safety_copy,
        safetyNote: safetyNote(row.safety_note),
        at: row.created_at.toISOString(),
      }));
    const checkNow = sections
      .filter((section) => section.groups.some((g) => g.kind === 'breaking'))
      .map((section) => ({
        version: section.version,
        markdown:
          docs.upgrade.get(section.version) ??
          section.groups
            .filter((g) => g.kind === 'breaking')
            .map((g) => g.body)
            .join('\n\n'),
      }));
    return {
      show: true,
      kind: 'updated',
      from: lastSeenVersion,
      to: running,
      sections,
      migrations,
      checkNow,
      restore,
      releaseUrl,
    };
  }
  if (wentDown) {
    return { ...none, show: true, kind: 'down', from: restoreRow?.from_version ?? lastSeenVersion, restore };
  }
  return { ...none, restore: null };
}
