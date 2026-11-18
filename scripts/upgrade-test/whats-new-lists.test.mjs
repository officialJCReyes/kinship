// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkWhatsNewLists, isStableVersion } from './whats-new-lists.mjs';

const answer = (...versions) => JSON.stringify({ show: true, sections: versions.map((version) => ({ version })) });

test('a stable release passes when its section is listed, and fails when it is not', () => {
  assert.equal(checkWhatsNewLists('0.2.0', answer('0.2.0')).ok, true);
  assert.equal(checkWhatsNewLists('0.2.0', answer('0.2.0', '0.1.0-alpha.2')).ok, true);
  const missing = checkWhatsNewLists('0.2.0', answer('0.2.0-rc.3'));
  assert.deepEqual([missing.ok, missing.code], [false, 1]);
  assert.match(missing.message, /not 0\.2\.0/);
  assert.equal(checkWhatsNewLists('0.2.0', answer()).code, 1);
});

test("a missing version or an answer that is not What's new is a usage error, not a pass", () => {
  assert.equal(checkWhatsNewLists(undefined, answer('0.2.0')).code, 2);
  assert.equal(checkWhatsNewLists('', answer('0.2.0')).code, 2);
  assert.equal(checkWhatsNewLists('0.2.0', 'not json').code, 2);
  assert.equal(checkWhatsNewLists('0.2.0', '{}').code, 2);
});

test('a version with a pre-release part is not stable', () => {
  assert.equal(isStableVersion('0.2.0'), true);
  assert.equal(isStableVersion('0.2.0-rc.3'), false);
  assert.equal(isStableVersion('1.0.0-alpha.1'), false);
});

test('the command line takes the version as an argument and exits with the result', () => {
  const run = (args, input, env = {}) =>
    spawnSync(process.execPath, ['scripts/upgrade-test/whats-new-lists.mjs', ...args], {
      input,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
  assert.equal(run(['0.2.0'], answer('0.2.0')).status, 0);
  assert.equal(run(['0.2.0'], answer('0.2.0-rc.3')).status, 1);
  assert.equal(run([], answer('0.2.0')).status, 2, 'no version');
  // A version in the environment instead of the argument is not read.
  assert.equal(run([], answer('0.2.0'), { V: '0.2.0' }).status, 2);
});
