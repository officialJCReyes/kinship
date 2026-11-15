// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId } from 'react';
import type { ReactNode, SelectHTMLAttributes } from 'react';

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  help?: ReactNode;
  error?: string | undefined;
}

/** A labelled select with optional help and error text, wired up like Field. */
export function SelectField({ label, help, error, children, ...select }: SelectFieldProps) {
  const id = useId();
  const describedBy = [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...select}>
        {children}
      </select>
      {help ? (
        <div id={`${id}-help`} className="muted field-help">
          {help}
        </div>
      ) : null}
      {error ? (
        <div id={`${id}-error`} className="field-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
