// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One way to hand a finished message to a provider (ADR 0041). Two real ones (Resend's HTTP API, any SMTP server) and, in the
// tests, a fake. A transport never logs and never stores anything: the outbox does both, with the error cleaned first.

/** A message ready to go: one recipient, one subject line, a plain-text part and (usually) an HTML part. */
export interface OutgoingMail {
  /** The outbox id: used as the idempotency key where the provider supports one, so a retry is not a second message. */
  id: string;
  /** MAIL_FROM as configured ("Name <address>" or a bare address). */
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
}

export interface MailTransport {
  readonly provider: 'resend' | 'smtp' | 'fake';
  /** Resolves with the provider's id for the message (or null); rejects with a MailSendError. */
  send(mail: OutgoingMail): Promise<{ providerId: string | null }>;
}

/**
 * A send that did not work. `permanent` means trying again cannot help (the provider refused this message: a bad recipient,
 * a malformed request). Anything that a fix to the settings or time can cure (a wrong key, an unverified domain, a server that
 * is down) is temporary, so the message still goes once the operator fixes it and restarts. The message may contain what the
 * provider said; the outbox cleans it before storing or showing it.
 */
export class MailSendError extends Error {
  override name = 'MailSendError';
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}
