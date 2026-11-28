// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin → Emails (ADR 0041, 53b): the queries, and the small rules the editor needs. The email text itself (the defaults and
// the family's changes) comes from the API; only the UI around it is translated.
import { en, MAIL_TEMPLATE_IDS } from '@kinship/shared';
import type { MailPreview, MailTemplateDetail, MailTemplateId, MailTemplateProblem, MessageKey } from '@kinship/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { t } from '../i18n.js';

export const templatesKey = ['admin', 'mail', 'templates'] as const;
export const templateKey = (id: string) => [...templatesKey, id] as const;

/** How long the editor waits after the last key press before it asks for a new preview (and the live errors). */
export const PREVIEW_DELAY_MS = 400;

export function isTemplateId(id: string | undefined): id is MailTemplateId {
  return (MAIL_TEMPLATE_IDS as readonly string[]).includes(id ?? '');
}

/** A translation that may not exist (a field or template added by the API before the web app knows it): the key's text then. */
function maybe(key: string, fallback: string): string {
  return key in en ? t(key as MessageKey) : fallback;
}

export const templateName = (id: string) => maybe(`emails.template.${id}`, id);
export const templateAbout = (id: string) => maybe(`emails.template.${id}.about`, '');
export const fieldLabel = (key: string) => maybe(`emails.field.${key}`, key);
export const fieldNote = (key: string) => maybe(`emails.note.${key}`, '');

/** The text each field has now: the family's, else the default. */
export function savedText(detail: MailTemplateDetail): Record<string, string> {
  return Object.fromEntries(detail.fields.map((field) => [field.key, detail.overrides[field.key] ?? field.default]));
}

export function sameText(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a[key] ?? '') === (b[key] ?? ''));
}

/** One problem from a 400 invalid_template answer, as a sentence. */
export function problemText(problem: MailTemplateProblem): string {
  switch (problem.problem) {
    case 'too_long':
      return t('emails.problem.too_long', { max: problem.max ?? '' });
    case 'unknown_placeholder':
      return t('emails.problem.unknown_placeholder', { placeholder: `{${problem.placeholder ?? ''}}` });
    default:
      return t(`emails.problem.${problem.problem}`);
  }
}

/** The problems in an error, when it is a 400 invalid_template; otherwise null. */
export function problemsOf(error: unknown): MailTemplateProblem[] | null {
  if (!(error instanceof api.ApiError) || error.code !== 'invalid_template') return null;
  const problems = error.details.problems;
  return Array.isArray(problems) ? (problems as MailTemplateProblem[]) : [];
}

export function useMailTemplates() {
  return useQuery({ queryKey: templatesKey, queryFn: ({ signal }) => api.fetchMailTemplates(signal) });
}

export function useMailTemplate(id: MailTemplateId) {
  return useQuery({ queryKey: templateKey(id), queryFn: ({ signal }) => api.fetchMailTemplate(id, signal) });
}

/** The value, once it has not changed for `delay` milliseconds. */
export function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** A preview answer: the rendered draft, or the problems that stop it (a 400 invalid_template). */
export type PreviewResult = { preview: MailPreview } | { problems: MailTemplateProblem[] };

/**
 * The draft rendered with the Hale sample. A 400 invalid_template is an answer, not a failure: it carries the live errors.
 * While the next answer is on its way the last one stays. Never retried, and not kept for long (drafts are many and short-lived).
 */
export function usePreview(id: MailTemplateId, fields: Record<string, string>) {
  return useQuery({
    queryKey: ['admin', 'mail', 'preview', id, fields] as const,
    queryFn: async ({ signal }): Promise<PreviewResult> => {
      try {
        return { preview: await api.previewMailTemplate(id, fields, signal) };
      } catch (error) {
        const problems = problemsOf(error);
        if (problems) return { problems };
        throw error;
      }
    },
    placeholderData: keepPreviousData,
    retry: false,
    gcTime: 10_000,
  });
}
