// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email (ADR 0041): what Admin -> Storage & email shows. The settings live in the environment; nothing here is ever a secret
// (a key or a password is only ever "set").

export const MAIL_PROVIDERS = ['off', 'resend', 'smtp'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

/** starttls: TLS required after the greeting (the default). tls: TLS from the first byte. none: no encryption (no password allowed). */
export const SMTP_SECURITY = ['starttls', 'tls', 'none'] as const;
export type SmtpSecurityMode = (typeof SMTP_SECURITY)[number];

export const MAIL_ERROR_CODES = [
  'mail_not_configured',
  // Templates (53b): a draft that breaks a rule, a fixed or reserved template, an id that is not a template.
  'invalid_template',
  'mail_template_fixed',
  'mail_template_not_found',
] as const;

/**
 * A plain sentence of advice for a common cause of a failed send, recognised in the provider's (cleaned) error. Each has a
 * translation key `mail.hint.<code>`.
 */
export const MAIL_HINTS = [
  'resend_domain',
  'resend_key',
  'resend_connection',
  'smtp_auth',
  'smtp_certificate',
  'smtp_connection',
  'smtp_tls',
] as const;
export type MailHint = (typeof MAIL_HINTS)[number];

export const MAIL_STATES = ['queued', 'sending', 'sent', 'failed', 'cancelled'] as const;
export type MailState = (typeof MAIL_STATES)[number];

/** The newest message that went wrong (it may still be retried, unless `final`). */
export interface MailFailure {
  at: string;
  /** Which kind of email (for example "test" or "invitation"). */
  template: string;
  /** The provider's error with anything secret and every address removed, at most 300 characters. */
  error: string;
  /** True when KinShip gave up on it; false while it will be tried again. */
  final: boolean;
  hint: MailHint | null;
}

/** The newest "Send test to me". */
export interface MailTestResult {
  id: string;
  status: MailState;
  at: string;
  sentAt: string | null;
  error: string | null;
  hint: MailHint | null;
}

/** GET /api/admin/mail (SuperAdmin only). */
export interface MailStatus {
  provider: MailProvider;
  /** MAIL_FROM as configured, or null when mail is not set up. */
  from: string | null;
  /** For SMTP: where mail goes and how. The password is never sent, only whether one is set. */
  smtp: { host: string; port: number; security: SmtpSecurityMode; user: string | null; passwordSet: boolean } | null;
  /** For Resend: only that a key is set. */
  resend: { keySet: boolean } | null;
  /** PUBLIC_URL, which every link in an email starts with. */
  publicUrl: string;
  /** default: PUBLIC_URL was never set. http: links would not be encrypted. */
  publicUrlWarning: 'default' | 'http' | null;
  /** Messages waiting to be sent (including retries). */
  queued: number;
  /** Messages KinShip gave up on in the last 7 days. */
  failedLastWeek: number;
  lastFailure: MailFailure | null;
  lastTest: MailTestResult | null;
  /** Where "Send test to me" sends: the signed-in SuperAdmin's own address. */
  testRecipient: string;
}

/** POST /api/admin/mail/test answers 202 with the queued message's id. */
export interface MailTestStarted {
  id: string;
}

// ---- Templates (53b) ----------------------------------------------------------------------------------------------------

/** The templates 0.4 sends. `test` is fixed (it cannot be edited); the others have an editable subject, preview and blocks. */
export const MAIL_TEMPLATE_IDS = ['invitation', 'password_reset', 'password_changed', 'test'] as const;
export type MailTemplateId = (typeof MAIL_TEMPLATE_IDS)[number];

/** Step 57's templates: listed as "Next", with no content, and they cannot be opened. */
export const MAIL_RESERVED_TEMPLATE_IDS = [
  'birthday_today',
  'birthday_tomorrow',
  'birthday_week',
  'weekly_digest',
  'medical_edit',
] as const;
export type MailReservedTemplateId = (typeof MAIL_RESERVED_TEMPLATE_IDS)[number];

/** subject and preview: one line. heading: one line, never empty. text: paragraphs (a blank line starts one). list: one item per paragraph. */
export const MAIL_FIELD_KINDS = ['subject', 'preview', 'heading', 'text', 'list'] as const;
export type MailFieldKind = (typeof MAIL_FIELD_KINDS)[number];

/** The most characters an admin may write in a field (before the placeholders are filled in). */
export const MAIL_FIELD_MAX: Readonly<Record<MailFieldKind, number>> = {
  subject: 150,
  preview: 150,
  heading: 1000,
  text: 1000,
  list: 1000,
};

/** One row of GET /api/admin/mail/templates. */
export interface MailTemplateSummary {
  id: MailTemplateId | MailReservedTemplateId;
  /** False for the test email (fixed text). */
  editable: boolean;
  /** Step 57's templates: no content yet ("Next"). */
  reserved: boolean;
  /** An admin changed at least one field. */
  overridden: boolean;
}

export interface MailTemplateField {
  /** "subject", "preview" or a block key such as "intro". */
  key: string;
  kind: MailFieldKind;
  /** Subject and headings may not be empty (nor may a security notice's "if this was not you" text). */
  required: boolean;
  maxLength: number;
  /** The placeholders this field may use, without braces (for example "inviter"). */
  placeholders: string[];
  /** The built-in English text. */
  default: string;
}

/** GET /api/admin/mail/templates/:id */
export interface MailTemplateDetail {
  id: MailTemplateId;
  editable: boolean;
  fields: MailTemplateField[];
  /** The fields an admin changed: key -> text. A field that is missing uses its default. */
  overrides: Record<string, string>;
}

/** PUT /api/admin/mail/templates/:id and POST …/preview: the whole draft, key -> text. A missing key means the default. */
export interface MailTemplateDraft {
  fields: Record<string, string>;
}

export const MAIL_TEMPLATE_PROBLEMS = [
  'empty',
  'too_long',
  'line_break',
  'unknown_placeholder',
  'stray_brace',
  'unknown_field',
  'not_text',
] as const;
export type MailTemplateProblemCode = (typeof MAIL_TEMPLATE_PROBLEMS)[number];

/** One reason in a 400 invalid_template answer: `{ error: 'invalid_template', problems: [...] }`. */
export interface MailTemplateProblem {
  field: string;
  problem: MailTemplateProblemCode;
  /** unknown_placeholder: the name as written, without braces. */
  placeholder?: string;
  /** too_long: the limit. */
  max?: number;
}

/** POST …/preview: the draft rendered with the Hale sample data and a link that goes nowhere. */
export interface MailPreview {
  subject: string;
  html: string;
  text: string;
}

export const MAIL_ROUTES = [
  { method: 'GET', path: '/api/admin/mail', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/mail/test', access: 'superadmin' },
  { method: 'GET', path: '/api/admin/mail/templates', access: 'superadmin' },
  { method: 'GET', path: '/api/admin/mail/templates/:id', access: 'superadmin' },
  { method: 'PUT', path: '/api/admin/mail/templates/:id', access: 'superadmin' },
  { method: 'DELETE', path: '/api/admin/mail/templates/:id', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/mail/templates/:id/preview', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/mail/templates/:id/test', access: 'superadmin' },
] as const;
