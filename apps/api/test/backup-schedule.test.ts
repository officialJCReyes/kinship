// SPDX-License-Identifier: AGPL-3.0-or-later
// The parts of the backup schedule that need no database: settings, time zones and DST, retention, and the history file.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKUP_SETTINGS, lastSuccessfulBackupAt, parseBackupSettings } from '@kinship/shared';
import type { BackupRunRecord, BackupSettings } from '@kinship/shared';
import { afterAll, describe, expect, it } from 'vitest';
import type { ListedBackup } from '../src/backup/archive.js';
import { applyRetention, archiveTime, planRetention } from '../src/backup/retention.js';
import { cleanStaleTemp } from '../src/backup/scheduler.js';
import { latestDue, localDay, localMonth, localWeek, nextDue, zonedInstant } from '../src/backup/schedule-time.js';
import { readState, recordRun, recordTest, updateState } from '../src/backup/state.js';

const dirs: string[] = [];
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-sched-'));
  dirs.push(dir);
  return dir;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const settings = (change: Partial<BackupSettings> = {}): BackupSettings => ({ ...DEFAULT_BACKUP_SETTINGS, ...change });
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('parseBackupSettings', () => {
  it('accepts any subset of valid values', () => {
    expect(
      parseBackupSettings({
        schedule: 'weekly',
        time: '23:59',
        weekday: 6,
        keepDaily: 1,
        keepWeekly: 0,
        keepMonthly: 12,
        includeFiles: false,
        testAfterBackup: true,
        timeZone: 'America/New_York',
      }),
    ).toEqual({
      ok: true,
      settings: {
        schedule: 'weekly',
        time: '23:59',
        weekday: 6,
        keepDaily: 1,
        keepWeekly: 0,
        keepMonthly: 12,
        includeFiles: false,
        testAfterBackup: true,
        timeZone: 'America/New_York',
      },
    });
    expect(parseBackupSettings({ schedule: 'off' })).toEqual({ ok: true, settings: { schedule: 'off' } });
  });

  it('names the field that is wrong, and refuses unknown keys, empty and non-objects', () => {
    const bad = (input: unknown) => parseBackupSettings(input);
    expect(bad({ schedule: 'hourly' })).toEqual({ ok: false, code: 'invalid_backup_setting', field: 'schedule' });
    expect(bad({ time: '24:00' })).toMatchObject({ field: 'time' });
    expect(bad({ time: '3:00' })).toMatchObject({ field: 'time' });
    expect(bad({ weekday: 7 })).toMatchObject({ field: 'weekday' });
    expect(bad({ keepDaily: 0 })).toMatchObject({ field: 'keepDaily' });
    expect(bad({ keepWeekly: -1 })).toMatchObject({ field: 'keepWeekly' });
    expect(bad({ keepMonthly: 1.5 })).toMatchObject({ field: 'keepMonthly' });
    expect(bad({ includeFiles: 'yes' })).toMatchObject({ field: 'includeFiles' });
    expect(bad({ timeZone: 'Mars/Olympus' })).toMatchObject({ field: 'timeZone' });
    expect(bad({ passphrase: 'x' })).toEqual({ ok: false, code: 'invalid_request', field: 'passphrase' });
    expect(bad({})).toMatchObject({ code: 'invalid_request' });
    expect(bad(null)).toMatchObject({ code: 'invalid_request' });
    expect(bad([])).toMatchObject({ code: 'invalid_request' });
  });
});

describe('when a scheduled backup is due', () => {
  const utc = (change: Partial<BackupSettings> = {}) => settings(change);

  it('daily: the latest 03:00 that has passed, and the next one', () => {
    expect(iso(latestDue(new Date('2026-11-14T10:00:00Z'), utc()))).toBe('2026-11-14T03:00:00.000Z');
    expect(iso(latestDue(new Date('2026-11-14T02:59:00Z'), utc()))).toBe('2026-11-13T03:00:00.000Z');
    expect(iso(latestDue(new Date('2026-11-14T03:00:00Z'), utc()))).toBe('2026-11-14T03:00:00.000Z');
    expect(iso(nextDue(new Date('2026-11-14T10:00:00Z'), utc()))).toBe('2026-11-15T03:00:00.000Z');
    expect(iso(nextDue(new Date('2026-11-14T01:00:00Z'), utc()))).toBe('2026-11-14T03:00:00.000Z');
  });

  it('weekly: the chosen weekday (0 is Sunday)', () => {
    const weekly = utc({ schedule: 'weekly', weekday: 0 });
    expect(new Date('2026-11-14T00:00:00Z').getUTCDay()).toBe(6); // a Saturday
    expect(iso(latestDue(new Date('2026-11-14T10:00:00Z'), weekly))).toBe('2026-11-08T03:00:00.000Z');
    expect(iso(nextDue(new Date('2026-11-14T10:00:00Z'), weekly))).toBe('2026-11-15T03:00:00.000Z');
    expect(iso(latestDue(new Date('2026-11-15T03:00:00Z'), weekly))).toBe('2026-11-15T03:00:00.000Z');
  });

  it('off: never', () => {
    expect(latestDue(new Date(), utc({ schedule: 'off' }))).toBeNull();
    expect(nextDue(new Date(), utc({ schedule: 'off' }))).toBeNull();
  });

  it('uses the family time zone', () => {
    const berlin = utc({ timeZone: 'Europe/Berlin' });
    expect(iso(latestDue(new Date('2026-11-14T10:00:00Z'), berlin))).toBe('2026-11-14T02:00:00.000Z'); // 03:00 CET
    expect(iso(latestDue(new Date('2026-07-14T10:00:00Z'), berlin))).toBe('2026-07-14T01:00:00.000Z'); // 03:00 CEST
    const ny = utc({ timeZone: 'America/New_York', time: '22:30' });
    expect(iso(latestDue(new Date('2026-11-14T10:00:00Z'), ny))).toBe('2026-11-14T03:30:00.000Z'); // 22:30 EST the day before
  });

  it('daylight saving: a skipped time moves forward, a repeated one runs once', () => {
    // Berlin, 2026-03-29: 02:00 jumps to 03:00. 02:30 does not exist.
    expect(iso(zonedInstant(2026, 3, 29, 2, 30, 'Europe/Berlin'))).toBe('2026-03-29T01:30:00.000Z'); // 03:30 CEST
    // New York, 2026-03-08: 02:00 jumps to 03:00.
    expect(iso(zonedInstant(2026, 3, 8, 2, 30, 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT
    // Berlin, 2026-10-25: 03:00 falls back to 02:00, so 02:30 happens twice.
    const berlin = utc({ timeZone: 'Europe/Berlin', time: '02:30' });
    const seen = new Set<string>();
    for (let hour = 0; hour < 72; hour++) {
      const due = latestDue(new Date(Date.UTC(2026, 9, 24, 0, 0) + hour * 3_600_000), berlin);
      if (due) seen.add(due.toISOString());
    }
    // Three local days (24th, 25th, 26th) plus the day before: one moment per day, never two for the 25th.
    const onThe25th = [...seen].filter((t) => localDay(new Date(t), 'Europe/Berlin') === '2026-10-25');
    expect(onThe25th).toHaveLength(1);
    // A day with 23 hours still has exactly one run, and the next day's is 23 hours later at the same wall time.
    const before = latestDue(new Date('2026-03-29T12:00:00Z'), utc({ timeZone: 'Europe/Berlin', time: '03:00' }));
    const after = latestDue(new Date('2026-03-30T12:00:00Z'), utc({ timeZone: 'Europe/Berlin', time: '03:00' }));
    expect((after!.getTime() - before!.getTime()) / 3_600_000).toBe(24);
    expect(iso(before)).toBe('2026-03-29T01:00:00.000Z');
  });

  it('groups days, weeks (Monday) and months in a zone', () => {
    const t = new Date('2026-11-14T23:30:00Z'); // already the 15th in Berlin
    expect(localDay(t, 'UTC')).toBe('2026-11-14');
    expect(localDay(t, 'Europe/Berlin')).toBe('2026-11-15');
    expect(localWeek(new Date('2026-11-15T12:00:00Z'), 'UTC')).toBe('2026-11-09'); // Sunday belongs to the week of Monday the 9th
    expect(localWeek(new Date('2026-11-16T00:30:00Z'), 'UTC')).toBe('2026-11-16');
    expect(localMonth(t, 'UTC')).toBe('2026-11');
  });
});

describe('retention', () => {
  const item = (
    name: string,
    kind: ListedBackup['kind'] = 'manual',
    modified = new Date('2026-11-14T03:00:00Z'),
  ): ListedBackup => ({ name, kind, encrypted: true, bytes: 1, modified });
  const day = (d: string, hhmm = '0300') => item(`kinship-${d}-${hhmm}.tar.enc`);

  // 45 daily archives, 2026-10-01 to 2026-11-14, at 03:00.
  const daily = Array.from({ length: 45 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 1 + i));
    return day(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
    );
  });

  it('keeps the newest of each of the last N days, weeks and months, and removes the rest', () => {
    const plan = planRetention(daily, settings({ keepDaily: 7, keepWeekly: 4, keepMonthly: 6 }));
    const kept = new Set(plan.keep);
    for (let d = 8; d <= 14; d++)
      expect(kept.has(`kinship-2026-11-${String(d).padStart(2, '0')}-0300.tar.enc`), `Nov ${d}`).toBe(true);
    // Weeks (Monday-based): the last four weeks with archives each keep their NEWEST: Nov 14 (week of 9th), Nov 8, Nov 1, Oct 25.
    for (const name of ['2026-11-14', '2026-11-08', '2026-11-01', '2026-10-25'])
      expect(kept.has(`kinship-${name}-0300.tar.enc`), name).toBe(true);
    // Months: the newest of November and of October.
    expect(kept.has('kinship-2026-10-31-0300.tar.enc')).toBe(true);
    expect(kept.has('kinship-2026-11-14-0300.tar.enc')).toBe(true);
    // And something in the middle is gone.
    expect(kept.has('kinship-2026-10-10-0300.tar.enc')).toBe(false);
    expect(plan.keep.length + plan.remove.length).toBe(45);
    expect(plan.remove.length).toBeGreaterThan(25);
  });

  it('never removes the newest archive, whatever the counts, and honours what is protected', () => {
    const plan = planRetention(daily, settings({ keepDaily: 1, keepWeekly: 0, keepMonthly: 0 }), [
      'kinship-2026-10-02-0300.tar.enc',
    ]);
    expect(plan.keep.sort()).toEqual(['kinship-2026-10-02-0300.tar.enc', 'kinship-2026-11-14-0300.tar.enc']);
    expect(planRetention([], settings()).keep).toEqual([]);
  });

  it('keeps the newest of several in one day, and orders a same-minute suffix after its base', () => {
    const items = [
      day('2026-11-14', '0300'),
      day('2026-11-14', '1500'),
      item('kinship-2026-11-14-1500-2.tar.enc'),
      day('2026-11-13', '0300'),
    ];
    const plan = planRetention(items, settings({ keepDaily: 2, keepWeekly: 0, keepMonthly: 0 }));
    expect(plan.keep.sort()).toEqual(['kinship-2026-11-13-0300.tar.enc', 'kinship-2026-11-14-1500-2.tar.enc']);
  });

  it('keeps the newest three safety copies of each kind, whatever their format', () => {
    const t = (n: number) => new Date(Date.UTC(2026, 10, n));
    const items = [
      ...[1, 2, 3, 4, 5].map((n) => item(`pre-upgrade-000${n}-to-000${n + 1}.tar.enc`, 'pre-upgrade', t(n))),
      item('pre-upgrade-0006-to-0007.sql.gz', 'pre-upgrade', t(6)),
      ...[1, 2, 3, 4].map((n) => item(`pre-restore-2026111${n}-030000.tar.enc`, 'pre-restore', t(n))),
    ];
    const plan = planRetention(items, settings());
    expect(plan.keep.filter((n) => n.startsWith('pre-upgrade')).sort()).toEqual([
      'pre-upgrade-0004-to-0005.tar.enc',
      'pre-upgrade-0005-to-0006.tar.enc',
      'pre-upgrade-0006-to-0007.sql.gz',
    ]);
    expect(plan.keep.filter((n) => n.startsWith('pre-restore')).sort()).toEqual([
      'pre-restore-20261112-030000.tar.enc',
      'pre-restore-20261113-030000.tar.enc',
      'pre-restore-20261114-030000.tar.enc',
    ]);
  });

  it('groups by the family time zone', () => {
    const late = item('kinship-2026-11-14-2330.tar.enc'); // already the 15th in Berlin
    const next = item('kinship-2026-11-15-0200.tar.enc');
    expect(
      planRetention([late, next], settings({ keepDaily: 5, timeZone: 'UTC', keepWeekly: 0, keepMonthly: 0 })).keep,
    ).toHaveLength(2);
    // In Berlin both fall on the 15th, so only the newer is the day's archive.
    expect(
      planRetention([late, next], settings({ keepDaily: 5, timeZone: 'Europe/Berlin', keepWeekly: 0, keepMonthly: 0 }))
        .keep,
    ).toEqual(['kinship-2026-11-15-0200.tar.enc']);
    expect(archiveTime(late).toISOString()).toBe('2026-11-14T23:30:00.000Z');
  });

  it('on disk: deletes only our files, never a link, a folder or anything else', () => {
    const dir = folder();
    const make = (name: string) => writeFileSync(join(dir, name), 'x');
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'])
      make(`kinship-${d}-0300.tar.enc`);
    make('notes.txt');
    make('kinship-2026-11-09-0300.tar.enc.bak');
    make('state.json');
    mkdirSync(join(dir, 'kinship-2026-01-01-0000.tar.enc'));
    symlinkSync(join(dir, 'notes.txt'), join(dir, 'kinship-2026-02-02-0000.tar.enc'));
    const result = applyRetention(dir, settings({ keepDaily: 2, keepWeekly: 0, keepMonthly: 0 }));
    expect(result.remove.sort()).toEqual([
      'kinship-2026-11-10-0300.tar.enc',
      'kinship-2026-11-11-0300.tar.enc',
      'kinship-2026-11-12-0300.tar.enc',
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      'kinship-2026-01-01-0000.tar.enc',
      'kinship-2026-02-02-0000.tar.enc',
      'kinship-2026-11-09-0300.tar.enc.bak',
      'kinship-2026-11-13-0300.tar.enc',
      'kinship-2026-11-14-0300.tar.enc',
      'notes.txt',
      'state.json',
    ]);
  });
});

describe('state.json', () => {
  const run = (n: number, ok = true, kind: BackupRunRecord['kind'] = 'scheduled'): BackupRunRecord => ({
    id: `r${n}`,
    kind,
    startedAt: `2026-11-14T03:0${n % 10}:00.000Z`,
    finishedAt: `2026-11-14T03:1${n % 10}:00.000Z`,
    ok,
  });

  it('starts empty, keeps the newest first, mode 0600, and leaves no temp file', async () => {
    const dir = folder();
    expect(readState(dir)).toEqual({ version: 1, runs: [], lastTest: null });
    await recordRun(dir, run(1));
    await recordRun(dir, run(2, false));
    await recordTest(dir, {
      at: '2026-11-14T04:00:00.000Z',
      file: 'kinship-x.tar.enc',
      ok: true,
      mode: 'restore',
      tables: 15,
      rows: 100,
    });
    const state = readState(dir);
    expect(state.runs.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(state.lastTest).toMatchObject({ ok: true, rows: 100 });
    expect((statSync(join(dir, 'state.json')).mode & 0o777).toString(8)).toBe('600');
    expect(readdirSync(dir).sort()).toEqual(['state.json']);
  });

  it('survives many writers at once (the api and the command line)', async () => {
    const dir = folder();
    await Promise.all(Array.from({ length: 30 }, (_, i) => recordRun(dir, run(i))));
    expect(readState(dir).runs).toHaveLength(30);
    expect(new Set(readState(dir).runs.map((r) => r.id)).size).toBe(30);
    await Promise.all(Array.from({ length: 40 }, (_, i) => updateState(dir, (s) => void s.runs.unshift(run(100 + i)))));
    expect(readState(dir).runs).toHaveLength(50); // capped
  });

  it('treats a damaged file as empty instead of failing', async () => {
    const dir = folder();
    writeFileSync(join(dir, 'state.json'), '{ not json');
    expect(readState(dir).runs).toEqual([]);
    await recordRun(dir, run(1));
    expect(readState(dir).runs).toHaveLength(1);
  });

  it('replaces a stale lock', async () => {
    const dir = folder();
    writeFileSync(join(dir, 'state.lock'), '');
    const old = new Date(Date.now() - 120_000);
    utimesSync(join(dir, 'state.lock'), old, old);
    await recordRun(dir, run(1));
    expect(readState(dir).runs).toHaveLength(1);
    expect(existsSync(join(dir, 'state.lock'))).toBe(false);
  });

  it('knows the last successful backup (manual or scheduled), not a safety copy or a failure', () => {
    const state = {
      version: 1 as const,
      runs: [run(3, false), run(2, true, 'pre-upgrade'), run(1, true, 'manual')],
      lastTest: null,
    };
    expect(lastSuccessfulBackupAt(state)).toBe(run(1).finishedAt);
    expect(lastSuccessfulBackupAt({ ...state, runs: [] })).toBeNull();
  });
});

describe('stale temporary files', () => {
  it('removes work and temp files older than an hour, and nothing else', () => {
    const dir = folder();
    const old = new Date(Date.now() - 2 * 3_600_000);
    mkdirSync(join(dir, '.work-abc'));
    writeFileSync(join(dir, '.tmp-def.tar.enc'), 'x');
    writeFileSync(join(dir, 'kinship-2026-11-14-0300.tar.enc'), 'x');
    mkdirSync(join(dir, '.work-fresh'));
    for (const name of ['.work-abc', '.tmp-def.tar.enc', 'kinship-2026-11-14-0300.tar.enc'])
      utimesSync(join(dir, name), old, old);
    expect(cleanStaleTemp(dir)).toEqual(expect.arrayContaining(['.work-abc', '.tmp-def.tar.enc']));
    expect(readdirSync(dir).sort()).toEqual(['.work-fresh', 'kinship-2026-11-14-0300.tar.enc']);
    expect(readFileSync(join(dir, 'kinship-2026-11-14-0300.tar.enc'), 'utf8')).toBe('x');
  });
});
