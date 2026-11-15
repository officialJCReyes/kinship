// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, randomBytes } from 'node:crypto';

/** A random token with 256 bits of entropy, safe to put in a cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The one-time first-run setup token (192 bits). */
export function generateSetupToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * What is stored for a token: its SHA-256 as hex. The tokens are long random
 * values, so a fast hash is enough (there is nothing to brute-force), and the
 * database never holds anything that could be used as a cookie.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
