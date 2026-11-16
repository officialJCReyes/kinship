// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatDate } from './dates.js';

/** A moment from the API (an ISO timestamp) as a date in the account's own date format, in the browser's time zone. */
export function formatMoment(iso: string | null | undefined): string {
  if (!iso) return '';
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '';
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');
  return formatDate({ value: `${moment.getFullYear()}-${month}-${day}`, precision: 'exactly' });
}
