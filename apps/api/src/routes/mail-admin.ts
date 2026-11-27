// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin -> Storage & email: whether email is set up, how, what the outbox holds, and "Send test to me" (ADR 0041). Admin ->
// Emails (53b): the templates, their editable text, a preview of a draft and a test of the saved text. SuperAdmin only, never
// cached. Nothing secret is ever answered: a key or a password is only "set". A test goes to the signed-in SuperAdmin's own
// address and nowhere else; a request that names any other recipient is refused. A preview is rendered with the Hale sample
// and a link that goes nowhere: it never creates an invitation, a reset or an outbox row.
import { MAIL_RESERVED_TEMPLATE_IDS, MAIL_TEMPLATE_IDS } from '@kinship/shared';
import type {
  MailFailure,
  MailPreview,
  MailStatus,
  MailTemplateDetail,
  MailTemplateId,
  MailTemplateSummary,
  MailTestResult,
  MailTestStarted,
} from '@kinship/shared';
import { sql } from 'kysely';
import type { Transaction } from 'kysely';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Limiters } from '../app.js';
import type { Database } from '../db.js';
import { GuardSet } from '../auth/limiter.js';
import { requireSuperAdmin } from '../auth/guards.js';
import { ApiError, badRequest, conflict, notFound } from '../errors.js';
import { hintFor } from '../mail/clean-error.js';
import { loadOverrides } from '../mail/enqueue.js';
import type { MailService } from '../mail/outbox.js';
import { describeFields, render } from '../mail/render.js';
import type { RenderedMail } from '../mail/render.js';
import { checkDraft, isTemplateId, TEMPLATES, templateDef } from '../mail/templates/index.js';
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

  const testLimit = { config: { rateLimit: { ...limit.rateLimit, max: deps.testRequestsPerMinute } } };

  /** Queues a test to the signed-in SuperAdmin, through the test limits. The recipient is never read from the request. */
  async function sendTest(
    request: FastifyRequest,
    reply: FastifyReply,
    renderFor: (name: string, provider: string, trx: Transaction<Database>) => Promise<RenderedMail> | RenderedMail,
  ): Promise<MailTestStarted> {
    // Anything in the body (an address above all) is refused; a query parameter is ignored.
    refuseBody(request.body);
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
    const provider = mail.config.provider === 'resend' ? 'Resend' : 'SMTP';
    const id = await request.withTransaction(async (trx) => {
      const rendered = await renderFor(user.displayName, provider, trx);
      return mail.enqueue(trx, {
        template: 'test',
        to: user.email,
        toUserId: user.id,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    });
    mail.kick();
    void reply.code(202);
    return { id };
  }

  app.post('/api/admin/mail/test', testLimit, async (request, reply) =>
    sendTest(request, reply, (name, provider) => render(TEMPLATES.test, { name, provider }, {}, publicUrl)),
  );

  // ---- Templates (53b) --------------------------------------------------------------------------------------------------

  /** The template the path names; a reserved ("Next") or unknown id is not found. */
  function templateOf(request: FastifyRequest): MailTemplateId {
    const { id } = request.params as { id: string };
    if (!isTemplateId(id)) throw notFound('mail_template_not_found');
    return id;
  }

  function editable(id: MailTemplateId): void {
    if (!templateDef(id).editable) throw conflict('mail_template_fixed');
  }

  async function detail(request: FastifyRequest, id: MailTemplateId): Promise<MailTemplateDetail> {
    const def = templateDef(id);
    const overrides = def.editable ? await request.withTransaction((trx) => loadOverrides(trx, id)) : {};
    return { id, editable: def.editable, fields: describeFields(def), overrides };
  }

  /** The body `{ fields: { key: text } }`, checked; 400 invalid_template with every problem. */
  function draftOf(id: MailTemplateId, body: unknown): Record<string, string> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('invalid_request');
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'fields') throw badRequest('invalid_request');
    const { problems, changed } = checkDraft(templateDef(id), (body as { fields: unknown }).fields);
    if (problems.length > 0) throw badRequest('invalid_template', { problems });
    return changed;
  }

  /** Saves the changed fields (or removes the row when nothing differs from the defaults). */
  async function save(request: FastifyRequest, id: MailTemplateId, changed: Record<string, string>): Promise<void> {
    const { subject, ...blocks } = changed;
    await request.withTransaction(async (trx) => {
      if (Object.keys(changed).length === 0) {
        await sql`delete from mail_template_overrides where template = ${id}`.execute(trx);
        return;
      }
      await sql`
        insert into mail_template_overrides (template, subject, blocks, updated_by, updated_at)
        values (${id}, ${subject ?? null}, ${JSON.stringify(blocks)}::jsonb, ${request.user!.id}, now())
        on conflict (template) do update
          set subject = excluded.subject, blocks = excluded.blocks, updated_by = excluded.updated_by,
              updated_at = excluded.updated_at`.execute(trx);
    });
  }

  app.get('/api/admin/mail/templates', { config: limit }, async (request): Promise<MailTemplateSummary[]> => {
    const saved = await request.withTransaction(async (trx) => {
      const result = await sql<{ template: string }>`select template from mail_template_overrides`.execute(trx);
      return new Set(result.rows.map((row) => row.template));
    });
    return [
      ...MAIL_TEMPLATE_IDS.map((id) => ({
        id,
        editable: templateDef(id).editable,
        reserved: false,
        overridden: templateDef(id).editable && saved.has(id),
      })),
      ...MAIL_RESERVED_TEMPLATE_IDS.map((id) => ({ id, editable: false, reserved: true, overridden: false })),
    ];
  });

  app.get('/api/admin/mail/templates/:id', { config: limit }, async (request) => detail(request, templateOf(request)));

  app.put('/api/admin/mail/templates/:id', { config: limit }, async (request) => {
    const id = templateOf(request);
    editable(id);
    await save(request, id, draftOf(id, request.body));
    return detail(request, id);
  });

  /** Reset to default: the whole template, or one field with `?field=<key>`. */
  app.delete('/api/admin/mail/templates/:id', { config: limit }, async (request) => {
    const id = templateOf(request);
    editable(id);
    const { field } = request.query as { field?: unknown };
    if (field === undefined) {
      await save(request, id, {});
    } else {
      if (typeof field !== 'string' || !templateDef(id).fields.some((spec) => spec.key === field)) {
        throw badRequest('invalid_request');
      }
      const rest = await request.withTransaction((trx) => loadOverrides(trx, id));
      delete rest[field];
      await save(request, id, rest);
    }
    return detail(request, id);
  });

  /** A draft (or, with no body, the saved text) rendered with the Hale sample. Nothing is saved, queued or created. */
  app.post('/api/admin/mail/templates/:id/preview', { config: limit }, async (request): Promise<MailPreview> => {
    const id = templateOf(request);
    const def = templateDef(id);
    const empty = request.body === undefined || request.body === null;
    const overrides = empty
      ? await request.withTransaction((trx) => loadOverrides(trx, id))
      : draftOf(id, request.body);
    return render(def, def.sample(publicUrl.replace(/\/+$/, '')), overrides, publicUrl);
  });

  /** The saved text, with the Hale sample, to the signed-in SuperAdmin ("Test: " in front of the subject). */
  app.post('/api/admin/mail/templates/:id/test', testLimit, async (request, reply) => {
    const id = templateOf(request);
    const def = templateDef(id);
    return sendTest(request, reply, async (name, provider, trx) => {
      if (id === 'test') return render(TEMPLATES.test, { name, provider }, {}, publicUrl);
      const overrides = await loadOverrides(trx, id);
      const rendered = render(def, def.sample(publicUrl.replace(/\/+$/, '')), overrides, publicUrl);
      return { ...rendered, subject: `Test: ${rendered.subject}` };
    });
  });
}

/** A test send takes no body at all: an empty object at most. */
function refuseBody(body: unknown): void {
  if (body !== undefined && body !== null && (typeof body !== 'object' || Object.keys(body).length > 0)) {
    throw new ApiError(400, 'invalid_request');
  }
}
