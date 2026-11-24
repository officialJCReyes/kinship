// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  help?: ReactNode;
  error?: string | undefined;
  /**
   * Show an asterisk after the label of a `required` field (the name forms, backlog 13). It is outside the label and hidden
   * from assistive technology: the input's `required` is what a screen reader announces, and the accessible name stays the label.
   */
  markRequired?: boolean;
}

/** A labelled input with optional help text and an error message, wired up for screen readers. */
export function Field({ label, help, error, markRequired, ...input }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      {markRequired && input.required ? (
        <div className="field-label">
          <label htmlFor={id}>{label}</label>
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        </div>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      {help ? (
        <div id={helpId} className="muted field-help">
          {help}
        </div>
      ) : null}
      {error ? (
        <div id={errorId} className="field-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
