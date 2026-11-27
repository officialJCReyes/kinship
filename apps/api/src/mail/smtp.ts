// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Any SMTP server, through nodemailer (MIT-0). STARTTLS is required unless the operator chose TLS from the first byte or, for
// a local relay with no password, no encryption (config.ts refuses a password without encryption). Certificates are always
// checked and TLS 1.2 is the oldest accepted; there is no setting to turn that off. Nodemailer is told never to read a file or a
// URL for a message part, so message content can never make it touch the disk or the network.
import nodemailer from 'nodemailer';
import type { SmtpSecurity } from '../config.js';
import { parseMailFrom } from '../config.js';
import { MailSendError } from './transport.js';
import type { MailTransport, OutgoingMail } from './transport.js';

export interface SmtpOptions {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string | undefined;
  password: string | undefined;
  /** Tests only: the certificate of the local fake server, trusted in addition to the system's. */
  ca?: string;
  /** Tests only: shorter waits. */
  timeoutMs?: number;
}

interface SmtpError {
  code?: unknown;
  responseCode?: unknown;
  message?: unknown;
}

export function createSmtpTransport(options: SmtpOptions): MailTransport {
  const wait = options.timeoutMs ?? 10_000;
  const transporter = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: options.security === 'tls',
    requireTLS: options.security === 'starttls',
    ignoreTLS: options.security === 'none',
    ...(options.user !== undefined ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      servername: options.host,
      ...(options.ca !== undefined ? { ca: options.ca } : {}),
    },
    connectionTimeout: wait,
    greetingTimeout: wait,
    socketTimeout: wait * 2,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return {
    provider: 'smtp',
    async send(mail: OutgoingMail) {
      const from = parseMailFrom(mail.from);
      try {
        const info = await transporter.sendMail({
          from: from?.name ? { name: from.name, address: from.address } : (from?.address ?? mail.from),
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          ...(mail.html !== null ? { html: mail.html } : {}),
          headers: { 'Auto-Submitted': 'auto-generated' },
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        const id = typeof info.messageId === 'string' && info.messageId.length <= 200 ? info.messageId : null;
        return { providerId: id };
      } catch (error) {
        const e = (typeof error === 'object' && error !== null ? error : {}) as SmtpError;
        const code = typeof e.code === 'string' ? e.code : 'error';
        const response = typeof e.responseCode === 'number' ? e.responseCode : null;
        const message = typeof e.message === 'string' ? e.message : 'unknown error';
        // A 5xx answer about this message (a recipient or the message refused: EENVELOPE, EMESSAGE) is permanent. A refused
        // sign-in (535), a missing STARTTLS and anything about the connection are settings the operator can fix or a server
        // that is down, so they are retried, as is every 4xx.
        const permanent =
          response !== null && response >= 500 && response < 600 && (code === 'EENVELOPE' || code === 'EMESSAGE');
        throw new MailSendError(`SMTP ${code}${response !== null ? ` ${response}` : ''}: ${message}`, permanent);
      }
    },
  };
}
