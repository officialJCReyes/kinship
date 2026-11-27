// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Placeholders in email text (ADR 0041, 53b). An admin writes `{inviter}`; the renderer fills in the value the caller passed.
//
//   * A placeholder is a brace, a lower-case name and a brace. Each field allows its own short list of names.
//   * Braces are for placeholders only: there is no way to write a literal `{` or `}`, and a draft with one anywhere else is
//     refused ("stray_brace"). Family text has no use for braces, and an escape such as `{{` would be one more rule to learn.
//   * Filling in is one pass: a value that itself contains `{name}` (a tree called "{tree}") is printed as it is, never filled
//     in again.
import { MAIL_FIELD_MAX } from '@kinship/shared';
import type { MailFieldKind, MailTemplateProblem } from '@kinship/shared';

const PLACEHOLDER = /\{([a-z][a-z_]*)\}/g;

/** The rules for one field of one template. */
export interface FieldRule {
  key: string;
  kind: MailFieldKind;
  required: boolean;
  placeholders: readonly string[];
}

/** Every placeholder name written in `text`, in order (duplicates kept). */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
}

/** Why `text` cannot be saved in this field (an empty list when it can). `text` uses \n for line breaks. */
export function checkField(rule: FieldRule, text: string): MailTemplateProblem[] {
  const problems: MailTemplateProblem[] = [];
  const field = rule.key;
  if (rule.required && text.trim() === '') problems.push({ field, problem: 'empty' });
  const max = MAIL_FIELD_MAX[rule.kind];
  if ([...text].length > max) problems.push({ field, problem: 'too_long', max });
  if (
    (rule.kind === 'subject' || rule.kind === 'preview' || rule.kind === 'heading') &&
    /[\r\n\u2028\u2029]/.test(text)
  ) {
    problems.push({ field, problem: 'line_break' });
  }
  const unknown = new Set(placeholdersIn(text).filter((name) => !rule.placeholders.includes(name)));
  for (const placeholder of unknown) problems.push({ field, problem: 'unknown_placeholder', placeholder });
  if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) problems.push({ field, problem: 'stray_brace' });
  return problems;
}

/** Fills in the placeholders (one pass). A name with no value becomes empty text. */
export function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => values[name] ?? '');
}

/** Line endings as \n, and nothing else changed. */
export function normaliseLines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
