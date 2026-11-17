// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CHANGELOG.md and UPGRADE.md as bundled in the api image (so What's new works with no internet and always matches the running
// version). Reading them never fails: a missing or odd file gives less to show, never an error.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capNotes, parseChangelog, parseReleaseHeading } from '@kinship/shared';
import type { ChangelogSection } from '@kinship/shared';

const MAX_FILE_BYTES = 1024 * 1024;

export interface BundledDocs {
  changelog: ChangelogSection[];
  /** The "## <version>" sections of UPGRADE.md, by version. */
  upgrade: Map<string, string>;
}

/** The "## <version>" sections of UPGRADE.md ("## Unreleased (will become 0.2.0)" counts as 0.2.0), each shortened to the cap. */
export function parseUpgradeNotes(text: string): Map<string, string> {
  const notes = new Map<string, string>();
  let version: string | null = null;
  let lines: string[] = [];
  const close = () => {
    if (version !== null && !notes.has(version)) {
      const body = lines.join('\n').trim();
      if (body !== '') notes.set(version, capNotes(body));
    }
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^## /.test(line)) {
      close();
      version = parseReleaseHeading(line)?.version ?? null;
      lines = [];
    } else if (version !== null) {
      lines.push(line);
    }
  }
  close();
  return notes;
}

function readText(dirs: string[], name: string): string {
  for (const dir of dirs) {
    try {
      const text = readFileSync(join(dir, name));
      if (text.byteLength <= MAX_FILE_BYTES) return text.toString('utf8');
    } catch {
      /* try the next folder */
    }
  }
  return '';
}

/** Where the files are: next to package.json in the image (apps/api), or at the repository root in a checkout. */
export function defaultDocsDirs(): string[] {
  return [fileURLToPath(new URL('../../', import.meta.url)), fileURLToPath(new URL('../../../../', import.meta.url))];
}

export function loadBundledDocs(dirs: string[] = defaultDocsDirs()): BundledDocs {
  try {
    return {
      changelog: parseChangelog(readText(dirs, 'CHANGELOG.md')),
      upgrade: parseUpgradeNotes(readText(dirs, 'UPGRADE.md')),
    };
  } catch {
    return { changelog: [], upgrade: new Map() };
  }
}
