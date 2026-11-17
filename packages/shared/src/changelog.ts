// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reads CHANGELOG.md (bundled in the api image) into sections the What's new popup shows. The file is hand-written today and
// written by release-please from 0.2, so the reader accepts several shapes and never fails: a heading it cannot read is skipped,
// a group it does not know is kept as written.
import { MAX_NOTES_CHARS, capNotes } from './release-manifest.js';
import { compareSemver, parseSemver } from './semver.js';

export const CHANGE_GROUPS = ['security', 'breaking', 'new', 'improved', 'fixed', 'other'] as const;
export type ChangeGroup = (typeof CHANGE_GROUPS)[number];

export interface ChangelogGroup {
  kind: ChangeGroup;
  /** The heading as written ("Features", "What 0.2.0 adds"); empty for text before the first heading. */
  title: string;
  /** Markdown. */
  body: string;
}

export interface ChangelogSection {
  version: string;
  /** YYYY-MM-DD or null. */
  date: string | null;
  groups: ChangelogGroup[];
}

/** Which of the five groups a heading belongs to; anything else is "other". Order matters: security and breaking win. */
export function groupKind(title: string): ChangeGroup {
  const t = title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
  if (/\bsecurity\b/.test(t)) return 'security';
  if (/\bbreaking\b/.test(t)) return 'breaking';
  if (/\b(does not include|not included|known|limitations?|planned)\b/.test(t)) return 'other';
  if (/\b(fixed|fixes|bug fix(es)?|bugs?)\b/.test(t)) return 'fixed';
  if (/\b(features?|added|adds|new)\b/.test(t)) return 'new';
  if (/\b(improved|improvements?|changed|changes|performance|updated)\b/.test(t)) return 'improved';
  return 'other';
}

const VERSION_IN_HEADING = /\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)\]?/;
const DATE_IN_HEADING = /(\d{4}-\d{2}-\d{2})/;

/** The version and date of a "## ..." heading, or null when it names no version ("## [Unreleased]"). */
export function parseReleaseHeading(line: string): { version: string; date: string | null } | null {
  if (!/^## /.test(line)) return null;
  // The link in "## [0.2.0](https://.../v0.1.0...v0.2.0)" must not be read as the version: look before it.
  const text = line.slice(3).replace(/\]\([^)]*\)/g, ']');
  const found = VERSION_IN_HEADING.exec(text);
  if (!found?.[1] || !parseSemver(found[1])) return null;
  const date = DATE_IN_HEADING.exec(text.slice((found.index ?? 0) + found[0].length))?.[1] ?? null;
  return { version: found[1], date };
}

/** Link reference definitions ("[0.2.0]: https://...") at the end of a section. */
const LINK_DEFINITION = /^\[[^\]]+\]:\s+\S+.*$/;

function parseGroups(lines: string[]): ChangelogGroup[] {
  const groups: ChangelogGroup[] = [];
  let title = '';
  let body: string[] = [];
  const flush = () => {
    const text = body.join('\n').trim();
    if (text !== '') groups.push({ kind: title === '' ? 'other' : groupKind(title), title, body: text });
  };
  for (const line of lines) {
    const heading = /^### +(.*\S)\s*$/.exec(line);
    if (heading) {
      flush();
      title = (heading[1] ?? '').trim();
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return groups;
}

/** Every release section of the file, in file order. A text that is not a changelog gives an empty list. */
export function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let current: { version: string; date: string | null; lines: string[] } | null = null;
  const close = () => {
    if (!current) return;
    const body = [...current.lines];
    while (
      body.length > 0 &&
      (body[body.length - 1]?.trim() === '' || LINK_DEFINITION.test(body[body.length - 1] ?? ''))
    ) {
      body.pop();
    }
    const groups = parseGroups(body)
      .filter((g) => !LINK_DEFINITION.test(g.body))
      .map((g) => ({ ...g, body: capNotes(g.body, MAX_NOTES_CHARS) }));
    sections.push({ version: current.version, date: current.date, groups });
  };
  for (const line of lines) {
    if (/^## /.test(line)) {
      close();
      const heading = parseReleaseHeading(line);
      current = heading ? { ...heading, lines: [] } : null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  close();
  return sections;
}

/**
 * The sections an admin who last saw `after` (null: nothing is known; the caller passes the floor) and now runs `upTo` should
 * read: newer than `after`, up to and including `upTo`, newest first. A pre-release section is left out when the stable
 * release it leads to is in the list too. Duplicate versions keep the first.
 */
export function sectionsBetween(sections: ChangelogSection[], after: string, upTo: string): ChangelogSection[] {
  const low = parseSemver(after);
  const high = parseSemver(upTo);
  if (!low || !high) return [];
  const seen = new Set<string>();
  const inRange = sections
    .map((section) => ({ section, parsed: parseSemver(section.version) }))
    .filter((e): e is { section: ChangelogSection; parsed: NonNullable<typeof e.parsed> } => {
      if (!e.parsed || seen.has(e.section.version)) return false;
      seen.add(e.section.version);
      return compareSemver(e.parsed, low) > 0 && compareSemver(e.parsed, high) <= 0;
    });
  const stable = new Set(
    inRange.filter((e) => e.parsed.pre === null).map((e) => `${e.parsed.major}.${e.parsed.minor}.${e.parsed.patch}`),
  );
  return inRange
    .filter((e) => e.parsed.pre === null || !stable.has(`${e.parsed.major}.${e.parsed.minor}.${e.parsed.patch}`))
    .sort((a, b) => compareSemver(b.parsed, a.parsed))
    .map((e) => e.section);
}

/** The release before which no account tracked what it had seen (alpha.2 was the last such release). */
export const LAST_UNTRACKED_VERSION = '0.1.0-alpha.2';
