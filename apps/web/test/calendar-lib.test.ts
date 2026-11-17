// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  civilFromDays,
  daysFromCivil,
  daysInMonth,
  heldFromText,
  monthWeeks,
  weekday,
  ymdText,
} from '../src/lib/calendar.js';

describe('calendar arithmetic', () => {
  it('counts days from 1970-01-01 and back, for every kind of year', () => {
    expect(daysFromCivil({ y: 1970, m: 1, d: 1 })).toBe(0);
    for (const date of [
      { y: 1, m: 1, d: 1 },
      { y: 99, m: 12, d: 31 }, // JavaScript's Date would call this 1999
      { y: 1600, m: 2, d: 29 },
      { y: 1900, m: 3, d: 1 },
      { y: 1903, m: 12, d: 17 },
      { y: 2000, m: 2, d: 29 },
      { y: 9999, m: 12, d: 31 },
    ]) {
      expect(civilFromDays(daysFromCivil(date)), ymdText(date)).toEqual(date);
    }
  });

  it('knows the weekday, back to the first century', () => {
    expect(weekday({ y: 1970, m: 1, d: 1 })).toBe(4); // Thursday
    expect(weekday({ y: 1903, m: 12, d: 17 })).toBe(4); // the first powered flight, a Thursday
    expect(weekday({ y: 2000, m: 2, d: 29 })).toBe(2); // Tuesday
    expect(weekday({ y: 1, m: 1, d: 1 })).toBe(1); // Monday in the proleptic Gregorian calendar
  });

  it('knows leap years: the century rule too', () => {
    expect([1900, 1903, 1904, 2000, 2100].map((y) => daysInMonth(y, 2))).toEqual([28, 28, 29, 29, 28]);
  });

  it('moves by days across months and years', () => {
    expect(addDays({ y: 1903, m: 12, d: 31 }, 1)).toEqual({ y: 1904, m: 1, d: 1 });
    expect(addDays({ y: 1904, m: 3, d: 1 }, -1)).toEqual({ y: 1904, m: 2, d: 29 });
    expect(addDays({ y: 1, m: 1, d: 1 }, -1)).toEqual({ y: 1, m: 1, d: 1 }); // stops at year 1
    expect(addDays({ y: 9999, m: 12, d: 31 }, 1)).toEqual({ y: 9999, m: 12, d: 31 });
  });

  it('moves by months, keeping the day or the last day of a shorter month', () => {
    expect(addMonths({ y: 1903, m: 1, d: 31 }, 1)).toEqual({ y: 1903, m: 2, d: 28 });
    expect(addMonths({ y: 1904, m: 1, d: 31 }, 1)).toEqual({ y: 1904, m: 2, d: 29 });
    expect(addMonths({ y: 1903, m: 3, d: 15 }, -3)).toEqual({ y: 1902, m: 12, d: 15 });
    expect(addMonths({ y: 1903, m: 6, d: 15 }, 12)).toEqual({ y: 1904, m: 6, d: 15 });
  });

  it('lays a month out in weeks starting on Sunday', () => {
    const weeks = monthWeeks(2026, 11); // 1 Nov 2026 is a Sunday
    expect(weeks[0]).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weeks.at(-1)).toEqual([29, 30, null, null, null, null, null]);
    expect(
      monthWeeks(1903, 2)
        .flat()
        .filter((d) => d !== null),
    ).toHaveLength(28);
    expect(
      monthWeeks(1904, 2)
        .flat()
        .filter((d) => d !== null),
    ).toHaveLength(29);
    for (const week of monthWeeks(1903, 6)) expect(week).toHaveLength(7);
  });

  it('reads what the field holds as a year, a month or a day, and nothing otherwise', () => {
    expect(heldFromText('1903')).toEqual({ level: 'year', y: 1903 });
    expect(heldFromText(' 1903-06 ')).toEqual({ level: 'month', y: 1903, m: 6 });
    expect(heldFromText('1903-06-15')).toEqual({ level: 'day', y: 1903, m: 6, d: 15 });
    for (const bad of ['', '19', '1903-13', '1903-02-30', 'June 1903', '0000'])
      expect(heldFromText(bad), bad).toBeNull();
  });
});
