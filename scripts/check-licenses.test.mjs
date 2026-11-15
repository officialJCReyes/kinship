// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOWED, isAllowed } from './check-licenses.mjs';

test('accepts every license on the allow list', () => {
  for (const license of ALLOWED) assert.equal(isAllowed(license), true, license);
});

test('rejects licenses that are not on the list', () => {
  for (const license of [
    'GPL-2.0-only',
    'LGPL-3.0',
    'SSPL-1.0',
    'CC-BY-4.0',
    'Unlicense',
    'UNKNOWN',
    'BSD',
    '',
    'SEE LICENSE IN LICENSE',
  ]) {
    assert.equal(isAllowed(license), false, license);
  }
});

test('OR needs one allowed side, AND needs both', () => {
  assert.equal(isAllowed('(MIT OR GPL-3.0-only)'), true);
  assert.equal(isAllowed('GPL-3.0-only OR MIT'), true);
  assert.equal(isAllowed('GPL-2.0-only OR LGPL-3.0'), false);
  assert.equal(isAllowed('MIT AND Apache-2.0'), true);
  assert.equal(isAllowed('MIT AND GPL-3.0-only'), false);
  assert.equal(isAllowed('(MIT AND CC0-1.0) OR GPL-3.0-only'), true);
  assert.equal(isAllowed('MIT AND (GPL-3.0-only OR ISC)'), true);
});

test('rejects expressions with exceptions or broken syntax', () => {
  assert.equal(isAllowed('Apache-2.0 WITH LLVM-exception'), false);
  assert.equal(isAllowed('(MIT'), false);
  assert.equal(isAllowed('MIT OR'), false);
  assert.equal(isAllowed('MIT ISC'), false);
});
