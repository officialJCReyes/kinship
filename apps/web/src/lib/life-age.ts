// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How old someone is (or was when they died), from two typed partial dates. Pure: "today" is passed in, so nothing here
// depends on the clock.
//   - Both dates complete to the day and both "exactly": the exact age in whole years (one less before the birthday).
//     Someone born on 29 February has their birthday on 1 March in a year with no 29 February.
//   - Otherwise (a year or a month alone, or about, before or after): the difference of the years, marked approximate.
//   - No age when a date is missing or not a date, when the end is before the start, or when the result is over 130.
import type { PartialDate, PartialDateInput } from '@kinship/shared';

export interface LifeAge {
  years: number;
  /** True when the age is only the difference of the years (shown as "~NN"). */
  approx: boolean;
}

type DateIn = PartialDate | PartialDateInput | null | undefined;

const SHAPE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;
export const MAX_AGE = 130;

interface Parts {
  year: number;
  month: number | null;
  day: number | null;
  exact: boolean;
}

function parts(date: DateIn): Parts | null {
  if (!date) return null;
  const match = SHAPE.exec(date.value.trim());
  if (!match) return null;
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null && (day < 1 || day > 31)) return null;
  return { year: Number(match[1]), month, day, exact: (date.precision ?? 'exactly') === 'exactly' };
}

/** The age at `end` of someone born at `start`, or null when it cannot be told (see the rules above). */
export function ageBetween(start: DateIn, end: DateIn): LifeAge | null {
  const from = parts(start);
  const to = parts(end);
  if (!from || !to) return null;
  const complete = from.exact && to.exact && from.day !== null && to.day !== null;
  let years = to.year - from.year;
  if (complete) {
    const [fm, fd, tm, td] = [from.month!, from.day!, to.month!, to.day!];
    if (tm < fm || (tm === fm && td < fd)) years -= 1;
  }
  if (years < 0 || years > MAX_AGE) return null;
  return { years, approx: !complete };
}

/** Today in the browser's local time, as a complete date. */
export function localToday(now: Date): PartialDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { value: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, precision: 'exactly' };
}

/** How old a living person is on `now` (local time). */
export function ageNow(birth: DateIn, now: Date): LifeAge | null {
  return ageBetween(birth, localToday(now));
}
