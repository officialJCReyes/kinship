// SPDX-License-Identifier: AGPL-3.0-or-later
import { weekdayOrder } from '@kinship/shared';
import type { MessageKey } from '@kinship/shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { t } from '../i18n.js';
import {
  addDays,
  addMonths,
  daysInMonth,
  heldFromText,
  MAX_YEAR,
  MIN_YEAR,
  monthText,
  monthWeeks,
  today,
  weekday,
  ymdText,
  yearText,
} from '../lib/calendar.js';
import type { Ymd } from '../lib/calendar.js';
import { formatDate } from '../lib/dates.js';
import { useDisplay } from '../lib/display.js';

interface CalendarPickerProps {
  /** The date field's label, for the picker's own names. */
  label: string;
  /** What the field holds now: the picker opens on that year, month or day (on today when it holds nothing usable). */
  text: string;
  /** A day, a month or a year was chosen. `text` is YYYY-MM-DD, YYYY-MM or YYYY: what the field holds. */
  onPick: (text: string) => void;
  /** `restoreFocus` is true when the person closed it (Escape, Close), false when they moved elsewhere. */
  onClose: (restoreFocus: boolean) => void;
  /** The button that opened it: a click on it is the caller's, not an "outside" click. */
  toggle: RefObject<HTMLElement | null>;
  id: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * A month calendar beside the typed date field, not instead of it. Year and month are chosen directly (a Year box and a
 * Month list), so 1903 is a few keystrokes away, and the day is optional: "Use the year" and "Use March 1962" fill the
 * field with just that much, like typing it. Keyboard: arrows move by day, Page Up/Down by month (Shift: by year),
 * Home/End to the start/end of the week (which day that is comes from the account's week start), Enter or Space to choose, Escape to close.
 */
export function CalendarPicker({ label, text, onPick, onClose, toggle, id }: CalendarPickerProps) {
  const held = heldFromText(text);
  // The weekdays in the order of the account's week start (0 is Sunday). The first one is the column the grid starts on.
  const weekdays = weekdayOrder(useDisplay().weekStart);
  const first = weekdays[0] ?? 0;
  const [focus, setFocus] = useState<Ymd>(() => {
    if (!held) return today();
    return { y: held.y, m: held.level === 'year' ? 1 : held.m, d: held.level === 'day' ? held.d : 1 };
  });
  // What is typed in the Year box while it is being typed; null means "show the year of the month on view".
  const [yearDraft, setYearDraft] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Set when the keyboard moved the day, so focus follows it after the render (not when only the header changed).
  const follow = useRef(true);
  const captionId = useId();
  const hintId = useId();

  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    root.current?.querySelector<HTMLElement>(`[data-day="${focus.d}"]`)?.focus();
  }, [focus]);

  // A click or focus anywhere else closes it (without taking focus back).
  useEffect(() => {
    const away = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root.current?.contains(target) || toggle.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('focusin', away);
    };
  }, [onClose, toggle]);

  const monthName = (m: number) => t(`date.monthLong.${m}` as MessageKey);
  const go = (next: Ymd, byKeyboard: boolean) => {
    follow.current = byKeyboard;
    setFocus(next);
  };
  const setMonth = (m: number) => go({ ...focus, m, d: Math.min(focus.d, daysInMonth(focus.y, m)) }, false);
  const setYear = (y: number) => {
    const year = Math.min(MAX_YEAR, Math.max(MIN_YEAR, y));
    go({ y: year, m: focus.m, d: Math.min(focus.d, daysInMonth(year, focus.m)) }, false);
  };
  const commitYear = (value: string) => {
    setYearDraft(null);
    if (/^\d{1,4}$/.test(value) && Number(value) >= MIN_YEAR) setYear(Number(value));
  };

  const onGridKey = (event: KeyboardEvent) => {
    const step = (days: number) => {
      event.preventDefault();
      go(addDays(focus, days), true);
    };
    const months = (n: number) => {
      event.preventDefault();
      go(addMonths(focus, event.shiftKey ? n * 12 : n), true);
    };
    const column = (weekday(focus) - first + 7) % 7;
    switch (event.key) {
      case 'ArrowLeft':
        return step(-1);
      case 'ArrowRight':
        return step(1);
      case 'ArrowUp':
        return step(-7);
      case 'ArrowDown':
        return step(7);
      case 'Home':
        return step(-column);
      case 'End':
        return step(6 - column);
      case 'PageUp':
        return months(-1);
      case 'PageDown':
        return months(1);
      default:
    }
  };

  const heldDay = held?.level === 'day' ? held : null;
  const now = today();
  const dayLabel = (day: number) => formatDate({ value: ymdText({ y: focus.y, m: focus.m, d: day }) });
  const useYearPressed = held?.level === 'year' && held.y === focus.y;
  const useMonthPressed = held?.level === 'month' && held.y === focus.y && held.m === focus.m;

  return (
    <div
      ref={root}
      id={id}
      className="calendar"
      role="dialog"
      aria-modal="false"
      aria-label={t('date.picker.title', { field: label })}
      aria-describedby={hintId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation(); // a dialog around the form must not close too
          onClose(true);
        }
      }}
    >
      <div className="calendar-head">
        <button
          type="button"
          className="button small"
          aria-label={t('date.picker.prevMonth')}
          onClick={() => go(addMonths(focus, -1), false)}
        >
          ‹
        </button>
        <select
          aria-label={t('date.picker.month')}
          value={focus.m}
          onChange={(event) => setMonth(Number(event.target.value))}
        >
          {MONTHS.map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <input
          type="number"
          aria-label={t('date.picker.year')}
          min={MIN_YEAR}
          max={MAX_YEAR}
          step={1}
          inputMode="numeric"
          value={yearDraft ?? String(focus.y)}
          onChange={(event) => {
            setYearDraft(event.target.value);
            if (/^\d{4}$/.test(event.target.value)) commitYear(event.target.value);
          }}
          onBlur={(event) => commitYear(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitYear((event.target as HTMLInputElement).value);
            }
          }}
        />
        <button
          type="button"
          className="button small"
          aria-label={t('date.picker.nextMonth')}
          onClick={() => go(addMonths(focus, 1), false)}
        >
          ›
        </button>
      </div>
      <table role="grid" aria-labelledby={captionId} onKeyDown={onGridKey}>
        <caption id={captionId} aria-live="polite">
          {monthName(focus.m)} {focus.y}
        </caption>
        <thead>
          <tr>
            {weekdays.map((d) => (
              <th key={d} scope="col" abbr={t(`date.weekdayLong.${d}` as MessageKey)}>
                {t(`date.weekdayShort.${d}` as MessageKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthWeeks(focus.y, focus.m, first).map((week, row) => (
            <tr key={row}>
              {week.map((day, column) =>
                day === null ? (
                  <td key={column} aria-hidden="true" />
                ) : (
                  <td
                    key={column}
                    role="gridcell"
                    aria-selected={heldDay?.y === focus.y && heldDay.m === focus.m && heldDay.d === day}
                  >
                    <button
                      type="button"
                      data-day={day}
                      className={`calendar-day${now.y === focus.y && now.m === focus.m && now.d === day ? ' today' : ''}`}
                      tabIndex={day === focus.d ? 0 : -1}
                      aria-label={dayLabel(day)}
                      aria-current={now.y === focus.y && now.m === focus.m && now.d === day ? 'date' : undefined}
                      onFocus={() => {
                        if (day !== focus.d) setFocus({ ...focus, d: day });
                      }}
                      onClick={() => onPick(ymdText({ y: focus.y, m: focus.m, d: day }))}
                    >
                      {day}
                    </button>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="calendar-actions">
        <button
          type="button"
          className="button small"
          aria-pressed={useYearPressed}
          onClick={() => onPick(yearText(focus.y))}
        >
          {t('date.picker.useYear', { year: focus.y })}
        </button>
        <button
          type="button"
          className="button small"
          aria-pressed={useMonthPressed}
          onClick={() => onPick(monthText(focus.y, focus.m))}
        >
          {t('date.picker.useMonth', { month: formatDate({ value: monthText(focus.y, focus.m) }) })}
        </button>
        <button type="button" className="button small" onClick={() => onClose(true)}>
          {t('date.picker.close')}
        </button>
      </div>
      <div id={hintId} className="muted field-help">
        {t('date.picker.hint')}
      </div>
    </div>
  );
}
