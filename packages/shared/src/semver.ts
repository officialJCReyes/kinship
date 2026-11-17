// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Semantic Versioning as KinShip uses it: MAJOR.MINOR.PATCH with an optional pre-release (-alpha.1, -rc.2). Build metadata
// (+...) is not used and is refused. The same rules as scripts/release-info.mjs, which the release pipeline uses; a test
// compares the two over a table so they cannot drift apart.

export interface Semver {
  version: string;
  major: number;
  minor: number;
  patch: number;
  /** The text after the hyphen ("rc.1"), or null for a stable release. */
  pre: string | null;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
const MAX_VERSION_LENGTH = 64;

/** Parses "1.2.3" or "1.2.3-rc.1"; null for anything else (and for text over 64 characters). */
export function parseSemver(text: unknown): Semver | null {
  if (typeof text !== 'string' || text.length > MAX_VERSION_LENGTH) return null;
  const match = SEMVER.exec(text);
  if (!match) return null;
  const [, major, minor, patch, pre] = match;
  const safe = (n: string | undefined) => Number(n);
  const parsed = { major: safe(major), minor: safe(minor), patch: safe(patch) };
  if (![parsed.major, parsed.minor, parsed.patch].every(Number.isSafeInteger)) return null;
  return { version: text, ...parsed, pre: pre ?? null };
}

/** "v1.2.3" to "1.2.3" when the rest is a version, else null. A release tag must look like this. */
export function versionFromTag(tag: unknown): string | null {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null;
  return parseSemver(tag.slice(1)) ? tag.slice(1) : null;
}

/** SemVer order: negative when a is older than b. A pre-release is older than its release. */
export function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  const left = a.pre.split('.');
  const right = b.pre.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    if (!xNumeric && x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Compares two version strings; null when either is not a version. */
export function compareVersionText(a: string, b: string): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  return left && right ? compareSemver(left, right) : null;
}
