// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Failure limiters (ADR 0003, amended by ADR 0042). Each counts failures per key (an address, an account, an
// address and account pair, a session) in a sliding window, in one of two modes:
//   - block: past maxFailures, the key is refused until its oldest failure leaves the window;
//   - delay: never refused; past maxFailures, each attempt waits first, doubling from delay.firstMs up to
//     delay.maxMs. Used where blocking would let an attacker lock the real owner out.
// Held in memory: a restart of the API forgets everything, and one API process is assumed, which is how
// KinShip is deployed.

export interface DelayCurve {
  /** The wait once the count reaches maxFailures. */
  firstMs: number;
  /** The longest wait, however many failures there are. */
  maxMs: number;
}

export interface LimiterOptions {
  /** Failures allowed inside the window before the key is blocked (block) or slowed down (delay). */
  maxFailures: number;
  windowMs: number;
  /** Block (the default) or slow down past the limit. */
  mode?: 'block' | 'delay';
  /** The delay curve, for mode 'delay'. */
  delay?: DelayCurve;
  now?: () => number;
  /** Safety cap on remembered keys, so attackers cannot grow memory without bound. */
  maxKeys?: number;
}

/** What to do with one attempt. */
export type Verdict = { action: 'allow' } | { action: 'delay'; ms: number } | { action: 'block'; retryAfterMs: number };

const ALLOW: Verdict = { action: 'allow' };

export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxKeys: number;
  readonly mode: 'block' | 'delay';

  constructor(private readonly options: LimiterOptions) {
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.mode = options.mode ?? 'block';
    if (this.mode === 'delay' && !options.delay) throw new Error('a delay limiter needs a delay curve');
  }

  /** What to do with the next attempt for this key. */
  check(key: string): Verdict {
    const recent = this.recent(key);
    if (recent.length < this.options.maxFailures) return ALLOW;
    if (this.mode === 'block') {
      const oldest = recent[0] ?? this.now();
      return { action: 'block', retryAfterMs: Math.max(0, oldest + this.options.windowMs - this.now()) };
    }
    const curve = this.options.delay!;
    const doublings = Math.min(recent.length - this.options.maxFailures, 30);
    return { action: 'delay', ms: Math.min(curve.maxMs, curve.firstMs * 2 ** doublings) };
  }

  /** Milliseconds to wait before this key may try again; 0 when it may try now. Delay limiters never refuse. */
  retryAfterMs(key: string): number {
    const verdict = this.check(key);
    return verdict.action === 'block' ? verdict.retryAfterMs : 0;
  }

  recordFailure(key: string): void {
    const recent = this.recent(key);
    recent.push(this.now());
    if (!this.failures.has(key) && this.failures.size >= this.maxKeys) {
      this.prune();
      if (this.failures.size >= this.maxKeys) {
        const oldestKey = this.failures.keys().next().value;
        if (oldestKey !== undefined) this.failures.delete(oldestKey);
      }
    }
    this.failures.set(key, recent);
  }

  /** Forget a key's failures (after a success). */
  reset(key: string): void {
    this.failures.delete(key);
  }

  /** How many keys are remembered (tests). */
  get size(): number {
    return this.failures.size;
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.options.windowMs;
    return (this.failures.get(key) ?? []).filter((time) => time > cutoff);
  }

  private prune(): void {
    for (const key of [...this.failures.keys()]) {
      const recent = this.recent(key);
      if (recent.length === 0) this.failures.delete(key);
      else this.failures.set(key, recent);
    }
  }
}

/** One limiter and the key it counts for this attempt. */
export interface Guard {
  limiter: FailureLimiter;
  key: string;
}

/**
 * The limiters that apply to one attempt (for example the address and account pair, the address, the account).
 * Any block wins, with the longest wait; otherwise the longest delay; otherwise allow.
 */
export class GuardSet {
  constructor(private readonly guards: Guard[]) {}

  check(): Verdict {
    let block = -1;
    let delay = 0;
    for (const { limiter, key } of this.guards) {
      const verdict = limiter.check(key);
      if (verdict.action === 'block') block = Math.max(block, verdict.retryAfterMs);
      else if (verdict.action === 'delay') delay = Math.max(delay, verdict.ms);
    }
    if (block >= 0) return { action: 'block', retryAfterMs: block };
    return delay > 0 ? { action: 'delay', ms: delay } : ALLOW;
  }

  recordFailure(): void {
    for (const { limiter, key } of this.guards) limiter.recordFailure(key);
  }

  /** Forget the failures of the given limiters only (a success clears some counts, not all). */
  reset(...limiters: FailureLimiter[]): void {
    for (const { limiter, key } of this.guards) if (limiters.includes(limiter)) limiter.reset(key);
  }
}
