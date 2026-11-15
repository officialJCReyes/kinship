// SPDX-License-Identifier: AGPL-3.0-or-later
import type { DatePrecision, PartialDate, PartialDateInput } from '@kinship/shared';
import { t } from '../i18n.js';
import type { MessageKey } from '@kinship/shared';

/** A date as it is being typed: the text and how to read it. */
export interface DateDraft {
  text: string;
  precision: DatePrecision;
}

export const emptyDateDraft: DateDraft = { text: '', precision: 'exactly' };

const SHAPE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The same rule as the API and the database: YYYY, YYYY-MM or YYYY-MM-DD, and the day must exist. */
export function isValidDateText(value: string): boolean {
  if (!SHAPE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1) return false;
  if (value.length === 4) return true;
  const month = Number(value.slice(5, 7));
  if (month < 1 || month > 12) return false;
  if (value.length === 7) return true;
  const day = Number(value.slice(8, 10));
  return day >= 1 && day <= daysInMonth(year, month);
}

export function draftFromDate(date: PartialDate | null | undefined): DateDraft {
  return date ? { text: date.value, precision: date.precision } : emptyDateDraft;
}

/** `null` for an empty field, `undefined` when what was typed is not a date. */
export function draftToInput(draft: DateDraft): PartialDateInput | null | undefined {
  const text = draft.text.trim();
  if (text === '') return null;
  return isValidDateText(text) ? { value: text, precision: draft.precision } : undefined;
}

/**
 * The one place a date becomes text for people to read. Today it is always "March 3, 1955"; the per-user
 * display setting (0.2) changes only this function. A year or a month with a year is shown as typed.
 */
export function formatDate(date: PartialDate | PartialDateInput | null | undefined): string {
  if (!date) return '';
  const precision = date.precision ?? 'exactly';
  const [year, month, day] = date.value.split('-');
  const monthName = month ? t(`date.month.${Number(month)}` as MessageKey) : '';
  let text = year ?? '';
  if (month && !day) text = `${monthName} ${year}`;
  if (month && day) text = `${monthName} ${Number(day)}, ${year}`;
  return precision === 'exactly' ? text : t(`date.${precision}` as MessageKey, { date: text });
}

/** The birth year (or "about 1955"), for compact lists. */
export function formatYear(date: PartialDate | null | undefined): string {
  if (!date) return '';
  const year = date.value.slice(0, 4);
  return date.precision === 'exactly' ? year : t(`date.${date.precision}` as MessageKey, { date: year });
}
