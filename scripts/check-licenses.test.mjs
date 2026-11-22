// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOWED, EXCEPTIONS, exceptionFor, isAllowed } from './check-licenses.mjs';

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

test('an exception covers only the exact package, license and scope', () => {
  const [exception] = EXCEPTIONS;
  assert.ok(exception);
  const row = { name: exception.name, license: exception.license, scope: exception.scope };
  assert.ok(exceptionFor(row));
  assert.equal(exceptionFor({ ...row, scope: 'production' }), undefined, 'not when shipped');
  assert.equal(exceptionFor({ ...row, license: 'GPL-3.0-only' }), undefined, 'not for another license');
  assert.equal(exceptionFor({ ...row, name: 'something-else' }), undefined, 'not for another package');
});

test('the exception license is not itself on the allow list', () => {
  for (const exception of EXCEPTIONS) assert.equal(isAllowed(exception.license), false, exception.license);
});

test('the libvips exception covers only the named libvips packages, with exactly their license', () => {
  const row = { name: '@img/sharp-libvips-linuxmusl-x64', license: 'LGPL-3.0-or-later', scope: 'production' };
  assert.ok(exceptionFor(row));
  assert.ok(exceptionFor({ ...row, name: '@img/sharp-libvips-darwin-arm64' }));
  assert.equal(exceptionFor({ ...row, license: 'LGPL-3.0-only' }), undefined, 'not for another license');
  assert.equal(exceptionFor({ ...row, license: 'GPL-3.0-or-later' }), undefined, 'not for the GPL');
  assert.equal(exceptionFor({ ...row, name: 'some-other-lgpl-package' }), undefined, 'not for another package');
  assert.equal(
    exceptionFor({ ...row, name: '@img/sharp-libvips-linux-mips' }),
    undefined,
    'not for an unlisted platform',
  );
  assert.equal(isAllowed('LGPL-3.0-or-later'), false, 'LGPL is still not on the allow list');
});
