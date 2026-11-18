// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The upgrade test's check that the What's new popup names a stable release (scripts/upgrade-test.sh).
//
//   echo "$whats_new_json" | node whats-new-lists.mjs <version>
//
// A stable release must have its own section in what the api answers (its section in CHANGELOG.md), or an admin would be told
// about a release without a word of what it contains. Exit 0 when it does, 1 when it does not, 2 for a missing version or JSON
// that is not what the api answers. The version is an argument, never an environment variable (a `VAR=value` written after a
// command is an argument to it, which once made this check fail on the first real release tag).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Returns { ok, message }. `text` is the body of GET /api/updates/whats-new. */
export function checkWhatsNewLists(version, text) {
  if (typeof version !== 'string' || version === '') return { ok: false, code: 2, message: 'no version given' };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: 2, message: "What's new did not answer with JSON" };
  }
  if (!data || !Array.isArray(data.sections))
    return { ok: false, code: 2, message: 'What\'s new has no "sections" list' };
  const versions = data.sections.map((section) => section?.version);
  if (!versions.includes(version)) {
    return {
      ok: false,
      code: 1,
      message: `What's new lists [${versions.join(', ')}] and not ${version}: the release has no section in the CHANGELOG`,
    };
  }
  return { ok: true, code: 0, message: `What's new lists ${version}` };
}

/** A stable version has no pre-release part ("0.2.0", not "0.2.0-rc.3"). */
export const isStableVersion = (version) => !version.includes('-');

function main() {
  const result = checkWhatsNewLists(process.argv[2], readFileSync(0, 'utf8'));
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
