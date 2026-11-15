// SPDX-License-Identifier: AGPL-3.0-or-later
import { hash } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from '../src/auth/passwords.js';

describe('passwords', () => {
  it('hashes with argon2id and the OWASP minimum parameters, with a fresh salt each time', async () => {
    const one = await hashPassword('correct horse battery');
    const two = await hashPassword('correct horse battery');
    expect(one).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(one).not.toBe(two);
    expect(one).not.toContain('correct horse');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword(stored, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse batterz')).toBe(false);
    expect(await verifyPassword(stored, '')).toBe(false);
  });

  it('treats a malformed stored hash as a failed check, not a crash', async () => {
    expect(await verifyPassword('not a hash', 'whatever')).toBe(false);
    expect(await verifyPassword('', 'whatever')).toBe(false);
  });

  it('knows when a stored hash is weaker than the current settings', async () => {
    expect(needsRehash(await hashPassword('correct horse battery'))).toBe(false);
    expect(needsRehash(await hash('x', { memoryCost: 8192, timeCost: 1, parallelism: 1 }))).toBe(true);
    expect(needsRehash('$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).toBe(true);
    expect(needsRehash('plaintext')).toBe(true);
  });

  it('has a dummy hash with the same format that no real password matches', async () => {
    const dummy = await getDummyHash();
    expect(dummy).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(needsRehash(dummy)).toBe(false);
    expect(await verifyPassword(dummy, 'correct horse battery')).toBe(false);
    expect(await getDummyHash()).toBe(dummy); // made once
  });
});
