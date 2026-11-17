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

export interface BackupState {
  version: 1;
  /** Newest first, at most 50. */
  runs: BackupRunRecord[];
  lastTest: BackupTestRecord | null;
}

export const EMPTY_BACKUP_STATE: BackupState = { version: 1, runs: [], lastTest: null };

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
