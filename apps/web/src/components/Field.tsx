// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  help?: ReactNode;
  error?: string | undefined;
}

/** A labelled input with optional help text and an error message, wired up for screen readers. */
export function Field({ label, help, error, ...input }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
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
