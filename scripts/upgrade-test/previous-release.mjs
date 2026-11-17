// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which published release the upgrade test starts from (scripts/upgrade-test.sh).
//
//   gh release list --exclude-drafts --json tagName | CURRENT_VERSION=0.2.0 ON_TAG=true node previous-release.mjs
//
// prints the tag (for example v0.1.0-alpha.2), or nothing and exit code 3 when there is no earlier release to upgrade from.
//   - On a tag run (ON_TAG=true) only releases older than the build are considered. A stable build prefers the highest older
//     stable release and falls back to the highest older release of any kind (the same rule the manifest uses).
//   - On a pull request or main (ON_TAG not true) the highest published release is used, whatever its kind: that is what an
//     installation running today would upgrade from. If it is the same version as the build, the test still runs; it just has
//     no database change to assert.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { compareVersions, parseTag, parseVersion } from '../release-info.mjs';

/** `releases` is the parsed JSON of `gh release list --json tagName`. Returns a tag or null. */
export function pickPreviousRelease(releases, { current, onTag }) {
  const currentVersion = parseVersion(current);
  const parsed = releases
    .map((r) => r?.tagName)
    .filter((t) => typeof t === 'string')
    .flatMap((tag) => {
      try {
        return [{ tag, version: parseTag(tag) }];
      } catch {
        return []; // a tag that is not a KinShip version is not a release
      }
    })
    .sort((a, b) => compareVersions(b.version, a.version));
  if (!onTag) return parsed[0]?.tag ?? null;
  const older = parsed.filter((e) => compareVersions(e.version, currentVersion) < 0);
  if (currentVersion.pre !== null) return older[0]?.tag ?? null;
  return (older.find((e) => e.version.pre === null) ?? older[0])?.tag ?? null;
}

function main() {
  const current = process.env.CURRENT_VERSION;
  if (!current) {
    console.error('CURRENT_VERSION is not set');
    process.exit(2);
  }
  const releases = JSON.parse(readFileSync(0, 'utf8'));
  const tag = pickPreviousRelease(releases, { current, onTag: process.env.ON_TAG === 'true' });
  if (tag === null) process.exit(3);
  console.log(tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
