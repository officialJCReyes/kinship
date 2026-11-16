// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How a stored date is shown. A date is stored as typed (YYYY, YYYY-MM or YYYY-MM-DD) with a precision; this turns it
// into text for people in the account's date format. The stored text is never changed. Month names come from
// translation keys (no Intl), so the patterns are exactly the ones in the mockup. The web app, reports and emails
// (later) all use this one function.
import type { DateFormat } from './settings.js';
import type { Translate } from './i18n.js';
import type { MessageKey } from './messages/en.js';
import type { DatePrecision } from './people.js';

export interface DateLike {
  value: string;
  precision?: DatePrecision | undefined;
}

const SHAPE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/**
 * "Jan 1, 2026", "2026-01-01", "01/2026", "about 1955" and so on. A year alone stays a year in every format. Empty
 * input is "". A value that is not a date (it cannot come from the API) is returned as written, never hidden.
 */
export function formatPartialDate(date: DateLike | null | undefined, format: DateFormat, t: Translate): string {
  if (!date) return '';
  const raw = date.value.trim();
  if (raw === '') return '';
  const match = SHAPE.exec(raw);
  if (!match) return raw;
  const [, year, month, day] = match as unknown as [string, string, string | undefined, string | undefined];
  const m = month === undefined ? 0 : Number(month);
  const d = day === undefined ? 0 : Number(day);
  if (month !== undefined && (m < 1 || m > 12)) return raw;
  if (day !== undefined && (d < 1 || d > 31)) return raw;

  const short = (): string => t(`date.monthShort.${m}` as MessageKey);
  const long = (): string => t(`date.monthLong.${m}` as MessageKey);
  const mm = month ?? '';
  const dd = day ?? '';
  let text: string;
  if (month === undefined) {
    text = year;
  } else if (day === undefined) {
    // A year and a month.
    text = {
      mdy: `${short()} ${year}`,
      dmy: `${short()} ${year}`,
      dmy2: `${short()} ${year}`,
      long: `${long()} ${year}`,
      iso: `${year}-${mm}`,
      us: `${mm}/${year}`,
      eu: `${mm}/${year}`,
    }[format];
  } else {
    text = {
      mdy: `${short()} ${d}, ${year}`,
      dmy: `${d} ${short()}, ${year}`,
      dmy2: `${d} ${short()} ${year}`,
      long: `${long()} ${d}, ${year}`,
      iso: `${year}-${mm}-${dd}`,
      us: `${mm}/${dd}/${year}`,
      eu: `${dd}/${mm}/${year}`,
    }[format];
  }
  const precision = date.precision ?? 'exactly';
  return precision === 'exactly' ? text : t(`date.${precision}` as MessageKey, { date: text });
}
