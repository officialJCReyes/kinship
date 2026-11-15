// SPDX-License-Identifier: AGPL-3.0-or-later
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/** The only password rule: a minimum length. Keep in sync with packages/shared (MIN_PASSWORD_LENGTH). */
export const MIN_PASSWORD_LENGTH = 12;
/** Upper bound so an absurdly long body cannot be used to burn CPU. */
export const MAX_PASSWORD_LENGTH = 1024;

/**
 * Argon2id (the library's default algorithm) with the OWASP minimum
 * parameters: 19 MiB of memory, 2 passes, 1 lane. The parameters are stored in
 * each hash, so they can be raised later; needsRehash() then upgrades a hash
 * the next time its owner signs in.
 */
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/** True when the password matches. A malformed stored hash counts as "no". */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash is not argon2id with the current parameters. */
export function needsRehash(storedHash: string): boolean {
  const match = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!match) return true;
  return (
    Number(match[1]) !== PARAMS.memoryCost ||
    Number(match[2]) !== PARAMS.timeCost ||
    Number(match[3]) !== PARAMS.parallelism
  );
}

let dummyHash: Promise<string> | undefined;

/**
 * A hash of a password nobody knows, with the current parameters. Sign-in
 * verifies against it when the email is unknown, so an unknown email and a
 * wrong password take the same time.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return dummyHash;
}
