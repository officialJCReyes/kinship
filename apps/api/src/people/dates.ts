// SPDX-License-Identifier: AGPL-3.0-or-later
import { DATE_PRECISIONS } from '@kinship/shared';
import type { DatePrecision, PartialDate, PartialDateInput } from '@kinship/shared';
import { badRequest } from '../errors.js';

const SHAPE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The same rule as kinship_valid_partial_date() in the database (migration 0003). */
export function isValidPartialDate(value: string): boolean {
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

export function isPrecision(value: unknown): value is DatePrecision {
  return typeof value === 'string' && (DATE_PRECISIONS as readonly string[]).includes(value);
}

/**
 * Checks a date from a request body. `null` clears the date; `undefined` (not sent) means "leave as is"
 * and is handled by the caller. Throws invalid_date or invalid_precision.
 */
export function parseDateInput(raw: PartialDateInput | null): PartialDate | null {
  if (raw === null) return null;
  if (typeof raw !== 'object' || typeof raw.value !== 'string' || !isValidPartialDate(raw.value)) {
    throw badRequest('invalid_date');
  }
  const precision = raw.precision ?? 'exactly';
  if (!isPrecision(precision)) throw badRequest('invalid_precision');
  return { value: raw.value, precision };
}

/** A stored date and precision as the API shows it. */
export function toPartialDate(value: string | null, precision: DatePrecision): PartialDate | null {
  return value === null ? null : { value, precision };
}

/** The year of a stored date (its first four characters), or null. */
export function yearOf(value: string | null): number | null {
  return value === null ? null : Number(value.slice(0, 4));
}
