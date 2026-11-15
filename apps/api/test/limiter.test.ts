// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FailureLimiter } from '../src/auth/limiter.js';

function makeLimiter(extra: { maxKeys?: number } = {}) {
  let time = 1_000_000;
  const limiter = new FailureLimiter({ maxFailures: 3, windowMs: 60_000, now: () => time, ...extra });
  return { limiter, advance: (ms: number) => (time += ms) };
}

describe('FailureLimiter', () => {
  it('allows attempts until the failure limit, then says how long to wait', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfterMs('a')).toBe(0);
      limiter.recordFailure('a');
      advance(1_000);
    }
    expect(limiter.retryAfterMs('a')).toBe(57_000); // first failure was 3 s ago in a 60 s window
  });

  it('forgets failures once they leave the window', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 3; i++) limiter.recordFailure('a');
    expect(limiter.retryAfterMs('a')).toBeGreaterThan(0);
    advance(60_001);
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('keeps keys apart, and reset clears one', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 3; i++) limiter.recordFailure('a');
    expect(limiter.retryAfterMs('b')).toBe(0);
    limiter.reset('a');
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('does not grow without bound', () => {
    const { limiter } = makeLimiter({ maxKeys: 5 });
    for (let i = 0; i < 50; i++) limiter.recordFailure(`key-${i}`);
    // The oldest keys were dropped to stay within the cap; the newest is still tracked.
    for (let i = 0; i < 2; i++) limiter.recordFailure('key-49');
    expect(limiter.retryAfterMs('key-49')).toBeGreaterThan(0);
    expect(limiter.retryAfterMs('key-0')).toBe(0);
  });
});
