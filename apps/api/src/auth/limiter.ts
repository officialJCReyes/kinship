// SPDX-License-Identifier: AGPL-3.0-or-later

export interface LimiterOptions {
  /** Failures allowed inside the window before further attempts are refused. */
  maxFailures: number;
  windowMs: number;
  now?: () => number;
  /** Safety cap on remembered keys, so attackers cannot grow memory without bound. */
  maxKeys?: number;
}

/**
 * Counts failures per key (an IP address, an email) in a sliding window. Held
 * in memory: it is reset when the API restarts, and it assumes one API
 * process, which is how KinShip is deployed.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(private readonly options: LimiterOptions) {
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /** Milliseconds to wait before this key may try again; 0 when it may try now. */
  retryAfterMs(key: string): number {
    const recent = this.recent(key);
    if (recent.length < this.options.maxFailures) return 0;
    const oldest = recent[0] ?? this.now();
    return Math.max(0, oldest + this.options.windowMs - this.now());
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

  /** Forget a key's failures (after a successful sign-in). */
  reset(key: string): void {
    this.failures.delete(key);
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
