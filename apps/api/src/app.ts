// SPDX-License-Identifier: AGPL-3.0-or-later
import cookie from '@fastify/cookie';
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
import { withUserTransaction } from './request-context.js';
import { registerAuthRoutes, SESSION_COOKIE, setSessionCookie } from './routes/auth.js';
import { registerSetupRoutes } from './routes/setup.js';
import type { VersionInfo } from './version.js';

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
  /** Connected as the app role. */
  db: Kysely<Database>;
  version: VersionInfo;
  logLevel?: string;
  sessions: { idleSeconds: number; maxSeconds: number };
  /** Believe X-Forwarded-* headers, and from whom. Off by default. */
  trustProxy?: TrustProxy;
  /** Pause after a failed sign-in or setup attempt, in milliseconds. */
  failureDelayMs?: number;
  /** Clock for the rate limiters (tests). */
  now?: () => number;
}

export interface Limiters {
  /** Failed sign-ins per IP address. */
  loginIp: FailureLimiter;
  /** Failed sign-ins per account (email), whether or not the account exists. */
  loginAccount: FailureLimiter;
  /** Failed setup attempts per IP address. */
  setupIp: FailureLimiter;
  /** Failed setup attempts from anywhere. */
  setupGlobal: FailureLimiter;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function buildApp(options: AppOptions): FastifyInstance {
  const { db, version, logLevel = 'info', sessions, failureDelayMs = 300 } = options;
  const app = Fastify({
    logger: { level: logLevel },
    trustProxy: options.trustProxy ?? false,
    bodyLimit: 64 * 1024,
    // Do not turn a number into a string, or an array into its first item: a request is either the right shape or refused.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: false } },
  });

  const clock = options.now ? { now: options.now } : {};
  const limiters: Limiters = {
    loginIp: new FailureLimiter({ maxFailures: 20, windowMs: FIFTEEN_MINUTES, ...clock }),
    loginAccount: new FailureLimiter({ maxFailures: 10, windowMs: FIFTEEN_MINUTES, ...clock }),
    setupIp: new FailureLimiter({ maxFailures: 10, windowMs: FIFTEEN_MINUTES, ...clock }),
    setupGlobal: new FailureLimiter({ maxFailures: 30, windowMs: FIFTEEN_MINUTES, ...clock }),
  };

  void app.register(cookie);

  app.decorateRequest('user', null);
  app.decorateRequest('sessionTokenHash', null);
  app.decorateRequest('withTransaction', function withTransaction<
    T,
  >(this: FastifyRequest, fn: (trx: Transaction<Database>) => Promise<T>) {
    return withUserTransaction(db, this.user?.id ?? null, fn);
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
    // Mistakes by the caller (bad JSON, empty body, too large, wrong shape) stay 4xx; anything else is ours.
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
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
    try {
      await sql`select 1`.execute(db);
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      request.log.error({ err: error }, 'health check: database unreachable');
      return reply.code(503).send({ status: 'unavailable', database: 'unreachable' });
    }
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
    return { ...version, schema };
  });

  registerSetupRoutes(app, { db, sessions, limiters, failureDelayMs });
  registerAuthRoutes(app, { db, sessions, limiters, failureDelayMs });

  return app;
}
