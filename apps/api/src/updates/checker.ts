// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The daily update check (docs/decisions/0015). Reads GitHub's public release list for this one repository with a conditional
// request, reads the manifest of each release newer than the running version, and stores what it found in update_check. It
// sends nothing about the installation. With the switch off it sends nothing at all.
import {
  GITHUB_REPO,
  RELEASES_API_URL,
  capNotes,
  compareSemver,
  parseReleaseManifest,
  parseSemver,
  versionFromTag,
} from '@kinship/shared';
import type { KnownRelease, UpdateCheckStatus } from '@kinship/shared';
import { MAX_MANIFEST_BYTES } from '@kinship/shared';
import { createDb } from '../db.js';
import type { AnySchema } from '../db.js';
import type { DbConfig } from '../config.js';
import { ApiError } from '../errors.js';
import type { Job, JobLog } from '../jobs/runner.js';
import { FetchError, getLimited, githubHosts } from './http.js';
import type { HostCheck } from './http.js';
import { readUpdateSettings } from './settings.js';
import { readCheckState, writeCheckState } from './state.js';
import type { CheckState, StoredRelease } from './state.js';

const HOUR = 3_600_000;
const MAX_LIST_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const CHECK_DEADLINE_MS = 45_000;
/** How many releases newer than the running one are read and kept. */
export const MAX_RELEASES = 30;
/** Check now: at least this long between two, and at most this many attempts an hour (GitHub allows an anonymous caller 60). */
export const MANUAL_COOLDOWN_MS = 60_000;
export const MAX_ATTEMPTS_PER_HOUR = 10;

/** Where the check reads from. Only tests change it (to a local server); the real values are constants. */
export interface Transport {
  listUrl: string;
  manifestUrl: (version: string) => string;
  allowHost: HostCheck;
  fetch?: typeof fetch;
}

export const githubTransport: Transport = {
  listUrl: RELEASES_API_URL,
  manifestUrl: (version) => `https://github.com/${GITHUB_REPO}/releases/download/v${version}/release-manifest.json`,
  allowHost: githubHosts,
};

export interface CheckerDeps {
  db: DbConfig;
  /** The version that is running. */
  version: string;
  log: JobLog;
  viaProxy: boolean;
  transport?: Transport;
  now?: () => Date;
  random?: () => number;
  /** Run when a check finishes (tests). */
  onFinished?: (state: CheckState) => void;
}

export type CheckOutcome = { ran: false; reason: 'off' } | { ran: true; status: UpdateCheckStatus; state: CheckState };

interface GithubRelease {
  version: string;
  prerelease: boolean;
  updatedAt: string;
  publishedDate: string | null;
  body: string;
  hasManifest: boolean;
}

/** Reads the release list of GitHub's answer field by field; anything that is not the right shape is skipped. */
export function parseReleaseList(json: unknown): GithubRelease[] | null {
  if (!Array.isArray(json)) return null;
  const releases: GithubRelease[] = [];
  for (const item of json.slice(0, 100)) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (r['draft'] === true) continue;
    const version = versionFromTag(r['tag_name']);
    if (!version) continue;
    const updatedAt = typeof r['updated_at'] === 'string' ? r['updated_at'].slice(0, 40) : '';
    const published = typeof r['published_at'] === 'string' ? r['published_at'].slice(0, 10) : '';
    const assets = Array.isArray(r['assets']) ? r['assets'] : [];
    releases.push({
      version,
      prerelease: r['prerelease'] === true,
      updatedAt,
      publishedDate: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : null,
      body: typeof r['body'] === 'string' ? r['body'] : '',
      hasManifest: assets.some(
        (a) =>
          typeof a === 'object' && a !== null && (a as Record<string, unknown>)['name'] === 'release-manifest.json',
      ),
    });
  }
  return releases;
}

/** What the next attempt waits after `failures` failures in a row: 1, 2, 4, ... hours, never more than a day. */
export const backoffMs = (failures: number): number => Math.min(24, 2 ** Math.max(0, failures - 1)) * HOUR;

export function createUpdateChecker(deps: CheckerDeps) {
  const { log, version } = deps;
  const transport = deps.transport ?? githubTransport;
  const clock = () => deps.now?.() ?? new Date();
  const random = deps.random ?? Math.random;
  const running = parseSemver(version);
  let busy = false;
  /** When the job next looks at the database (null: not loaded yet). Moved by a settings change or a finished check. */
  let nextLook: Date | null = null;
  let lastManual = 0;
  const attempts: number[] = [];

  const openDb = () => createDb<AnySchema>(deps.db, deps.db.ownerUser, deps.db.ownerPassword, 1);

  /** The state that "never checked" and "checked for another version" both mean: no ETag is sent. */
  const etagFor = (state: CheckState): string | null => {
    const stored = state.etag;
    if (!stored) return null;
    const bar = stored.indexOf('|');
    return bar > 0 && stored.slice(0, bar) === version ? stored.slice(bar + 1) : null;
  };

  async function fetchManifest(release: GithubRelease, signal: AbortSignal): Promise<KnownRelease | null> {
    try {
      const got = await getLimited(transport.manifestUrl(release.version), {
        ...(transport.fetch ? { fetch: transport.fetch } : {}),
        allowHost: transport.allowHost,
        maxBytes: MAX_MANIFEST_BYTES,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal,
        headers: { Accept: 'application/json' },
      });
      const parsed = parseReleaseManifest(JSON.parse(got.body.toString('utf8')), {
        tagVersion: release.version,
        githubPrerelease: release.prerelease,
      });
      if (!parsed.ok) return null;
      const m = parsed.manifest;
      return {
        version: m.version,
        date: m.date,
        channel: m.channel,
        security: m.security,
        breaking: m.breaking,
        migration: m.migration,
        notes: m.notes,
        upgradeNotes: m.upgradeNotes,
        details: true,
      };
    } catch {
      return null;
    }
  }

  const withoutDetails = (release: GithubRelease, today: string): KnownRelease => ({
    version: release.version,
    date: release.publishedDate ?? today,
    channel: release.prerelease || parseSemver(release.version)?.pre ? 'prerelease' : 'stable',
    security: false,
    breaking: false,
    migration: false,
    notes: capNotes(release.body.trim() === '' ? '(This release has no notes.)' : release.body),
    upgradeNotes: null,
    details: false,
  });

  /** One check, now. Never throws for a network or parsing problem: that is recorded as the status. */
  async function perform(): Promise<CheckOutcome> {
    const db = openDb();
    try {
      const settings = await readUpdateSettings(db);
      if (!settings.check) return { ran: false, reason: 'off' };
      const now = clock();
      const before = await readCheckState(db);
      const deadline = AbortSignal.timeout(CHECK_DEADLINE_MS);
      const next: CheckState = { ...before, lastAttemptAt: now };
      const fail = (status: UpdateCheckStatus, waitSeconds?: number): CheckOutcome => {
        next.status = status;
        next.failures = before.failures + 1;
        const wait = Math.max(backoffMs(next.failures), (waitSeconds ?? 0) * 1000);
        next.nextCheckAt = new Date(now.getTime() + Math.min(wait, 24 * HOUR));
        return { ran: true, status, state: next };
      };
      let outcome: CheckOutcome;
      try {
        const etag = etagFor(before);
        const list = await getLimited(transport.listUrl, {
          ...(transport.fetch ? { fetch: transport.fetch } : {}),
          allowHost: transport.allowHost,
          maxBytes: MAX_LIST_BYTES,
          timeoutMs: REQUEST_TIMEOUT_MS,
          signal: deadline,
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(etag ? { 'If-None-Match': etag } : {}),
          },
        });
        const today = now.toISOString().slice(0, 10);
        let github: GithubRelease[] | null = null;
        if (list.status === 200) {
          try {
            github = parseReleaseList(JSON.parse(list.body.toString('utf8')));
          } catch {
            github = null;
          }
          if (github === null) {
            outcome = fail('bad_response');
            log('warn', 'update check: the release list could not be read', {});
            await writeCheckState(db, next);
            return outcome;
          }
        }
        const stored = new Map(before.releases.map((r) => [r.version, r]));
        const newer = (list.status === 200 ? (github ?? []) : before.releases.map(toGithub)).filter((r) => {
          const parsed = parseSemver(r.version);
          return parsed !== null && running !== null && compareSemver(parsed, running) > 0;
        });
        newer.sort((a, b) => compareSemver(parseSemver(b.version) as never, parseSemver(a.version) as never));
        const releases: StoredRelease[] = [];
        for (const release of newer.slice(0, MAX_RELEASES)) {
          const cached = stored.get(release.version);
          const fresh =
            cached && cached.githubUpdatedAt === release.updatedAt && (cached.details || !release.hasManifest);
          if (cached && fresh) {
            releases.push(cached);
            continue;
          }
          const made = release.hasManifest && !deadline.aborted ? await fetchManifest(release, deadline) : null;
          releases.push({
            ...(made ?? withoutDetails(release, today)),
            githubUpdatedAt: release.updatedAt,
            hasManifest: release.hasManifest,
          });
        }
        next.releases = releases;
        next.status = list.status === 304 ? 'unchanged' : 'ok';
        next.lastSuccessAt = now;
        next.failures = 0;
        if (list.status === 200 && list.etag) next.etag = `${version}|${list.etag.slice(0, 150)}`;
        const jitter = (random() * 4 - 2) * HOUR; // a day, give or take two hours, so installs do not all call at once
        next.nextCheckAt = new Date(now.getTime() + 24 * HOUR + jitter);
        outcome = { ran: true, status: next.status, state: next };
        log('info', 'update check finished', { status: next.status, newer: releases.length });
      } catch (error) {
        if (error instanceof FetchError) {
          const status: UpdateCheckStatus =
            error.failure === 'rate_limited'
              ? 'rate_limited'
              : error.failure === 'offline' || error.failure === 'timeout'
                ? 'offline'
                : 'bad_response';
          outcome = fail(status, error.retryAfterSeconds);
          // Quietly: an install with no internet is not an error.
          log(status === 'offline' ? 'info' : 'warn', 'update check did not work', { why: error.failure });
        } else {
          outcome = fail('bad_response');
          log('warn', 'update check did not work', { why: 'unexpected' });
        }
      }
      await writeCheckState(db, next);
      return outcome;
    } finally {
      await db.destroy();
    }
  }

  async function guarded(): Promise<CheckOutcome> {
    busy = true;
    try {
      const outcome = await perform();
      if (outcome.ran) {
        nextLook = outcome.state.nextCheckAt;
        deps.onFinished?.(outcome.state);
      }
      return outcome;
    } finally {
      busy = false;
    }
  }

  const job: Job = {
    name: 'updates',
    async run(now) {
      if (busy) return;
      if (nextLook === null) {
        const db = openDb();
        try {
          const state = await readCheckState(db);
          // Never checked: a first check a few minutes from now, not at the very start.
          nextLook = state.nextCheckAt ?? new Date(now.getTime() + (2 + random() * 8) * 60_000);
        } finally {
          await db.destroy();
        }
      }
      if (now < nextLook) return;
      const outcome = await guarded();
      // Switched off: look again in an hour, in case it was switched on.
      if (!outcome.ran) nextLook = new Date(now.getTime() + HOUR);
    },
  };

  return {
    job,
    get busy() {
      return busy;
    },
    /** A switch changed: look at the database again on the next tick. */
    settingsChanged() {
      nextLook = new Date(0);
    },
    /** The Check now button. Refuses when it is off, already running, or too soon after the last one. */
    async checkNow(): Promise<CheckOutcome> {
      const now = clock().getTime();
      const settings = await (async () => {
        const db = openDb();
        try {
          return await readUpdateSettings(db);
        } finally {
          await db.destroy();
        }
      })();
      if (!settings.check) throw new ApiError(409, 'updates_off');
      if (busy) throw new ApiError(409, 'update_check_busy');
      const recent = attempts.filter((t) => now - t < HOUR);
      const wait = Math.max(
        MANUAL_COOLDOWN_MS - (now - lastManual),
        recent.length >= MAX_ATTEMPTS_PER_HOUR ? (recent[0] ?? now) + HOUR - now : 0,
      );
      if (wait > 0) throw new ApiError(429, 'rate_limited', { retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) });
      lastManual = now;
      recent.push(now);
      attempts.splice(0, attempts.length, ...recent);
      return guarded();
    },
    viaProxy: deps.viaProxy,
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;

function toGithub(r: StoredRelease): GithubRelease {
  return {
    version: r.version,
    prerelease: r.channel === 'prerelease',
    updatedAt: r.githubUpdatedAt,
    publishedDate: r.date,
    body: r.notes,
    hasManifest: r.hasManifest ?? r.details,
  };
}
