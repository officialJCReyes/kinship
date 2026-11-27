// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What a provider said when a send failed, made safe to store and to show on the Storage & email page: the configured key and
// password (and their base64 forms, as an SMTP AUTH line would carry them) are replaced, anything that looks like a credential
// is removed, every email address is masked, control characters go, and the text is cut at 300 characters. Then a plain hint
// for a few common causes, recognised in that cleaned text; the hint is a code the page turns into a fixed sentence.
import { Buffer } from 'node:buffer';
import type { MailHint } from '@kinship/shared';

export const MAX_ERROR = 300;
export const REDACTED = '[redacted]';

/** Every form a secret could appear in: as written, and base64 alone or as an SMTP AUTH PLAIN or LOGIN string. */
export function secretForms(secrets: {
  key?: string | undefined;
  user?: string | undefined;
  password?: string | undefined;
}): string[] {
  const forms = new Set<string>();
  const add = (value: string | undefined) => {
    if (value !== undefined && value.length >= 4) {
      forms.add(value);
      forms.add(Buffer.from(value).toString('base64'));
    }
  };
  add(secrets.key);
  add(secrets.password);
  if (secrets.password !== undefined && secrets.user !== undefined) {
    add(`\u0000${secrets.user}\u0000${secrets.password}`);
    add(`${secrets.user}\u0000${secrets.password}`);
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function cleanError(raw: string, secrets: string[]): string {
  let text = raw;
  for (const secret of secrets) text = text.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED);
  text = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    // An Authorization header or a bearer token, whatever follows it on the line.
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*\S+(\s+\S+)?/gi, `$1: ${REDACTED}`)
    .replace(/\bbearer\s+\S+/gi, `Bearer ${REDACTED}`)
    // Resend keys start with re_.
    .replace(/\bre_[A-Za-z0-9_]{6,}/g, REDACTED)
    // SMTP AUTH lines: whatever follows AUTH PLAIN or AUTH LOGIN.
    .replace(/\bAUTH\s+(PLAIN|LOGIN|XOAUTH2|CRAM-MD5)\s+\S+/gi, `AUTH $1 ${REDACTED}`)
    // Every email address: the local part goes, the domain stays (it helps to see "gmail.com refused").
    .replace(/[^\s@<>"'(),;:[\]]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '…@$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > MAX_ERROR) text = `${text.slice(0, MAX_ERROR - 1)}…`;
  return text === '' ? 'The provider gave no reason.' : text;
}

/** A plain hint for a common cause, or null. Fixed rules on the cleaned text; the page shows a translated sentence. */
export function hintFor(error: string | null | undefined): MailHint | null {
  if (!error) return null;
  if (error.startsWith('Resend') || error.startsWith('Could not reach Resend')) {
    if (/domain[^.]*not (been )?verified|verify (your|a|the) domain|validation_error[^.]*domain/i.test(error))
      return 'resend_domain';
    if (
      /answered (401|403)|api key is invalid|invalid[_ ]api[_ ]key|missing[_ ]api[_ ]key|restricted[_ ]api[_ ]key/i.test(
        error,
      )
    )
      return 'resend_key';
    if (/could not reach resend/i.test(error)) return 'resend_connection';
    return null;
  }
  if (
    /\bEAUTH\b|\b535\b|authentication (failed|unsuccessful)|invalid login|username and password not accepted/i.test(
      error,
    )
  )
    return 'smtp_auth';
  if (/certificate|self[- ]signed|unable to verify|\bCERT_|ERR_TLS_CERT|altnames/i.test(error))
    return 'smtp_certificate';
  if (/STARTTLS|requireTLS|wrong version number|\bETLS\b/i.test(error)) return 'smtp_tls';
  if (
    /ECONNREFUSED|ETIMEDOUT|ECONNECTION|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ECONNRESET|timed? ?out|greeting never received/i.test(
      error,
    )
  )
    return 'smtp_connection';
  return null;
}
