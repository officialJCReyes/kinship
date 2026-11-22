// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A tiny runner for the api's own periodic jobs (no extra container): the backup schedule, the daily update check, and later
// the birthday reminders. One timer ticks every minute; each job decides for itself whether it is due, never runs twice at once,
// and an error in one job is logged and never reaches another. Jobs that must not run in two api containers at once take their
// own lock (the backup scheduler does; a duplicate update check is harmless).
export type JobLog = (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;

export interface Job {
  name: string;
  /** Called every tick; the job returns quickly when nothing is due. */
  run(now: Date): Promise<void>;
}

export interface JobRunner {
  register(job: Job): void;
  /** One tick, as if the clock said `now`. Resolves when every job that was due has finished. */
  tick(now?: Date): Promise<void>;
  start(): void;
  stop(): void;
  /** No job starts until `resume()`. One that is running is not interrupted: `idle()` waits for it. */
  pause(): void;
  resume(): void;
  /** Resolves true when no job is running, false when `timeoutMs` passed first. */
  idle(timeoutMs: number): Promise<boolean>;
}

export const TICK_MS = 60_000;
/** The first tick comes this long after start, so the api is serving before any job does work. */
export const START_DELAY_MS = 2 * 60_000;

export function createJobRunner(log: JobLog, options: { tickMs?: number; startDelayMs?: number } = {}): JobRunner {
  const jobs: Job[] = [];
  const running = new Set<string>();
  let paused = false;
  let first: NodeJS.Timeout | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function tick(now = new Date()): Promise<void> {
    if (paused) return;
    await Promise.all(
      jobs.map(async (job) => {
        if (running.has(job.name)) return;
        running.add(job.name);
        try {
          await job.run(now);
        } catch (error) {
          log('error', `the job "${job.name}" failed`, { reason: error instanceof Error ? error.name : 'unknown' });
        } finally {
          running.delete(job.name);
        }
      }),
    );
  }

  return {
    register(job) {
      if (jobs.some((j) => j.name === job.name)) throw new Error(`job "${job.name}" is already registered`);
      jobs.push(job);
    },
    tick,
    start() {
      first = setTimeout(() => {
        void tick();
        timer = setInterval(() => void tick(), options.tickMs ?? TICK_MS);
        timer.unref();
      }, options.startDelayMs ?? START_DELAY_MS);
      first.unref();
    },
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    async idle(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (running.size > 0) {
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return true;
    },
  };
}
