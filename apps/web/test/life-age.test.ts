// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DatePrecision } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { ageBetween, ageNow, localToday } from '../src/lib/life-age.js';

const d = (value: string, precision: DatePrecision = 'exactly') => ({ value, precision });

describe('ageBetween', () => {
  it('gives the exact age in whole years when both dates are complete and exact', () => {
    expect(ageBetween(d('1903-08-09'), d('1979-08-11'))).toEqual({ years: 76, approx: false });
    expect(ageBetween(d('1994-08-26'), d('2026-08-26'))).toEqual({ years: 32, approx: false });
  });

  it('counts one less before the birthday is reached', () => {
    expect(ageBetween(d('1994-08-26'), d('2026-08-25'))).toEqual({ years: 31, approx: false });
    expect(ageBetween(d('1994-08-26'), d('2026-07-30'))).toEqual({ years: 31, approx: false });
  });

  it('has someone born on 29 February a year older on 1 March when the year has no 29 February', () => {
    expect(ageBetween(d('2000-02-29'), d('2001-02-28'))).toEqual({ years: 0, approx: false });
    expect(ageBetween(d('2000-02-29'), d('2001-03-01'))).toEqual({ years: 1, approx: false });
    expect(ageBetween(d('2000-02-29'), d('2004-02-29'))).toEqual({ years: 4, approx: false });
  });

  it('gives the difference of the years, marked approximate, for a year or a month alone', () => {
    expect(ageBetween(d('1903'), d('1979-08-11'))).toEqual({ years: 76, approx: true });
    expect(ageBetween(d('1903-08-09'), d('1979'))).toEqual({ years: 76, approx: true });
    expect(ageBetween(d('1903-08'), d('1979-08'))).toEqual({ years: 76, approx: true });
  });

  it('is approximate for about, before and after, even with complete dates', () => {
    for (const precision of ['about', 'before', 'after'] as const) {
      expect(ageBetween(d('1903-08-09', precision), d('1979-08-11'))).toEqual({ years: 76, approx: true });
      expect(ageBetween(d('1903-08-09'), d('1979-08-11', precision))).toEqual({ years: 76, approx: true });
    }
  });

  it('gives no age when a date is missing or is not a date', () => {
    expect(ageBetween(null, d('1979'))).toBeNull();
    expect(ageBetween(d('1903'), undefined)).toBeNull();
    expect(ageBetween(d('someday'), d('1979'))).toBeNull();
    expect(ageBetween(d('1903-13'), d('1979'))).toBeNull();
  });

  it('gives no age when the death is before the birth, or the age is over 130', () => {
    expect(ageBetween(d('1979-08-11'), d('1903-08-09'))).toBeNull();
    expect(ageBetween(d('1979-08-11'), d('1979-08-10'))).toBeNull();
    expect(ageBetween(d('1980'), d('1979'))).toBeNull();
    expect(ageBetween(d('1800'), d('1931'))).toBeNull();
    expect(ageBetween(d('1800'), d('1930'))).toEqual({ years: 130, approx: true });
  });
});

describe('ageNow', () => {
  it('uses the injected date in local time, as a complete date', () => {
    const now = new Date(2026, 10, 25, 23, 30); // 25 November 2026, late evening, local time
    expect(localToday(now)).toEqual({ value: '2026-11-25', precision: 'exactly' });
    expect(ageNow(d('1994-08-26'), now)).toEqual({ years: 32, approx: false });
    expect(ageNow(d('1994-11-26'), now)).toEqual({ years: 31, approx: false });
    expect(ageNow(d('1994'), now)).toEqual({ years: 32, approx: true });
    expect(ageNow(d('1994-08-26', 'about'), now)).toEqual({ years: 32, approx: true });
    expect(ageNow(null, now)).toBeNull();
  });
});
