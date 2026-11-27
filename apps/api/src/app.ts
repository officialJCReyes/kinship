// SPDX-License-Identifier: AGPL-3.0-or-later
import { WEB_VERSION_HEADER } from '@kinship/shared';
import type { ApiHealth, ApiVersion, MaintenanceStatus, VersionMismatch } from '@kinship/shared';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { csrfCheck } from './auth/csrf.js';
import { FailureLimiter } from './auth/limiter.js';
import { resolveSession } from './auth/store.js';
import type { SessionUser } from './auth/store.js';
import { hashToken } from './auth/tokens.js';
import type { TrustProxy } from './config.js';
import type { Database } from './db.js';
import { ApiError, fromDatabaseError } from './errors.js';
import { withUserTransaction } from './request-context.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes, SESSION_COOKIE, setSessionCookie } from './routes/auth.js';
import { registerLabelRoutes } from './routes/labels.js';
import { registerLinkRoutes } from './routes/links.js';
import { registerPeopleRoutes } from './routes/people.js';
import { sleep } from './routes/shared.js';
import type { RouteLimit } from './routes/shared.js';
import type { Maintenance } from './maintenance.js';
import { registerBackupRoutes } from './routes/backups.js';
import { registerFilesAdminRoutes } from './routes/files-admin.js';
import { registerMediaRoutes } from './routes/media.js';
import type { FilesService } from './files/state.js';
import type { BackupService } from './routes/backups.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerUpdateRoutes } from './routes/updates.js';
import type { UpdatesService } from './routes/updates.js';
import { registerRelationshipRoutes } from './routes/relationship.js';
import { registerTreeRoutes } from './routes/tree.js';
import { registerUnionRoutes } from './routes/unions.js';
import type { VersionInfo } from './version.js';
import { serializeRequest } from './log-redact.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in person, or null. Unauthenticated requests have no user. */
    user: SessionUser | null;
    /** Hash of this request's session token (for sign-out), or null. */
    sessionTokenHash: string | null;
    /** Runs `fn` in a transaction with the signed-in user set for row-level security. */
    withTransaction<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T>;
  }
}

export interface AppOptions {
  /** Maintenance mode for an in-app restore. Without it the gate is off and /api/maintenance always says idle. */
  maintenance?: Maintenance;
  /** The backup scheduler and folder, for Admin > Backups. Without it those routes answer 503. */
  backups?: BackupService;
  /** Stored files (photos): the key and the files folder. Without it Admin says the key is missing. */
  files?: FilesService;
  /** The update check and the bundled changelog, for Admin > Updates and What's new. Without it those routes do not exist. */
  updates?: UpdatesService;
  /** Connected as the app role. */
  db: Kysely<Database>;
  version: VersionInfo;
  logLevel?: string;
  /** Where the log lines go (tests read them); the default is standard output. */
  logStream?: NodeJS.WritableStream;
  sessions: { idleSeconds: number; maxSeconds: number };
  /** Believe X-Forwarded-* headers, and from whom. Off by default. */
  trustProxy?: TrustProxy;
  /** Pause after a failed sign-in or setup attempt, in milliseconds. */
  failureDelayMs?: number;
  /** How an attempt waits out a delay limiter (tests record the wait instead of sleeping). */
  pause?: (ms: number) => Promise<void>;
  /** Clock for the failure limiters (tests). */
  now?: () => number;
  /** Most requests per minute and IP address to sign-in and setup, successful or not. */
  loginRequestsPerMinute?: number;
  /** Most requests per minute and signed-in account to the people, relationship and tree routes. */
  apiRequestsPerMinute?: number;
  /** Photo uploads per signed-in account in ten minutes (default 20). */
  photoUploadsPer10Minutes?: number;
  /** Photo and avatar requests per signed-in account and minute, one bucket for all of them (default 2400). */
  mediaRequestsPerMinute?: number;
}

export interface Limiters {
  /** Failed sign-ins per address and account (normalised email) pair: blocks (ADR 0042). */
  loginPair: FailureLimiter;
  /** Failed sign-ins per IP address, across accounts: blocks. */
  loginIp: FailureLimiter;
  /** Failed sign-ins per account (email), whether or not the account exists: slows down, never blocks (ADR 0042). */
  loginAccount: FailureLimiter;
  /** Failed setup attempts per IP address. */
  setupIp: FailureLimiter;
  /** Failed setup attempts from anywhere. */
  setupGlobal: FailureLimiter;
  /** Links (invitations, set-password links) that did not work, per IP address and from anywhere. */
  linkIp: FailureLimiter;
  linkGlobal: FailureLimiter;
  /** Wrong passwords typed by a signed-in person (password change, backup download ticket, restore): per session, blocks. */
  passwordSession: FailureLimiter;
  /** The same, per account: slows down, never blocks (ADR 0042). */
  passwordAccount: FailureLimiter;
  /** The same, per IP address across accounts: blocks. */
  passwordIp: FailureLimiter;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;
/** The slow-down curve of the delay limiters (ADR 0042): 1 s once past the limit, doubling, at most 10 s. */
export const ACCOUNT_DELAY = { firstMs: 1_000, maxMs: 10_000 } as const;
/** Pair and account keys multiply, so their limiters remember more keys than the others. */
const PAIR_KEYS = 20_000;

export function buildApp(options: AppOptions): FastifyInstance {
  const {
    db,
    version,
    logLevel = 'info',
    logStream,
    sessions,
    failureDelayMs = 300,
    pause = sleep,
    loginRequestsPerMinute = 30,
    apiRequestsPerMinute = 600,
    photoUploadsPer10Minutes = 20,
    mediaRequestsPerMinute = 2400,
  } = options;
  const app = Fastify({
    logger: {
      level: logLevel,
      // The request line without one-time secrets (the backup download ticket is a query parameter: #74).
      serializers: { req: serializeRequest },
      ...(logStream ? { stream: logStream } : {}),
    },
    trustProxy: options.trustProxy ?? false,
    bodyLimit: 64 * 1024,
    // Do not turn a number into a string, or an array into its first item: a request is either the right shape or refused.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: false } },
  });

  const clock = options.now ? { now: options.now } : {};
  const limiters: Limiters = {
    loginPair: new FailureLimiter({ maxFailures: 10, windowMs: FIFTEEN_MINUTES, maxKeys: PAIR_KEYS, ...clock }),
    loginIp: new FailureLimiter({ maxFailures: 30, windowMs: FIFTEEN_MINUTES, ...clock }),
    loginAccount: new FailureLimiter({
      maxFailures: 10,
      windowMs: FIFTEEN_MINUTES,
      mode: 'delay',
      delay: ACCOUNT_DELAY,
      maxKeys: PAIR_KEYS,
      ...clock,
    }),
    setupIp: new FailureLimiter({ maxFailures: 10, windowMs: FIFTEEN_MINUTES, ...clock }),
    setupGlobal: new FailureLimiter({ maxFailures: 30, windowMs: FIFTEEN_MINUTES, ...clock }),
    linkIp: new FailureLimiter({ maxFailures: 20, windowMs: FIFTEEN_MINUTES, ...clock }),
    linkGlobal: new FailureLimiter({
      maxFailures: 200,
      windowMs: FIFTEEN_MINUTES,
      mode: 'delay',
      delay: ACCOUNT_DELAY,
      ...clock,
    }),
    passwordSession: new FailureLimiter({ maxFailures: 10, windowMs: FIFTEEN_MINUTES, ...clock }),
    passwordAccount: new FailureLimiter({
      maxFailures: 10,
      windowMs: FIFTEEN_MINUTES,
      mode: 'delay',
      delay: ACCOUNT_DELAY,
      ...clock,
    }),
    passwordIp: new FailureLimiter({ maxFailures: 20, windowMs: FIFTEEN_MINUTES, ...clock }),
  };

  void app.register(cookie);
  // A plain cap on how often one address may try to sign in or set up, on top of the failure limits
  // above: every attempt costs an argon2 check (19 MiB, tens of milliseconds), successful or not.
  void app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'rate_limited',
      retryAfterSeconds: Math.max(1, Math.ceil(context.ttl / 1000)),
    }),
  });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionTokenHash', null);
  app.decorateRequest('withTransaction', function withTransaction<
    T,
  >(this: FastifyRequest, fn: (trx: Transaction<Database>) => Promise<T>) {
    return withUserTransaction(db, this.user?.id ?? null, fn);
  });

  // The maintenance gate (ADR 0031), first of all. While an in-app restore pauses the site, everything but these three answers 503
  // "maintenance". A request that gets past it is counted until it ends, so the restore can wait for it before the pool is closed.
  const maintenance = options.maintenance;
  if (maintenance) {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0];
      if (path === '/api/health' || path === '/api/version' || path === '/api/maintenance') return;
      if (maintenance.active()) {
        void reply.header('Cache-Control', 'no-store').header('Retry-After', '5');
        return reply.code(503).send({ error: 'maintenance', phase: maintenance.phase() });
      }
      const end = maintenance.begin();
      reply.raw.once('close', end);
    });
  }

  // 0. The web container and this api must be the same version (ADR 0015). nginx adds the web's version to every request it passes
  // on; a different one gets a 503 for everything except the health and version checks, so a half-updated install fails loudly
  // instead of misbehaving. A request without the header (the dev server, a script) is not checked.
  const web = { version: null as string | null, warned: false };
  app.addHook('onRequest', async (request, reply) => {
    const raw = request.headers[WEB_VERSION_HEADER];
    const reported = typeof raw === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(raw) ? raw : null;
    if (reported) web.version = reported;
    if (!reported || reported === version.version) return;
    const path = request.url.split('?')[0];
    if (path === '/api/health' || path === '/api/version') return;
    if (!web.warned) {
      web.warned = true;
      request.log.error(
        { web: reported, api: version.version },
        'the web container and the api are on different versions; answering 503 until they match',
      );
    }
    void reply.header('Cache-Control', 'no-store');
    return reply
      .code(503)
      .send({ error: 'version_mismatch', web: reported, api: version.version } satisfies VersionMismatch);
  });

  // 1. State-changing requests need the CSRF header and a matching Origin.
  app.addHook('onRequest', csrfCheck);

  // 2. Who is this? A valid session cookie gives a user; anything else gives none.
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const tokenHash = hashToken(token);
    const resolved = await resolveSession(db, tokenHash, sessions.idleSeconds);
    if (!resolved) {
      void reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    request.user = resolved.user;
    request.sessionTokenHash = tokenHash;
    if (resolved.renewed) setSessionCookie(request, reply, token, resolved.expiresAt);
  });

  app.setErrorHandler((error, request, reply) => {
    // Rules the API (or the database) enforces answer with their own code.
    const known = error instanceof ApiError ? error : fromDatabaseError(error);
    if (known) return reply.code(known.status).send({ error: known.code, ...known.extra });
    // Mistakes by the caller (bad JSON, empty body, too large, wrong shape) stay 4xx; anything else is ours.
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 429) {
      const retry =
        typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
          ? Number(error.retryAfterSeconds)
          : 60;
      return reply.code(429).send({ error: 'rate_limited', retryAfterSeconds: retry });
    }
    const invalidShape =
      typeof error === 'object' && error !== null && 'validation' in error && Boolean(error.validation);
    if (invalidShape || (status >= 400 && status < 500)) {
      return reply
        .code(invalidShape ? 400 : status)
        .send({ error: status === 413 ? 'payload_too_large' : 'invalid_request' });
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/api/health', async (request, reply) => {
    // During an in-app restore the app's database pool is closed on purpose: 200, so nothing restarts the container.
    if (maintenance?.active()) return { status: 'maintenance', database: 'ok' } satisfies ApiHealth;
    try {
      await sql`select 1`.execute(db);
      return { status: 'ok', database: 'ok' } satisfies ApiHealth;
    } catch (error) {
      request.log.error({ err: error }, 'health check: database unreachable');
      return reply.code(503).send({ status: 'unavailable', database: 'unreachable' } satisfies ApiHealth);
    }
  });

  // Public, no database, no session: people are signed out during a restore. Phase and time, and how the last restore ended.
  void app.register(async (routes) => {
    routes.get(
      '/api/maintenance',
      { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (_request, reply): Promise<MaintenanceStatus> => {
        void reply.header('Cache-Control', 'no-store');
        return maintenance?.status() ?? { phase: 'idle', since: null };
      },
    );
  });

  // Public. The schema number comes from the database; if that is unreachable the version still answers.
  app.get('/api/version', async (request) => {
    let schema: number | null = null;
    try {
      const result = await sql<{ schema_number: number }>`select schema_number from schema_info`.execute(db);
      schema = result.rows[0]?.schema_number ?? null;
    } catch (error) {
      request.log.warn({ err: error }, 'version: could not read the schema number');
    }
    const body: ApiVersion = { ...version, schema, webVersion: web.version };
    return body;
  });

  // Registered after the rate-limit plugin, so the routes below can use its per-route settings.
  const requestLimit = { max: loginRequestsPerMinute, timeWindow: '1 minute' };
  void app.register(async (routes) => {
    registerSetupRoutes(routes, { db, sessions, limiters, failureDelayMs, pause, requestLimit });
    registerAuthRoutes(routes, { db, sessions, limiters, failureDelayMs, pause, requestLimit });
  });
  // Own scope: the links routes set their own hooks (never cached).
  void app.register(async (routes) => {
    registerLinkRoutes(routes, { db, sessions, limiters, failureDelayMs, pause, requestLimit });
  });

  // People, relationships and the tree: everything here needs a signed-in account.
  void app.register(async (routes) => {
    routes.addHook('onRequest', async (request) => {
      if (!request.user) throw new ApiError(401, 'unauthenticated');
    });
    // Per account, not per address: behind a reverse proxy every visitor can share one address.
    const limit: RouteLimit = {
      rateLimit: {
        max: apiRequestsPerMinute,
        timeWindow: '1 minute',
        keyGenerator: (request) => request.user?.id ?? request.ip,
      },
    };
    // Own scope: the admin routes add an admin-only check and "never cache" to every route registered with them.
    void routes.register(async (admin) => registerAdminRoutes(admin, limit));
    // Own scope: SuperAdmin only, never cached.
    void routes.register(async (backups) =>
      registerBackupRoutes(backups, limit, { db, limiters, failureDelayMs, pause }, options.backups),
    );
    // Own scope: SuperAdmin only, never cached.
    void routes.register(async (files) => registerFilesAdminRoutes(files, limit, options.files));
    // Own scope: the update routes check their own roles (SuperAdmin, and for What's new any admin) and are never cached.
    if (options.updates) {
      const service = options.updates;
      void routes.register(async (updates) =>
        registerUpdateRoutes(updates, limit, { version, webVersion: () => web.version, service }),
      );
    }
    // Own scope: it adds a parser for raw pictures that no other route should accept.
    void routes.register(async (media) =>
      registerMediaRoutes(media, {
        files: options.files,
        uploadsPer10Minutes: photoUploadsPer10Minutes,
        mediaRequestsPerMinute,
      }),
    );
    registerPeopleRoutes(routes, limit, options.files);
    registerUnionRoutes(routes, limit);
    registerLabelRoutes(routes, limit);
    registerTreeRoutes(routes, limit);
    registerRelationshipRoutes(routes, limit);
  });

  return app;
}
