// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Builds the two images the end-to-end stack runs, the way CI does, tagged :e2e.
//   pnpm --filter @kinship/e2e e2e:build-images
// Global setup runs this for you when an image is missing. CI builds them in a step of its own.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const only = process.argv[2]; // "api", "web" or nothing for both
const commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();

for (const name of ['api', 'web']) {
  if (only && only !== name) continue;
  const tag = `ghcr.io/officialjcreyes/kinship-${name}:e2e`;
  console.log(`Building ${tag}`);
  const result = spawnSync(
    'docker',
    ['build', '-f', `apps/${name}/Dockerfile`, '--build-arg', `GIT_COMMIT=${commit || 'e2e'}`, '-t', tag, '.'],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
