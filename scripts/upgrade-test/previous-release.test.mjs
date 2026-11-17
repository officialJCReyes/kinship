// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { pickPreviousRelease } from './previous-release.mjs';

const list = (...tags) => tags.map((tagName) => ({ tagName }));
const alphas = list('v0.1.0-alpha.1', 'v0.1.0-alpha.2');

test('a pull request upgrades from the newest published release, a pre-release included', () => {
  assert.equal(pickPreviousRelease(alphas, { current: '0.1.0-alpha.2', onTag: false }), 'v0.1.0-alpha.2');
  assert.equal(pickPreviousRelease(alphas, { current: '0.2.0', onTag: false }), 'v0.1.0-alpha.2');
});

test('a tag run only looks at older releases', () => {
  assert.equal(pickPreviousRelease(alphas, { current: '0.1.0-alpha.2', onTag: true }), 'v0.1.0-alpha.1');
  assert.equal(pickPreviousRelease(alphas, { current: '0.2.0', onTag: true }), 'v0.1.0-alpha.2');
  assert.equal(pickPreviousRelease(alphas, { current: '0.1.0-alpha.1', onTag: true }), null);
});

test('a stable build prefers the newest older stable release', () => {
  const all = list('v0.2.0', 'v0.3.0-rc.1', 'v0.2.1', 'v0.1.0-alpha.2');
  assert.equal(pickPreviousRelease(all, { current: '0.3.0', onTag: true }), 'v0.2.1');
  assert.equal(pickPreviousRelease(all, { current: '0.3.0-rc.2', onTag: true }), 'v0.3.0-rc.1');
  assert.equal(pickPreviousRelease(all, { current: '0.3.0-rc.1', onTag: true }), 'v0.2.1');
});

test('no releases, or only odd tags, give nothing', () => {
  assert.equal(pickPreviousRelease([], { current: '0.2.0', onTag: false }), null);
  assert.equal(pickPreviousRelease(list('nightly', 'v1'), { current: '0.2.0', onTag: false }), null);
  assert.equal(pickPreviousRelease([{}, null], { current: '0.2.0', onTag: false }), null);
});
