// SPDX-License-Identifier: AGPL-3.0-or-later
// Only fictional Hale-style data. Names get a random suffix so every test works with its own people.
import { randomBytes } from 'node:crypto';

export const ADMIN = {
  email: 'marcus@hale.example',
  displayName: 'Marcus Hale',
  givenName: 'Marcus',
  surname: 'Hale',
} as const;

export function password(): string {
  return process.env['E2E_PASSWORD'] ?? '';
}

/** Six random lowercase letters, to make a name nobody else in the test run has. */
export function uniq(): string {
  return Array.from(randomBytes(6), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
}

/** A surname like "Okafor-qwerty", unique to one test. */
export function surname(base = 'Okafor'): string {
  return `${base}-${uniq()}`;
}
