// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The release manifest: a small JSON file the release pipeline attaches to every GitHub release (scripts/release-info.mjs),
// and the update check reads. It comes from the internet, so it is read field by field and nothing is believed unchecked.
import { parseSemver } from './semver.js';

/** The most text kept for one release's notes or upgrade notes. */
export const MAX_NOTES_CHARS = 20_000;
/** The most bytes read of one manifest. */
export const MAX_MANIFEST_BYTES = 128 * 1024;

export interface ReleaseManifest {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  channel: 'stable' | 'prerelease';
  security: boolean;
  breaking: boolean;
  migration: boolean;
  upgradeFrom: string | null;
  /** Markdown. */
  notes: string;
  /** Markdown, when the release has upgrade notes. */
  upgradeNotes: string | null;
}

export type ParsedManifest = { ok: true; manifest: ReleaseManifest } | { ok: false; problems: string[] };

const KEYS = new Set([
  'version',
  'date',
  'channel',
  'security',
  'breaking',
  'migration',
  'upgradeFrom',
  'notes',
  'upgradeNotes',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Cuts text to the cap at a line end, and says so. */
export function capNotes(text: string, max = MAX_NOTES_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lineEnd = cut.lastIndexOf('\n');
  return `${(lineEnd > max / 2 ? cut.slice(0, lineEnd) : cut).trimEnd()}\n\n_(Shortened. Read the rest on the release page.)_`;
}

/**
 * Checks one parsed manifest. `tagVersion` is the version the release's tag names: a manifest for another version is refused,
 * and so is one whose channel contradicts GitHub's own pre-release flag (`githubPrerelease`; the stricter one wins, so a
 * release GitHub calls a pre-release is never offered as stable). Unknown fields are dropped without complaint; a wrong
 * type or a missing field is a problem. Over-long notes are shortened, not refused.
 */
export function parseReleaseManifest(
  input: unknown,
  options: { tagVersion: string; githubPrerelease: boolean },
): ParsedManifest {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, problems: ['the manifest is not an object'] };
  }
  const m = input as Record<string, unknown>;
  const version = parseSemver(m['version']);
  if (!version) problems.push('"version" is not a version');
  else if (version.version !== options.tagVersion) problems.push('"version" is not the version of the release tag');
  if (typeof m['date'] !== 'string' || !DATE.test(m['date']) || Number.isNaN(Date.parse(m['date']))) {
    problems.push('"date" is not YYYY-MM-DD');
  }
  if (m['channel'] !== 'stable' && m['channel'] !== 'prerelease')
    problems.push('"channel" is not stable or prerelease');
  for (const key of ['security', 'breaking', 'migration'] as const) {
    if (typeof m[key] !== 'boolean') problems.push(`"${key}" is not true or false`);
  }
  const from = m['upgradeFrom'];
  if (from !== null && from !== undefined && !parseSemver(from))
    problems.push('"upgradeFrom" is not null or a version');
  if (typeof m['notes'] !== 'string' || m['notes'].trim() === '') problems.push('"notes" is empty');
  const upgradeNotes = m['upgradeNotes'];
  if (upgradeNotes !== null && upgradeNotes !== undefined && typeof upgradeNotes !== 'string') {
    problems.push('"upgradeNotes" is not text or null');
  }
  if (problems.length > 0 || !version) return { ok: false, problems };

  const prerelease = version.pre !== null || options.githubPrerelease || m['channel'] === 'prerelease';
  return {
    ok: true,
    manifest: {
      version: version.version,
      date: m['date'] as string,
      channel: prerelease ? 'prerelease' : 'stable',
      security: m['security'] as boolean,
      breaking: m['breaking'] as boolean,
      migration: m['migration'] as boolean,
      upgradeFrom: typeof from === 'string' ? from : null,
      notes: capNotes(m['notes'] as string),
      upgradeNotes: typeof upgradeNotes === 'string' && upgradeNotes.trim() !== '' ? capNotes(upgradeNotes) : null,
    },
  };
}

/** The names of fields in an input that the contract does not know (for logs and tests). */
export function unknownManifestFields(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((key) => !KEYS.has(key));
}
