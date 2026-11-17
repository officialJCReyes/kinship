// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Calendar arithmetic for the date picker. Plain numbers, no Date objects, so years below 100 (which JavaScript's Date
// maps to 19xx) and far-away years behave: genealogy dates go back centuries. Proleptic Gregorian, like the database's
// date type. Days are counted from 1970-01-01 (the algorithms of Howard Hinnant's "chrono-compatible low-level date
// algorithms").
import { isValidDateText } from './dates.js';

export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function daysFromCivil({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z: number): Ymd {
  const shifted = z + 719468;
  const era = Math.floor(shifted / 146097);
  const doe = shifted - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 is Sunday, 6 is Saturday. */
export function weekday(date: Ymd): number {
  return (((daysFromCivil(date) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

const clampYmd = (date: Ymd): Ymd =>
  date.y < MIN_YEAR ? { y: MIN_YEAR, m: 1, d: 1 } : date.y > MAX_YEAR ? { y: MAX_YEAR, m: 12, d: 31 } : date;

export function addDays(date: Ymd, days: number): Ymd {
  return clampYmd(civilFromDays(daysFromCivil(date) + days));
}

/** A month (or years, as 12 months) away, keeping the day of the month where the new month has it, else its last day. */
export function addMonths(date: Ymd, months: number): Ymd {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  if (y < MIN_YEAR) return { y: MIN_YEAR, m: 1, d: Math.min(date.d, 31) };
  if (y > MAX_YEAR) return { y: MAX_YEAR, m: 12, d: Math.min(date.d, 31) };
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** YYYY-MM-DD, YYYY-MM or YYYY: the text the date field holds. */
export function ymdText(date: Ymd): string {
  return `${pad(date.y, 4)}-${pad(date.m, 2)}-${pad(date.d, 2)}`;
}
export const monthText = (y: number, m: number): string => `${pad(y, 4)}-${pad(m, 2)}`;
export const yearText = (y: number): string => pad(y, 4);

/** What the field holds, as far as the picker can open on it: a year, a month, or a whole day (null if it is none). */
export type Held =
  | { level: 'year'; y: number }
  | { level: 'month'; y: number; m: number }
  | { level: 'day'; y: number; m: number; d: number };

export function heldFromText(text: string): Held | null {
  const value = text.trim();
  if (!isValidDateText(value)) return null;
  const y = Number(value.slice(0, 4));
  if (value.length === 4) return { level: 'year', y };
  const m = Number(value.slice(5, 7));
  if (value.length === 7) return { level: 'month', y, m };
  return { level: 'day', y, m, d: Number(value.slice(8, 10)) };
}

/** The weeks of a month, Sunday first, with `null` before the 1st and after the last day. */
export function monthWeeks(y: number, m: number): Array<Array<number | null>> {
  const lead = weekday({ y, m, d: 1 });
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

export function today(): Ymd {
  const now = new Date();
  return clampYmd({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}
