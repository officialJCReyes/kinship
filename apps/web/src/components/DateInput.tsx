// SPDX-License-Identifier: AGPL-3.0-or-later
import { DATE_PRECISIONS } from '@kinship/shared';
import type { DatePrecision, MessageKey } from '@kinship/shared';
import { useCallback, useId, useRef, useState } from 'react';
import { t } from '../i18n.js';
import { CalendarPicker } from './CalendarPicker.js';
import { draftToInput, formatDate } from '../lib/dates.js';
import type { DateDraft } from '../lib/dates.js';

interface DateInputProps {
  label: string;
  draft: DateDraft;
  onChange: (draft: DateDraft) => void;
  /** Show a problem at once (a form sets this after a failed save). Otherwise it shows after leaving the field. */
  showError?: boolean;
  /** A problem found elsewhere (a form's own check, or the server's answer), shown in place of the date's own. */
  externalError?: string | undefined;
}

/**
 * A date typed as YYYY, YYYY-MM or YYYY-MM-DD, with how to read it (exactly, about, before, after) and a
 * live preview of what it means. Empty is allowed. Matches the API's `{ value, precision }`.
 */
export function DateInput({ label, draft, onChange, showError, externalError }: DateInputProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const [picking, setPicking] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const pickerId = `${id}-calendar`;
  const closePicker = useCallback((restoreFocus: boolean) => {
    setPicking(false);
    if (restoreFocus) toggle.current?.focus();
  }, []);
  const parsed = draftToInput(draft);
  const invalid = parsed === undefined;
  const shownError = Boolean(externalError) || (invalid && (touched || showError));
  const previewId = `${id}-preview`;
  const errorId = `${id}-error`;
  return (
    <div className="field date-input">
      <label htmlFor={id}>{label}</label>
      <div className="date-row">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder={t('date.placeholder')}
          value={draft.text}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? `${previewId} ${errorId}` : previewId}
          onChange={(event) => onChange({ ...draft, text: event.target.value })}
          onBlur={() => setTouched(true)}
        />
        <button
          ref={toggle}
          type="button"
          className="button calendar-toggle"
          aria-label={t('date.pick', { field: label })}
          aria-haspopup="dialog"
          aria-expanded={picking}
          aria-controls={picking ? pickerId : undefined}
          onClick={() => setPicking(!picking)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
            <path d="M3.5 10H20.5M8 3V7M16 3V7" />
          </svg>
        </button>
        <select
          aria-label={t('date.precisionFor', { field: label })}
          value={draft.precision}
          onChange={(event) => onChange({ ...draft, precision: event.target.value as DatePrecision })}
        >
          {DATE_PRECISIONS.map((precision) => (
            <option key={precision} value={precision}>
              {t(`date.precision.${precision}` as MessageKey)}
            </option>
          ))}
        </select>
      </div>
      {picking ? (
        <CalendarPicker
          id={pickerId}
          label={label}
          text={draft.text}
          toggle={toggle}
          onClose={closePicker}
          onPick={(text) => {
            onChange({ ...draft, text });
            setTouched(true);
            closePicker(true);
          }}
        />
      ) : null}
      <div id={previewId} className="muted field-help" aria-live="polite">
        {parsed ? t('date.preview', { date: formatDate(parsed) }) : ''}
      </div>
      {shownError ? (
        <div id={errorId} className="field-error">
          {externalError ?? t('error.invalid_date')}
        </div>
      ) : null}
    </div>
  );
}
