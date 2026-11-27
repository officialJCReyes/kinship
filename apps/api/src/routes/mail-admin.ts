// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin -> Storage & email: whether email is set up, how, what the outbox holds, and "Send test to me" (ADR 0041). SuperAdmin
// only, never cached. Nothing secret is ever answered: a key or a password is only "set". The test goes to the signed-in
// SuperAdmin's own account address and nowhere else; a request that names any other recipient is refused.
import type { MailFailure, MailStatus, MailTestResult, MailTestStarted } from '@kinship/shared';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { Limiters } from '../app.js';
import { GuardSet } from '../auth/limiter.js';
import { requireSuperAdmin } from '../auth/guards.js';
import { ApiError, conflict } from '../errors.js';
import { hintFor } from '../mail/clean-error.js';
import type { MailService } from '../mail/outbox.js';
import { renderTestMail } from '../mail/test-message.js';
import { retrySeconds } from './shared.js';
import type { RouteLimit } from './shared.js';

const GLOBAL_KEY = 'all';
const DEFAULT_PUBLIC_URL = 'http://localhost:8080';

interface RawStatus {
  queued: number;
  failedLastWeek: number;
  lastFailure: { at: string; template: string; error: string | null; final: boolean } | null;
  lastTest: {
    id: string;
    status: MailTestResult['status'];
    at: string;
    sentAt: string | null;
    error: string | null;
  } | null;
}

/** "localhost", "127.0.0.1", "[::1]" and friends: http there is not a warning. */
function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export function publicUrlWarning(publicUrl: string, configured: boolean): MailStatus['publicUrlWarning'] {
  if (!configured) return null;
  if (publicUrl === DEFAULT_PUBLIC_URL) return 'default';
  if (publicUrl.startsWith('http://') && !isLocalHost(publicUrl)) return 'http';
  return null;
}

const iso = (value: string | null): string | null => (value === null ? null : new Date(value).toISOString());

export function registerMailAdminRoutes(
  app: FastifyInstance,
  limit: RouteLimit,
  deps: { mail: MailService | undefined; publicUrl: string; limiters: Limiters; testRequestsPerMinute: number },
): void {
  const { mail, publicUrl, limiters } = deps;
  app.addHook('onRequest', async (request) => {
    requireSuperAdmin(request);
  });
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
  });

  app.get('/api/admin/mail', { config: limit }, async (request): Promise<MailStatus> => {
    const raw = await request.withTransaction(async (trx) => {
      const result = await sql<{ s: RawStatus }>`select public.kinship_mail_status() as s`.execute(trx);
      return result.rows[0]?.s;
    });
    const config = mail?.config ?? { provider: 'off' as const };
    const failure: MailFailure | null =
      raw?.lastFailure && raw.lastFailure.error !== null
        ? {
            at: iso(raw.lastFailure.at) ?? '',
            template: raw.lastFailure.template,
            error: raw.lastFailure.error,
            final: raw.lastFailure.final,
            hint: hintFor(raw.lastFailure.error),
          }
        : null;
    const test: MailTestResult | null = raw?.lastTest
      ? {
          id: raw.lastTest.id,
          status: raw.lastTest.status,
          at: iso(raw.lastTest.at) ?? '',
          sentAt: iso(raw.lastTest.sentAt),
          error: raw.lastTest.error,
          hint: hintFor(raw.lastTest.error),
        }
      : null;
    return {
      provider: config.provider,
      from: config.provider === 'off' ? null : config.from,
      smtp:
        config.provider === 'smtp'
          ? {
              host: config.smtp.host,
              port: config.smtp.port,
              security: config.smtp.security,
              user: config.smtp.user ?? null,
              passwordSet: (config.smtp.password ?? '') !== '',
            }
          : null,
      resend: config.provider === 'resend' ? { keySet: true } : null,
      publicUrl,
      publicUrlWarning: publicUrlWarning(publicUrl, config.provider !== 'off'),
      queued: Number(raw?.queued ?? 0),
      failedLastWeek: Number(raw?.failedLastWeek ?? 0),
      lastFailure: failure,
      lastTest: test,
      testRecipient: request.user!.email,
    };
  });

  app.post(
    '/api/admin/mail/test',
    { config: { rateLimit: { ...limit.rateLimit, max: deps.testRequestsPerMinute } } },
    async (request, reply): Promise<MailTestStarted> => {
      // The recipient is never taken from the request: anything in the body (an address above all) is refused.
      const body = request.body;
      if (body !== undefined && body !== null && (typeof body !== 'object' || Object.keys(body).length > 0)) {
        throw new ApiError(400, 'invalid_request');
      }
      if (!mail || !mail.isConfigured()) throw conflict('mail_not_configured');
      const user = request.user!;
      const guards = new GuardSet([
        { limiter: limiters.mailTestAccount, key: user.id },
        { limiter: limiters.mailTestGlobal, key: GLOBAL_KEY },
      ]);
      const verdict = guards.check();
      if (verdict.action === 'block') {
        throw new ApiError(429, 'rate_limited', { retryAfterSeconds: retrySeconds(verdict.retryAfterMs) });
      }
      // Every test counts, sent or not: the limit is on how often, not on failures.
      guards.recordFailure();
      const rendered = renderTestMail({
        recipientName: user.displayName,
        publicUrl,
        provider: mail.config.provider === 'resend' ? 'Resend' : 'SMTP',
      });
      const id = await request.withTransaction((trx) =>
        mail.enqueue(trx, {
          template: 'test',
          to: user.email,
          toUserId: user.id,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        }),
      );
      mail.kick();
      void reply.code(202);
      return { id };
    },
  );
}
