// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every email template 0.4 knows (ADR 0041, 53b), and the checks on an admin's draft.
import { MAIL_RESERVED_TEMPLATE_IDS, MAIL_TEMPLATE_IDS } from '@kinship/shared';
import type { MailTemplateId, MailTemplateProblem } from '@kinship/shared';
import { checkField, normaliseLines } from '../placeholders.js';
import { describeFields } from '../render.js';
import type { TemplateDef } from '../render.js';
import { invitation } from './invitation.js';
import type { InvitationParams } from './invitation.js';
import { passwordChanged } from './password-changed.js';
import type { PasswordChangedParams } from './password-changed.js';
import { passwordReset } from './password-reset.js';
import type { PasswordResetParams } from './password-reset.js';
import { testEmail } from './test.js';
import type { TestParams } from './test.js';

export type { InvitationParams, PasswordChangedParams, PasswordResetParams, TestParams };

/** What each template needs from its caller. */
export interface TemplateParams {
  invitation: InvitationParams;
  password_reset: PasswordResetParams;
  password_changed: PasswordChangedParams;
  test: TestParams;
}

export const TEMPLATES: { readonly [K in MailTemplateId]: TemplateDef<TemplateParams[K]> } = {
  invitation,
  password_reset: passwordReset,
  password_changed: passwordChanged,
  test: testEmail,
};

export function isTemplateId(id: string): id is MailTemplateId {
  return (MAIL_TEMPLATE_IDS as readonly string[]).includes(id);
}

export function isReservedTemplateId(id: string): boolean {
  return (MAIL_RESERVED_TEMPLATE_IDS as readonly string[]).includes(id);
}

export function templateDef(id: MailTemplateId): TemplateDef<unknown> {
  return TEMPLATES[id] as TemplateDef<unknown>;
}

/**
 * Checks a draft (key -> text) against a template. Returns the problems, and the fields that differ from their defaults
 * (only those are stored, so a default improved in a later release still reaches every family that did not change it).
 */
export function checkDraft(
  def: TemplateDef<unknown>,
  fields: unknown,
): { problems: MailTemplateProblem[]; changed: Record<string, string> } {
  const problems: MailTemplateProblem[] = [];
  const changed: Record<string, string> = {};
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return { problems: [{ field: '', problem: 'not_text' }], changed };
  }
  const rules = new Map(describeFields(def).map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(fields)) {
    const rule = rules.get(key);
    if (!rule) {
      problems.push({ field: key, problem: 'unknown_field' });
      continue;
    }
    if (typeof value !== 'string') {
      problems.push({ field: key, problem: 'not_text' });
      continue;
    }
    // Line breaks are checked before they are normalised, so a CR in a subject is still a line break.
    problems.push(...checkField(rule, value));
    const text = normaliseLines(value);
    if (text !== rule.default) changed[key] = text;
  }
  return { problems, changed };
}
