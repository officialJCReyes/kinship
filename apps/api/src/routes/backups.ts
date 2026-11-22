// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin > Backups (SuperAdmin only, checked here on every route). Backups themselves run in the scheduler (and the command line);
// these routes list, start, test, change the schedule, hand out downloads, and restore (ADR 0031): a check that changes nothing,
// then a restore that needs the ticket from the check, the typed word and the password again, pauses the site, replaces
// everything and exits so Docker starts a fresh api.
import { createReadStream, lstatSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { BACKUP_TICKET_SECONDS, parseBackupSettings, RESTORE_TICKET_SECONDS, RESTORE_WORD } from '@kinship/shared';
import type {
  BackupListItem,
  BackupSettings,
  BackupsResponse,
  BackupStarted,
  DownloadTicket,
  DownloadTicketRequest,
  RestoreCheck,
  RestoreCheckRequest,
  RestoreRequest,
} from '@kinship/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MAX_PASSWORD_LENGTH, verifyPassword } from '../auth/passwords.js';
import { requireSuperAdmin } from '../auth/guards.js';
import { findLogin } from '../auth/store.js';
import { listBackups } from '../backup/archive.js';
import type { Scheduler } from '../backup/scheduler.js';
import { BackupError } from '../backup/errors.js';
import { BackupFormatError } from '../backup/format.js';
import { errorKindOf, RestoreRefused, safeDetail } from '../backup/restore-service.js';
import type { RestoreService } from '../backup/restore-service.js';
import { readBackupSettings, writeBackupSettings } from '../backup/settings.js';
import { readState } from '../backup/state.js';
import { ApiError } from '../errors.js';
import { retrySeconds, sleep } from './shared.js';
import type { RouteDeps, RouteLimit } from './shared.js';

/** What the routes need from the running api: the scheduler (which owns "one at a time") and the backups folder. */
export interface BackupService {
  scheduler: Scheduler;
  dir: string;
  /** Restoring from the app (ADR 0031). Without it the restore routes answer 503 backup_unavailable. */
  restore?: RestoreService;
}

interface Refusal {
  status: 400 | 429;
  body: Record<string, unknown>;
  retryAfter?: number;
}

interface RestoreTicket {
  userId: string;
  sessionTokenHash: string;
  name: string;
  expires: number;
}

interface Ticket {
  userId: string;
  sessionTokenHash: string;
  file: string;
  expires: number;
}

const unavailable = () => new ApiError(503, 'backup_unavailable');
const notFound = () => new ApiError(404, 'backup_not_found');
const ticketKey = (ticket: string) => createHash('sha256').update(ticket).digest('hex');

export function registerBackupRoutes(
  app: FastifyInstance,
  limit: RouteLimit,
  deps: Pick<RouteDeps, 'db' | 'limiters' | 'failureDelayMs'>,
  service: BackupService | undefined,
  now: () => number = () => Date.now(),
): void {
  const { db, limiters, failureDelayMs } = deps;
  const tickets = new Map<string, Ticket>();
  // Everything here is SuperAdmin only, and nothing here is ever cached.
  app.addHook('onRequest', async (request) => {
    requireSuperAdmin(request);
  });
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
  });
  const need = (): BackupService => {
    if (!service) throw unavailable();
    return service;
  };
  // The signed-in person types their password again. It shares the failure limiters of changing a password. Returns why it was not
  // accepted (to send as the answer), or null when it was. It returns a plain value, never the reply: a reply is "thenable", and an
  // async function that returns one waits for it and loses it.
  const reauthenticate = async (
    request: FastifyRequest,
    user: { id: string; email: string },
    password: string,
  ): Promise<Refusal | null> => {
    const wait = Math.max(limiters.passwordIp.retryAfterMs(request.ip), limiters.passwordAccount.retryAfterMs(user.id));
    if (wait > 0) {
      const seconds = retrySeconds(wait);
      return { status: 429, retryAfter: seconds, body: { error: 'rate_limited', retryAfterSeconds: seconds } };
    }
    const login = await findLogin(db, user.email);
    if (!login || login.userId !== user.id || !(await verifyPassword(login.passwordHash, password))) {
      limiters.passwordIp.recordFailure(request.ip);
      limiters.passwordAccount.recordFailure(user.id);
      await sleep(failureDelayMs);
      return { status: 400, body: { error: 'invalid_current_password' } };
    }
    limiters.passwordAccount.reset(user.id);
    return null;
  };
  const refuse = (reply: FastifyReply, refusal: Refusal): FastifyReply => {
    if (refusal.retryAfter !== undefined) void reply.header('Retry-After', String(refusal.retryAfter));
    return reply.code(refusal.status).send(refusal.body);
  };
  const sweepTickets = () => {
    for (const [key, ticket] of tickets) if (ticket.expires <= now()) tickets.delete(key);
  };

  app.get('/api/admin/backups', { config: limit }, async (): Promise<BackupsResponse> => {
    const { scheduler, dir } = need();
    const status = await scheduler.status();
    const state = readState(dir);
    const backups: BackupListItem[] = listBackups(dir).map((item) => ({
      name: item.name,
      kind: item.kind,
      encrypted: item.encrypted,
      bytes: item.bytes,
      modifiedAt: item.modified.toISOString(),
      ...(item.header ? { appVersion: item.header.appVersion, schema: item.header.schema } : {}),
      tested: state.lastTest && state.lastTest.file === item.name ? (state.lastTest.ok ? 'ok' : 'failed') : null,
    }));
    return { status, backups };
  });

  // Starts a backup in the background. At most one runs at a time (and the command line shares the lock).
  app.post('/api/admin/backups', { config: limit }, async (_request, reply): Promise<BackupStarted> => {
    if (!need().scheduler.startRun()) throw new ApiError(409, 'backup_busy');
    void reply.code(202);
    return { started: true };
  });

  app.post('/api/admin/backups/test', { config: limit }, async (_request, reply): Promise<BackupStarted> => {
    if (!need().scheduler.startTest()) throw new ApiError(409, 'backup_busy');
    void reply.code(202);
    return { started: true };
  });

  app.get('/api/admin/backups/settings', { config: limit }, async (request): Promise<BackupSettings> => {
    need();
    return request.withTransaction((trx) => readBackupSettings(trx));
  });

  // Any non-empty subset, checked by the shared parsers. Written as the SuperAdmin (the policy on app_settings checks again).
  app.patch(
    '/api/admin/backups/settings',
    { config: limit, schema: { body: { type: 'object', minProperties: 1, additionalProperties: true } } },
    async (request): Promise<BackupSettings> => {
      need();
      const user = request.user;
      const parsed = parseBackupSettings(request.body);
      if (!parsed.ok) throw new ApiError(400, parsed.code, { field: parsed.field });
      return request.withTransaction(async (trx) => {
        await writeBackupSettings(trx, parsed.settings, user?.id ?? null);
        return readBackupSettings(trx);
      });
    },
  );

  // Download, step 1: the SuperAdmin types their password again (it shares the failure limiter of changing a password), and gets a
  // one-time ticket for one encrypted archive, good for 30 seconds, tied to this session.
  app.post(
    '/api/admin/backups/download-ticket',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['name', 'password'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 128 },
            password: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
          },
        },
      },
    },
    async (request, reply): Promise<DownloadTicket> => {
      const { dir } = need();
      const user = request.user;
      const sessionTokenHash = request.sessionTokenHash;
      if (!user || !sessionTokenHash) throw new ApiError(401, 'unauthenticated');
      const body = request.body as DownloadTicketRequest;

      const refused = await reauthenticate(request, user, body.password);
      if (refused) return refuse(reply, refused) as never;

      // The name must be one of OUR encrypted archives found by listing the folder; user input is never joined into a path.
      const found = listBackups(dir).find((item) => item.name === body.name && item.encrypted);
      if (!found) throw notFound();
      sweepTickets();
      const ticket = randomBytes(32).toString('base64url');
      const expires = now() + BACKUP_TICKET_SECONDS * 1000;
      tickets.set(ticketKey(ticket), { userId: user.id, sessionTokenHash, file: found.name, expires });
      return { ticket, expiresAt: new Date(expires).toISOString() };
    },
  );

  // Download, step 2: the ticket is spent on first use, whoever uses it and whatever else is wrong with the request.
  app.get(
    '/api/admin/backups/download',
    {
      config: limit,
      schema: {
        querystring: {
          type: 'object',
          required: ['ticket'],
          additionalProperties: false,
          properties: { ticket: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const { dir } = need();
      const { ticket } = request.query as { ticket: string };
      const key = ticketKey(ticket);
      const found = tickets.get(key);
      tickets.delete(key);
      if (
        !found ||
        found.expires <= now() ||
        found.userId !== request.user?.id ||
        found.sessionTokenHash !== request.sessionTokenHash
      ) {
        throw notFound();
      }
      const item = listBackups(dir).find((i) => i.name === found.file && i.encrypted);
      if (!item) throw notFound();
      const path = join(dir, item.name);
      const info = lstatSync(path);
      if (!info.isFile()) throw notFound();
      void reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', String(info.size))
        .header('Content-Disposition', `attachment; filename="${item.name}"`)
        .header('X-Content-Type-Options', 'nosniff');
      return reply.send(createReadStream(path));
    },
  );
  // ---- Restore from the app (ADR 0031). Two steps: the check changes nothing; the restore needs the ticket, the typed word and the
  // password again, and then pauses the site, replaces everything, and restarts the api. ----
  const restoreTickets = new Map<string, RestoreTicket>();
  const sweepRestoreTickets = () => {
    for (const [key, ticket] of restoreTickets) if (ticket.expires <= now()) restoreTickets.delete(key);
  };
  const needRestore = (): RestoreService => {
    const restore = need().restore;
    if (!restore) throw unavailable();
    return restore;
  };
  /** A refusal or failure of the check or the start, as an API answer: a code, and a sentence only when it holds no path. */
  const restoreProblem = (error: unknown): never => {
    if (error instanceof ApiError) throw error;
    if (error instanceof RestoreRefused) {
      if (error.code === 'not_found') throw notFound();
      if (error.code === 'unavailable') throw unavailable();
      throw new ApiError(409, 'restore_busy', { errorKind: error.code });
    }
    if (error instanceof BackupError && error.kind === 'busy') throw new ApiError(409, 'backup_busy');
    if (error instanceof BackupError || error instanceof BackupFormatError) {
      const detail = safeDetail(error);
      throw new ApiError(400, 'restore_failed', { errorKind: errorKindOf(error), ...(detail ? { detail } : {}) });
    }
    throw error;
  };

  app.post(
    '/api/admin/backups/restore-check',
    {
      // Opening and verifying an archive takes a moment of CPU (the passphrase key, the SHA-256 of the dump): a tighter limit.
      config: { rateLimit: { ...limit.rateLimit, max: 6 } },
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', maxLength: 128 } },
        },
      },
    },
    async (request): Promise<RestoreCheck> => {
      const restore = needRestore();
      const user = request.user;
      const sessionTokenHash = request.sessionTokenHash;
      if (!user || !sessionTokenHash) throw new ApiError(401, 'unauthenticated');
      const { name } = request.body as RestoreCheckRequest;
      const facts = await restore.check(name).catch(restoreProblem);
      // Was this account created after the backup was made? Then it is not in the backup.
      const mine = await request.withTransaction((trx) =>
        trx.selectFrom('users').select('created_at').where('id', '=', user.id).executeTakeFirst(),
      );
      const ownAccountMissing = mine ? mine.created_at.getTime() > new Date(facts.createdAt).getTime() : false;
      sweepRestoreTickets();
      const ticket = randomBytes(32).toString('base64url');
      const expires = now() + RESTORE_TICKET_SECONDS * 1000;
      restoreTickets.set(ticketKey(ticket), { userId: user.id, sessionTokenHash, name, expires });
      return {
        ticket,
        expiresAt: new Date(expires).toISOString(),
        name,
        createdAt: facts.createdAt,
        appVersion: facts.appVersion,
        schema: facts.manifest.schema,
        pendingMigrations: facts.pendingMigrations,
        newerApp: facts.newerApp,
        accounts: facts.accounts,
        ownAccountMissing,
      };
    },
  );

  app.post(
    '/api/admin/backups/restore',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['ticket', 'word', 'password'],
          additionalProperties: false,
          properties: {
            ticket: { type: 'string', maxLength: 100 },
            word: { type: 'string', maxLength: 32 },
            password: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const restore = needRestore();
      const user = request.user;
      const sessionTokenHash = request.sessionTokenHash;
      if (!user || !sessionTokenHash) throw new ApiError(401, 'unauthenticated');
      const body = request.body as RestoreRequest;
      // Checked here, not only by the button: the word, then the password. Neither spends the ticket.
      if (body.word !== RESTORE_WORD) throw new ApiError(400, 'invalid_restore_word');
      const refused = await reauthenticate(request, user, body.password);
      if (refused) return refuse(reply, refused);
      const key = ticketKey(body.ticket);
      const found = restoreTickets.get(key);
      restoreTickets.delete(key);
      if (!found || found.expires <= now() || found.userId !== user.id || found.sessionTokenHash !== sessionTokenHash) {
        throw new ApiError(400, 'restore_ticket_invalid');
      }
      await restore.start({ name: found.name, userId: user.id }).catch(restoreProblem);
      return reply.code(202).send({ started: true });
    },
  );
}
