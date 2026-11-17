// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Every day at 03:00 in this time zone", worked out with Intl only: robust to daylight saving (a skipped hour moves the run
// forward, a repeated hour runs once) and to a clock that jumps (a run that was missed is still the latest one that is due).
import type { BackupSettings } from '@kinship/shared';

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall-clock time in a zone. */
export function localParts(instant: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return {
    year: out['year'] ?? 0,
    month: out['month'] ?? 0,
    day: out['day'] ?? 0,
    hour: out['hour'] ?? 0,
    minute: out['minute'] ?? 0,
    second: out['second'] ?? 0,
  };
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const p = localParts(new Date(instant), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in a zone. A time that does not exist (the hour skipped in spring) becomes the first
 * moment after the gap; a time that happens twice (the hour repeated in autumn) is the later one.
 */
export function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  const matches = (instant: number) => {
    const p = localParts(new Date(instant), timeZone);
    return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute;
  };
  const real = [first, second].filter(matches);
  if (real.length === 0) return new Date(Math.max(first, second));
  return new Date(Math.max(...real));
}

const dayBefore = (year: number, month: number, day: number, back: number) => {
  const d = new Date(Date.UTC(year, month - 1, day - back));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
};

const hm = (time: string): [number, number] => [Number(time.slice(0, 2)), Number(time.slice(3, 5))];

/** The latest scheduled instant that is not after `now`, or null when the schedule is off. */
export function latestDue(now: Date, settings: BackupSettings): Date | null {
  if (settings.schedule === 'off') return null;
  const today = localParts(now, settings.timeZone);
  const [h, m] = hm(settings.time);
  for (let back = 0; back <= 8; back++) {
    const date = dayBefore(today.year, today.month, today.day, back);
    if (settings.schedule === 'weekly' && date.weekday !== settings.weekday) continue;
    const instant = zonedInstant(date.year, date.month, date.day, h, m, settings.timeZone);
    if (instant.getTime() <= now.getTime()) return instant;
  }
  return null;
}

/** The first scheduled instant after `now`, or null when the schedule is off. */
export function nextDue(now: Date, settings: BackupSettings): Date | null {
  if (settings.schedule === 'off') return null;
  const today = localParts(now, settings.timeZone);
  const [h, m] = hm(settings.time);
  for (let ahead = 0; ahead <= 8; ahead++) {
    const date = dayBefore(today.year, today.month, today.day, -ahead);
    if (settings.schedule === 'weekly' && date.weekday !== settings.weekday) continue;
    const instant = zonedInstant(date.year, date.month, date.day, h, m, settings.timeZone);
    if (instant.getTime() > now.getTime()) return instant;
  }
  return null;
}

/** "2026-11-14" for the day an instant falls on in a zone. */
export function localDay(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The Monday of the week an instant falls in, in a zone, as "YYYY-MM-DD" (a week key). */
export function localWeek(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const monday = dayBefore(p.year, p.month, p.day, (weekday + 6) % 7);
  return `${monday.year}-${String(monday.month).padStart(2, '0')}-${String(monday.day).padStart(2, '0')}`;
}

export function localMonth(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}
