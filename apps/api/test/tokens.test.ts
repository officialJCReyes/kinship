// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateSessionToken, generateSetupToken, hashToken } from '../src/auth/tokens.js';

describe('tokens', () => {
  it('makes long, URL-safe, unique session tokens (256 bits)', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('makes a 192-bit setup token', () => {
    expect(generateSetupToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('stores SHA-256 hex, which differs from the token and is always the same for it', () => {
    const token = generateSessionToken();
    const stored = hashToken(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(stored).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashToken(token)).toBe(stored);
    expect(hashToken(`${token}x`)).not.toBe(stored);
  });
});
