// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FailureLimiter, GuardSet } from '../src/auth/limiter.js';

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

describe('FailureLimiter in block mode', () => {
  it('allows, then blocks with the time left in the window', () => {
    const { limiter, advance } = makeLimiter();
    expect(limiter.check('a')).toEqual({ action: 'allow' });
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure('a');
      advance(1_000);
    }
    expect(limiter.check('a')).toEqual({ action: 'block', retryAfterMs: 57_000 });
  });
});

describe('FailureLimiter in delay mode', () => {
  function makeDelay() {
    let time = 1_000_000;
    const limiter = new FailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      mode: 'delay',
      delay: { firstMs: 1_000, maxMs: 10_000 },
      now: () => time,
    });
    return { limiter, advance: (ms: number) => (time += ms) };
  }

  it('is free up to the limit, then doubles the wait up to the cap, and never blocks', () => {
    const { limiter } = makeDelay();
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      const verdict = limiter.check('a');
      expect(verdict.action).not.toBe('block');
      waits.push(verdict.action === 'delay' ? verdict.ms : 0);
      limiter.recordFailure('a');
    }
    expect(waits).toEqual([0, 0, 0, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
    for (let i = 0; i < 100; i++) limiter.recordFailure('a');
    expect(limiter.check('a')).toEqual({ action: 'delay', ms: 10_000 });
    expect(limiter.retryAfterMs('a')).toBe(0);
  });

  it('is free again once the failures leave the window', () => {
    const { limiter, advance } = makeDelay();
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');
    expect(limiter.check('a').action).toBe('delay');
    advance(60_001);
    expect(limiter.check('a')).toEqual({ action: 'allow' });
  });

  it('needs a delay curve', () => {
    expect(() => new FailureLimiter({ maxFailures: 1, windowMs: 1, mode: 'delay' })).toThrow();
  });

  it('does not grow without bound either', () => {
    const limiter = new FailureLimiter({
      maxFailures: 1,
      windowMs: 60_000,
      mode: 'delay',
      delay: { firstMs: 1, maxMs: 1 },
      maxKeys: 5,
    });
    for (let i = 0; i < 50; i++) limiter.recordFailure(`key-${i}`);
    expect(limiter.size).toBe(5);
  });
});

describe('GuardSet', () => {
  const block = () => new FailureLimiter({ maxFailures: 2, windowMs: 60_000 });
  const delay = () =>
    new FailureLimiter({ maxFailures: 2, windowMs: 60_000, mode: 'delay', delay: { firstMs: 500, maxMs: 4_000 } });

  it('allows when every limiter allows, and records a failure on each', () => {
    const pair = block();
    const account = delay();
    const guards = new GuardSet([
      { limiter: pair, key: 'ip|a' },
      { limiter: account, key: 'a' },
    ]);
    expect(guards.check()).toEqual({ action: 'allow' });
    guards.recordFailure();
    guards.recordFailure();
    expect(pair.check('ip|a').action).toBe('block');
    expect(account.check('a')).toEqual({ action: 'delay', ms: 500 });
  });

  it('lets a block win over a delay, and takes the longest delay otherwise', () => {
    const pair = block();
    const accountA = delay();
    const accountB = delay();
    for (let i = 0; i < 4; i++) accountB.recordFailure('a');
    accountA.recordFailure('a');
    accountA.recordFailure('a');
    expect(
      new GuardSet([
        { limiter: accountA, key: 'a' },
        { limiter: accountB, key: 'a' },
      ]).check(),
    ).toEqual({ action: 'delay', ms: 2_000 });
    pair.recordFailure('p');
    pair.recordFailure('p');
    expect(
      new GuardSet([
        { limiter: accountB, key: 'a' },
        { limiter: pair, key: 'p' },
      ]).check().action,
    ).toBe('block');
  });

  it('resets only the limiters it is asked to', () => {
    const pair = block();
    const account = delay();
    const guards = new GuardSet([
      { limiter: pair, key: 'p' },
      { limiter: account, key: 'a' },
    ]);
    guards.recordFailure();
    guards.recordFailure();
    guards.reset(pair);
    expect(pair.check('p')).toEqual({ action: 'allow' });
    expect(account.check('a').action).toBe('delay');
  });
});
