// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Maintenance mode for an in-app restore (ADR 0031). While a restore runs the api answers 503 "maintenance" to everything but the
// health, version and maintenance checks, and it counts the requests that are already running so the restore can wait for them.
// The state lives in this process only: when the api restarts after a restore it starts idle, and what happened is read from
// state.json on the backups volume.
import type { LastRestore, MaintenancePhase, MaintenanceStatus } from '@kinship/shared';

export interface Maintenance {
  /** True from the moment a restore pauses the site until the process exits (or the restore gives up before it started). */
  active(): boolean;
  phase(): MaintenancePhase;
  set(phase: MaintenancePhase): void;
  /** What GET /api/maintenance says. No database, no secrets, no ids. */
  status(): MaintenanceStatus;
  /** A request starts; call the returned function when it ends (calling it twice is harmless). */
  begin(): () => void;
  /** Requests that began before the gate went up and have not ended. */
  inFlight(): number;
  /** Resolves true when no such request is left, false when `timeoutMs` passed first. */
  drain(timeoutMs: number): Promise<boolean>;
}

export function createMaintenance(options: {
  /** How the last restore ended, read from state.json. */
  lastRestore?: () => LastRestore | undefined;
  now?: () => Date;
}): Maintenance {
  const now = options.now ?? (() => new Date());
  let phase: MaintenancePhase = 'idle';
  let since: string | null = null;
  let count = 0;
  const waiting = new Set<() => void>();

  const maybeDrained = () => {
    if (count === 0) for (const done of [...waiting]) done();
  };

  return {
    active: () => phase !== 'idle',
    phase: () => phase,
    set(next) {
      if (next === phase) return;
      phase = next;
      since = next === 'idle' ? null : now().toISOString();
    },
    status() {
      const last = options.lastRestore?.();
      return { phase, since, ...(last ? { lastRestore: last } : {}) };
    },
    begin() {
      count += 1;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        count -= 1;
        maybeDrained();
      };
    },
    inFlight: () => count,
    drain(timeoutMs) {
      if (count === 0) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          waiting.delete(check);
          resolve(ok);
        };
        const check = () => finish(true);
        const timer = setTimeout(() => finish(count === 0), timeoutMs);
        waiting.add(check);
      });
    },
  };
}
