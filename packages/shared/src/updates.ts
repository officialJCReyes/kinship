// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The update check, the "What's changing" and "What's new" popups (docs/decisions/0015). The api, the web app and the tests
// all import this file. Nothing here is secret. The rules that decide what a SuperAdmin sees (which releases are offered, when
// the banner shows, when the update steps are visible) are plain functions here, so the api and the web cannot disagree.
import { compareSemver, parseSemver } from './semver.js';
import type { ChangelogSection } from './changelog.js';
import { SAFETY_COPY_KEY } from './backup.js';

/** The one repository the check reads. Nothing else is ever contacted. */
export const GITHUB_REPO = 'officialJCReyes/kinship';
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`;
/** The page of one release, built from a version we have already validated (never from text in a response). */
export const releasePageUrl = (version: string): string => `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`;

// ---- the three switches (Admin > Updates > Settings) ----

export interface UpdateSettings {
  /** Check for new versions once a day (default on). */
  check: boolean;
  /** Also offer pre-releases (default off). */
  preReleases: boolean;
  /** Save a copy of the database before a database change (default on). */
  safetyCopy: boolean;
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { check: true, preReleases: false, safetyCopy: true };

/** The app_settings key of each switch. Only these keys are ever read or written by the Updates routes. */
export const UPDATE_SETTING_KEYS: { [K in keyof UpdateSettings]: string } = {
  check: 'updates.check',
  preReleases: 'updates.prereleases',
  safetyCopy: SAFETY_COPY_KEY,
};

export type ParsedUpdateSettings =
  | { ok: true; settings: Partial<UpdateSettings> }
  | { ok: false; code: 'invalid_request' | 'invalid_update_setting'; field: string };

/** Checks any non-empty subset of the three switches. Unknown keys and anything but true or false are refused, naming the field. */
export function parseUpdateSettings(input: unknown): ParsedUpdateSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'invalid_request', field: 'settings' };
  }
  const entries = Object.entries(input);
  if (entries.length === 0) return { ok: false, code: 'invalid_request', field: 'settings' };
  const settings: Record<string, boolean> = {};
  for (const [key, value] of entries) {
    if (!(key in UPDATE_SETTING_KEYS)) return { ok: false, code: 'invalid_request', field: key };
    if (typeof value !== 'boolean') return { ok: false, code: 'invalid_update_setting', field: key };
    settings[key] = value;
  }
  return { ok: true, settings: settings as Partial<UpdateSettings> };
}

// ---- what the check found ----

export const UPDATE_CHECK_STATUSES = ['never', 'ok', 'unchanged', 'offline', 'rate_limited', 'bad_response'] as const;
/** never: no attempt yet. ok / unchanged: it worked (unchanged = GitHub said 304). The rest are why the last attempt failed. */
export type UpdateCheckStatus = (typeof UPDATE_CHECK_STATUSES)[number];

/** One release as the check stores it. `details` is false when it has no readable manifest (flags are then unknown). */
export interface KnownRelease {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  channel: 'stable' | 'prerelease';
  security: boolean;
  breaking: boolean;
  migration: boolean;
  /** Markdown, from the manifest or (without one) GitHub's release text. */
  notes: string;
  upgradeNotes: string | null;
  details: boolean;
}

/** Every release newer than the one running, with the flags of all of them combined. */
export interface OfferedRange {
  /** The running version. */
  from: string;
  /** The newest offered version. */
  to: string;
  /** Newest first. */
  releases: KnownRelease[];
  security: boolean;
  breaking: boolean;
  migration: boolean;
  /** Some release has no readable manifest, so its flags are unknown. */
  unknownDetails: boolean;
}

/**
 * The releases to offer a SuperAdmin: every one newer than `running` (not only the latest), stable only unless `includePre`,
 * newest first, with the security, breaking and migration flags of all of them combined. Null when there is nothing newer.
 */
export function offeredRange(
  releases: readonly KnownRelease[],
  running: string,
  includePre: boolean,
): OfferedRange | null {
  const current = parseSemver(running);
  if (!current) return null;
  const seen = new Set<string>();
  const newer = releases
    .map((release) => ({ release, parsed: parseSemver(release.version) }))
    .filter((e): e is { release: KnownRelease; parsed: NonNullable<typeof e.parsed> } => {
      if (!e.parsed || seen.has(e.release.version)) return false;
      seen.add(e.release.version);
      if (compareSemver(e.parsed, current) <= 0) return false;
      return includePre || (e.parsed.pre === null && e.release.channel === 'stable');
    })
    .sort((a, b) => compareSemver(b.parsed, a.parsed))
    .map((e) => e.release);
  const newest = newer[0];
  if (!newest) return null;
  return {
    from: running,
    to: newest.version,
    releases: newer,
    security: newer.some((r) => r.security),
    breaking: newer.some((r) => r.breaking),
    migration: newer.some((r) => r.migration),
    unknownDetails: newer.some((r) => !r.details),
  };
}

/** Which banner line applies: the flags, or "unknown" when a release has no readable manifest. */
export function bannerLine(range: OfferedRange): 'both' | 'migration' | 'breaking' | 'unknown' | 'none' {
  if (range.migration && range.breaking) return 'both';
  if (range.migration) return 'migration';
  if (range.breaking) return 'breaking';
  return range.unknownDetails ? 'unknown' : 'none';
}

/** The banner shows until the SuperAdmin dismisses that version; a newer version shows it again. */
export function bannerVisible(range: OfferedRange | null, dismissedVersion: string | null): boolean {
  if (!range) return false;
  if (dismissedVersion === null) return true;
  const dismissed = parseSemver(dismissedVersion);
  const newest = parseSemver(range.to);
  return !dismissed || !newest || compareSemver(dismissed, newest) < 0;
}

// ---- the backup warning ----

export const BACKUP_FRESH_HOURS = 24;

/** The amber "Back up before you update" box shows when any release changes the database, breaks something or is unreadable. */
export const needsBackupWarning = (range: OfferedRange): boolean =>
  range.migration || range.breaking || range.unknownDetails;

export function backupIsFresh(lastBackupAt: string | null, now: Date): boolean {
  if (!lastBackupAt) return false;
  const at = Date.parse(lastBackupAt);
  return !Number.isNaN(at) && now.getTime() - at <= BACKUP_FRESH_HOURS * 3_600_000 && at <= now.getTime() + 60_000;
}

/**
 * Whether the "How to update" steps are shown. Without a warning they always are. With one they wait for a backup from the
 * last 24 hours or for the SuperAdmin's tick "I have a backup I can restore" for this version (a soft gate: the app cannot
 * stop anyone running Docker by hand, but the warning cannot be missed).
 */
export function updateStepsVisible(input: {
  range: OfferedRange;
  lastBackupAt: string | null;
  now: Date;
  ackVersion: string | null;
}): boolean {
  if (!needsBackupWarning(input.range)) return true;
  return backupIsFresh(input.lastBackupAt, input.now) || input.ackVersion === input.range.to;
}

// ---- API shapes ----

/** Why there is no safety copy for a database change (upgrade_log.safety_note). */
export const SAFETY_NOTES = ['off', 'fresh_install', 'skipped_no_bypassrls', 'break_glass'] as const;
export type SafetyNoteCode = (typeof SAFETY_NOTES)[number];

/** Response of GET /api/admin/updates (SuperAdmin). A GET never starts a check. */
export interface UpdatesResponse {
  running: {
    version: string;
    commit: string;
    buildDate: string;
    schema: number | null;
    /** The version the web container reported on the last request, or null when it sent none. */
    webVersion: string | null;
  };
  settings: UpdateSettings;
  check: {
    status: UpdateCheckStatus;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    nextCheckAt: string | null;
    /** The server sends its requests through HTTPS_PROXY. (The address itself is never shown.) */
    viaProxy: boolean;
  };
  /** Null when checking is off, nothing is newer, or no check has worked. */
  range: OfferedRange | null;
  dismissedVersion: string | null;
  backupAckVersion: string | null;
}

/** Body of POST /api/admin/updates/dismiss. */
export interface UpdateDismissRequest {
  version: string;
}

/** Body of POST /api/admin/updates/backup-ack: tick or untick "I have a backup I can restore" for one version. */
export interface UpdateBackupAckRequest {
  version: string;
  ack: boolean;
}

export interface WhatsNewMigration {
  fromSchema: number | null;
  toSchema: number;
  /** The safety copy's file name, when one was written. */
  safetyCopy: string | null;
  safetyNote: SafetyNoteCode | null;
  at: string;
}

/** Response of GET /api/updates/whats-new (any admin). */
export interface WhatsNewResponse {
  /** True when this admin has not yet seen the running version: the popup opens by itself. */
  show: boolean;
  /** updated: the version went up. down: it went down (a restore). none: nothing to say. */
  kind: 'updated' | 'down' | 'none';
  /** The version this admin last saw, or null (an account that predates tracking). */
  from: string | null;
  to: string;
  /** Newest first, from the CHANGELOG inside the image. */
  sections: ChangelogSection[];
  migrations: WhatsNewMigration[];
  /** Breaking-change instructions to do now (from the upgrade notes inside the image), newest first. */
  checkNow: { version: string; markdown: string }[];
  /** Set when an older backup was restored since the admin last signed in. */
  restore: { fromVersion: string | null; toVersion: string; at: string } | null;
  releaseUrl: string;
}

export const UPDATE_ERROR_CODES = [
  'invalid_update_setting',
  'update_check_busy',
  'updates_off',
  'version_mismatch',
  'invalid_version',
] as const;
export type UpdateErrorCode = (typeof UPDATE_ERROR_CODES)[number];

export const UPDATE_ROUTES = [
  { method: 'GET', path: '/api/admin/updates', access: 'superadmin' },
  { method: 'PATCH', path: '/api/admin/updates/settings', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/updates/check', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/updates/dismiss', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/updates/backup-ack', access: 'superadmin' },
  { method: 'GET', path: '/api/updates/whats-new', access: 'admin' },
  { method: 'POST', path: '/api/updates/whats-new/seen', access: 'admin' },
] as const;
