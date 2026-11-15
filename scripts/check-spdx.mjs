// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fails if a source file has no "SPDX-License-Identifier: AGPL-3.0-or-later"
// line near the top. Checks every file git knows about (tracked, or new and not
// ignored), so a new file is caught before it is even committed.
// Exempt: Markdown, JSON, lockfiles, images, the LICENSE text and design/.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const NEEDS_HEADER = /\.(ts|tsx|mts|cts|js|mjs|cjs|sql|ya?ml|sh|css|html)$|(^|\/)(Dockerfile[^/]*|\.dockerignore)$/;
const EXEMPT = /^(design|node_modules)\//;
const HEADER = 'SPDX-License-Identifier: AGPL-3.0-or-later';

const listed = (...args) =>
  execFileSync('git', ['ls-files', '-z', ...args], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
const files = new Set([...listed(), ...listed('--others', '--exclude-standard')]);

const missing = [...files]
  .filter((file) => NEEDS_HEADER.test(file) && !EXEMPT.test(file) && basename(file) !== 'pnpm-lock.yaml')
  .filter((file) => {
    try {
      return !readFileSync(file, 'utf8').split('\n', 5).join('\n').includes(HEADER);
    } catch {
      return false; // deleted but still listed
    }
  })
  .sort();

if (missing.length > 0) {
  console.error(`Missing "${HEADER}" in the first lines of:\n${missing.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`SPDX headers present in all checked files.`);
