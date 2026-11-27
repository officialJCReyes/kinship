// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Resend's HTTP API with plain fetch (no SDK). The address is fixed: nothing in the environment or a request can point it
// anywhere else (only the tests pass a local fake server). Redirects are refused. HTTPS_PROXY is honoured the way the update
// check honours it (Node's own proxy support, set at start).
import { MailSendError } from './transport.js';
import type { MailTransport, OutgoingMail } from './transport.js';

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;
const MAX_ANSWER = 4_000;

export interface ResendOptions {
  apiKey: string;
  /** Tests only: a local fake server. */
  endpoint?: string;
  timeoutMs?: number;
}

/** The provider's message from an error answer ({ "message": "...", "name": "..." }), or the start of the raw text. */
function describe(status: number, body: string): string {
  let said = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { message?: unknown; name?: unknown };
    const parts = [parsed.name, parsed.message].filter((p): p is string => typeof p === 'string' && p !== '');
    if (parts.length > 0) said = parts.join(': ');
  } catch {
    // not JSON: keep the raw start
  }
  return `Resend answered ${status}: ${said}`;
}

export function createResendTransport(options: ResendOptions): MailTransport {
  const endpoint = options.endpoint ?? RESEND_ENDPOINT;
  return {
    provider: 'resend',
    async send(mail: OutgoingMail) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            'user-agent': 'KinShip',
            // Resend keeps an idempotency key for 24 hours: a retry after a lost answer is not a second email.
            'idempotency-key': mail.id,
          },
          body: JSON.stringify({
            from: mail.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            ...(mail.html !== null ? { html: mail.html } : {}),
            headers: { 'Auto-Submitted': 'auto-generated' },
          }),
        });
      } catch (error) {
        const reason =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timed out'
            : error instanceof Error
              ? ((error.cause as { code?: string } | undefined)?.code ?? error.message)
              : 'unknown error';
        throw new MailSendError(`Could not reach Resend: ${reason}`, false);
      }
      const body = (await response.text().catch(() => '')).slice(0, MAX_ANSWER);
      if (response.ok) {
        let id: string | null = null;
        try {
          const parsed = JSON.parse(body) as { id?: unknown };
          if (typeof parsed.id === 'string' && parsed.id.length <= 200) id = parsed.id;
        } catch {
          // a success without an id is still a success
        }
        return { providerId: id };
      }
      // 400 and 422: this request is wrong (a bad recipient, a missing field) and will be wrong again. 401 and 403 (a bad key,
      // a sender domain not verified), 408, 409, 429 and 5xx: fixable by the operator or by waiting.
      const permanent = response.status === 400 || response.status === 422;
      throw new MailSendError(describe(response.status, body), permanent);
    },
  };
}
