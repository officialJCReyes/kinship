// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Built-in backups (docs/decisions/0014): the settings a SuperAdmin edits, the history the api keeps, and the status the Admin
// page shows. The api, the web app and the tests all import this file. Nothing here is secret: the passphrase lives in .env.

/** The kinds of file in the backups folder. */
export const BACKUP_KINDS = ['manual', 'scheduled', 'pre-upgrade', 'pre-restore'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export const BACKUP_SCHEDULES = ['daily', 'weekly', 'off'] as const;
export type BackupSchedule = (typeof BACKUP_SCHEDULES)[number];

/** What a SuperAdmin chooses. Stored in app_settings (not secret) under the keys in BACKUP_SETTING_KEYS. */
export interface BackupSettings {
  schedule: BackupSchedule;
  /** Local time of day in `timeZone`, "HH:MM". */
  time: string;
  /** For a weekly schedule: 0 is Sunday ... 6 is Saturday. */
  weekday: number;
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  includeFiles: boolean;
  testAfterBackup: boolean;
  /** An IANA time zone, for the schedule and for how times are shown. */
  timeZone: string;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  schedule: 'daily',
  time: '03:00',
  weekday: 0,
  keepDaily: 7,
  keepWeekly: 4,
  keepMonthly: 6,
  includeFiles: true,
  testAfterBackup: true,
  timeZone: 'UTC',
};

/** The app_settings key of each backup setting. Only these keys (and SAFETY_COPY_KEY) are ever read or written. */
export const BACKUP_SETTING_KEYS: { [K in keyof BackupSettings]: string } = {
  schedule: 'backup.schedule',
  time: 'backup.time',
  weekday: 'backup.weekday',
  keepDaily: 'backup.keep_daily',
  keepWeekly: 'backup.keep_weekly',
  keepMonthly: 'backup.keep_monthly',
  includeFiles: 'backup.include_files',
  testAfterBackup: 'backup.test_after',
  timeZone: 'time_zone',
};

/** The safety copy before a database change (on by default). Its switch is in Admin > Updates (step 17). */
export const SAFETY_COPY_KEY = 'safety_copy';

export type BackupSettingErrorCode = 'invalid_backup_setting' | 'invalid_request';

export type ParsedBackupSettings =
  { ok: true; settings: Partial<BackupSettings> } | { ok: false; code: BackupSettingErrorCode; field: string };

function validTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** Is this value allowed for this setting? */
export function backupSettingValueOk<K extends keyof BackupSettings>(key: K, value: unknown): boolean {
  switch (key) {
    case 'schedule':
      return typeof value === 'string' && (BACKUP_SCHEDULES as readonly string[]).includes(value);
    case 'time':
      return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    case 'weekday':
      return integer(value, 0, 6);
    case 'keepDaily':
      return integer(value, 1, 365);
    case 'keepWeekly':
      return integer(value, 0, 104);
    case 'keepMonthly':
      return integer(value, 0, 240);
    case 'includeFiles':
    case 'testAfterBackup':
      return typeof value === 'boolean';
    case 'timeZone':
      return typeof value === 'string' && validTimeZone(value);
    default:
      return false;
  }
}

/** Checks any non-empty subset of the backup settings. Unknown keys and values off their lists are refused, naming the field. */
export function parseBackupSettings(input: unknown): ParsedBackupSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'invalid_request', field: 'settings' };
  }
  const entries = Object.entries(input);
  if (entries.length === 0) return { ok: false, code: 'invalid_request', field: 'settings' };
  const settings: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!(key in BACKUP_SETTING_KEYS)) return { ok: false, code: 'invalid_request', field: key };
    if (!backupSettingValueOk(key as keyof BackupSettings, value)) {
      return { ok: false, code: 'invalid_backup_setting', field: key };
    }
    settings[key] = value;
  }
  return { ok: true, settings: settings as Partial<BackupSettings> };
}

// ---- the history the api keeps in state.json on the backups volume ----

export interface BackupRunRecord {
  id: string;
  kind: BackupKind;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  /** The archive's file name, when one was written. */
  file?: string;
  bytes?: number;
  /** What went wrong, in words that never contain a secret. */
  error?: string;
  errorKind?: string;
}

export interface BackupTestRecord {
  at: string;
  file: string;
  ok: boolean;
  mode: 'restore' | 'archive-only';
  tables: number;
  rows: number;
  /** The names of the checks that failed. */
  failed?: string[];
  note?: string;
}

/**
 * How an in-app restore ended. `started`: written before anything else, so an api that starts and finds one with nothing after
 * it knows the restore was cut short. `unchanged`: it failed and the data is exactly as it was. `restored`: done.
 * `restored_not_migrated`: the backup was put back but a newer database change failed afterwards (the data is valid, at the
 * backup's older schema). `did_not_finish`: written by the next start for a `started` that never ended; the data is unchanged.
 */
export const RESTORE_RESULT_KINDS = [
  'started',
  'unchanged',
  'restored',
  'restored_not_migrated',
  'did_not_finish',
] as const;
export type RestoreResultKind = (typeof RESTORE_RESULT_KINDS)[number];

export interface RestoreRecord {
  id: string;
  startedAt: string;
  finishedAt?: string;
  /** Set when it ended: true only for `restored`. */
  ok?: boolean;
  kind: RestoreResultKind;
  /** The listed archive that was restored (a generated file name). */
  backup: string;
  /** The generated name of the safety copy of what was there before, when one was made. */
  safetyCopy?: string;
  /** A short code for why it failed (never a message: those can hold paths). */
  errorKind?: string;
  /** The uuid of the SuperAdmin who asked. After the restore this account may no longer exist. */
  byUserId: string;
}

export interface BackupState {
  version: 1;
  /** Newest first, at most 50. */
  runs: BackupRunRecord[];
  lastTest: BackupTestRecord | null;
  /** Newest first, at most 20. */
  restores: RestoreRecord[];
}

export const EMPTY_BACKUP_STATE: BackupState = { version: 1, runs: [], lastTest: null, restores: [] };

/** When the last backup (manual or scheduled) finished successfully, or null. The update warning in step 17 reads this. */
export function lastSuccessfulBackupAt(state: BackupState): string | null {
  const run = state.runs.find((r) => r.ok && (r.kind === 'manual' || r.kind === 'scheduled'));
  return run ? run.finishedAt : null;
}

// ---- the status the Admin page shows ----

export type PassphraseState = 'ok' | 'missing' | 'too_short' | 'placeholder';

/** Why the page should show something red or amber. Each is a translation key on the web side. */
export const BACKUP_PROBLEMS = [
  'passphrase_missing',
  'passphrase_too_short',
  'passphrase_placeholder',
  'folder_not_writable',
  'switched_off', // BACKUP_ENABLED=off in .env
  'schedule_off', // the schedule is "off" in Admin
  'last_backup_failed',
  'last_test_failed',
  'overdue',
  'never_backed_up',
] as const;
export type BackupProblem = (typeof BACKUP_PROBLEMS)[number];

export interface BackupStatus {
  /** BACKUP_ENABLED: the master switch for the schedule. */
  enabled: boolean;
  passphrase: PassphraseState;
  folderWritable: boolean;
  /** A backup or test is running right now (in this api). */
  running: boolean;
  settings: BackupSettings;
  nextRunAt: string | null;
  lastSuccessAt: string | null;
  lastRun: BackupRunRecord | null;
  lastTest: BackupTestRecord | null;
  /** Green: nothing in `problems` is a failure. */
  healthy: boolean;
  problems: BackupProblem[];
}

// ---- the routes (SuperAdmin only; a test checks the api registers exactly these) ----

/** One file in the backups folder, as the Admin page lists it. */
export interface BackupListItem {
  name: string;
  kind: BackupKind;
  /** Plain `.sql.gz` safety copies are not encrypted: they are listed but never offered for download. */
  encrypted: boolean;
  bytes: number;
  modifiedAt: string;
  /** From the cleartext header (not trusted until the archive is opened with the passphrase). */
  appVersion?: string;
  schema?: number;
  /** The result of the last test of this very file, when there is one. */
  tested: 'ok' | 'failed' | null;
}

/** GET /api/admin/backups */
export interface BackupsResponse {
  status: BackupStatus;
  backups: BackupListItem[];
}

/** POST /api/admin/backups and POST /api/admin/backups/test: accepted, poll GET /api/admin/backups. */
export interface BackupStarted {
  started: true;
}

/** POST /api/admin/backups/download-ticket: the SuperAdmin's password again, and which archive. */
export interface DownloadTicketRequest {
  name: string;
  password: string;
}

/** The ticket is single use, valid for BACKUP_TICKET_SECONDS, and bound to this session and this file. */
export interface DownloadTicket {
  ticket: string;
  expiresAt: string;
}

export const BACKUP_TICKET_SECONDS = 30;

export const BACKUP_ERROR_CODES = [
  'backup_busy',
  'backup_not_found',
  'backup_unavailable',
  'invalid_backup_setting',
] as const;
export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

export const BACKUP_ROUTES = [
  { method: 'GET', path: '/api/admin/backups', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/backups', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/backups/test', access: 'superadmin' },
  { method: 'GET', path: '/api/admin/backups/settings', access: 'superadmin' },
  { method: 'PATCH', path: '/api/admin/backups/settings', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/backups/download-ticket', access: 'superadmin' },
  { method: 'GET', path: '/api/admin/backups/download', access: 'superadmin' },
] as const;
