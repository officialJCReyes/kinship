// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';

export interface VersionInfo {
  name: 'kinship-api';
  version: string;
  commit: string;
}

/** The version comes from apps/api/package.json (one level above src/ and dist/). */
export function readVersion(gitCommit: string): VersionInfo {
  const packageJson = new URL('../package.json', import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(packageJson, 'utf8'));
  const version =
    typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string'
      ? parsed.version
      : undefined;
  if (version === undefined) throw new Error('apps/api/package.json has no version');
  return { name: 'kinship-api', version, commit: gitCommit };
}
