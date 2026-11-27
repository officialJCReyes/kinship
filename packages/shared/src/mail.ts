// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Email (ADR 0041): what Admin -> Storage & email shows. The settings live in the environment; nothing here is ever a secret
// (a key or a password is only ever "set").

export const MAIL_PROVIDERS = ['off', 'resend', 'smtp'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

/** starttls: TLS required after the greeting (the default). tls: TLS from the first byte. none: no encryption (no password allowed). */
export const SMTP_SECURITY = ['starttls', 'tls', 'none'] as const;
export type SmtpSecurityMode = (typeof SMTP_SECURITY)[number];

export const MAIL_ERROR_CODES = ['mail_not_configured'] as const;

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

export const MAIL_ROUTES = [
  { method: 'GET', path: '/api/admin/mail', access: 'superadmin' },
  { method: 'POST', path: '/api/admin/mail/test', access: 'superadmin' },
] as const;
