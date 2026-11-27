// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turns a template, the caller's values and the family's overrides into a finished email (ADR 0041, 53b).
//
//   * The text of each field is the admin's override when there is one, otherwise the built-in English default; placeholders
//     are then filled in with the caller's values. A fixed template (the test email) ignores overrides.
//   * The template's code adds everything an admin cannot change: the button and its address, the full link to copy, the
//     expiry line and the privacy wording. An admin cannot remove a link.
//   * Every button address must start with PUBLIC_URL; anything else is a bug and throws, so a link can never come from text.
//   * The subject goes into a mail header: line breaks and control characters become spaces, and it is cut at 200 characters.
import { MAIL_FIELD_MAX } from '@kinship/shared';
import type { MailFieldKind, MailTemplateField, MailTemplateId } from '@kinship/shared';
import { htmlOf, textOf } from './layout.js';
import type { MailDocument, MailNode } from './layout.js';
import { fill, normaliseLines } from './placeholders.js';

export const SUBJECT_MAX = 200;

export interface FieldSpec {
  key: string;
  kind: MailFieldKind;
  required?: boolean;
  placeholders: readonly string[];
  default: string;
}

/** What a template's code gets to build the email with. */
export interface BuildContext<P> {
  params: P;
  publicUrl: string;
  /** The field's text (override or default) with its placeholders filled in. */
  text(key: string): string;
  /** A text field split into paragraphs at each blank line (empty ones dropped). */
  paragraphs(key: string): string[];
}

export interface TemplateDef<P> {
  id: MailTemplateId;
  editable: boolean;
  fields: readonly FieldSpec[];
  /** The values the placeholders are filled with. */
  values(params: P, publicUrl: string): Record<string, string>;
  /** The nodes and the footer, in order. */
  build(context: BuildContext<P>): { nodes: MailNode[]; footer: string[] };
  /** The Hale sample the preview and "Send test to me" use. Its link goes nowhere. */
  sample(publicUrl: string): P;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

/** Line breaks and control characters out (they would split a mail header), spaces squeezed, cut at SUBJECT_MAX. */
export function headerSafe(value: string): string {
  const flat = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  const chars = [...flat];
  return chars.length > SUBJECT_MAX ? `${chars.slice(0, SUBJECT_MAX - 1).join('')}…` : flat;
}

/** Blank-line separated paragraphs, trimmed, empty ones dropped. */
export function splitParagraphs(text: string): string[] {
  return normaliseLines(text)
    .split(/\n[ \t]*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** The editor's view of a template's fields. */
export function describeFields(def: TemplateDef<unknown>): MailTemplateField[] {
  return def.fields.map((field) => ({
    key: field.key,
    kind: field.kind,
    required: field.required === true || field.kind === 'subject' || field.kind === 'heading',
    maxLength: MAIL_FIELD_MAX[field.kind],
    placeholders: [...field.placeholders],
    default: field.default,
  }));
}

/** The address must be on PUBLIC_URL; the template code passes only addresses the caller built there. */
function checkLinks(nodes: MailNode[], publicUrl: string): void {
  for (const node of nodes) {
    if (node.kind === 'button' && !node.url.startsWith(`${publicUrl}/`)) {
      throw new Error(`email ${node.label}: the link is not on PUBLIC_URL`);
    }
  }
}

export function render<P>(
  def: TemplateDef<P>,
  params: P,
  overrides: Readonly<Record<string, string>>,
  publicUrl: string,
): RenderedMail {
  const base = publicUrl.replace(/\/+$/, '');
  const values = def.values(params, base);
  const specs = new Map(def.fields.map((field) => [field.key, field]));
  const text = (key: string): string => {
    const spec = specs.get(key);
    if (!spec) throw new Error(`email template ${def.id} has no field ${key}`);
    const own = def.editable ? overrides[key] : undefined;
    return fill(normaliseLines(own ?? spec.default), values);
  };
  const built = def.build({ params, publicUrl: base, text, paragraphs: (key) => splitParagraphs(text(key)) });
  checkLinks(built.nodes, base);
  const doc: MailDocument = {
    subject: headerSafe(text('subject')),
    preview: specs.has('preview') ? headerSafe(text('preview')) : '',
    nodes: built.nodes,
    footer: built.footer,
    publicUrl: base,
  };
  return { subject: doc.subject, html: htmlOf(doc), text: textOf(doc) };
}

/** "Sofia Hale" -> "SH"; one name -> one letter; nothing -> "?". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...(words[0] ?? '')][0] ?? '';
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
}
