// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from './db.js';
import { STUB_USER, assertStubUserAllowed, withUserTransaction } from './request-context.js';
import type { RequestUser } from './request-context.js';
import type { VersionInfo } from './version.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user. A stub for now; null will mean "not signed in". */
    user: RequestUser | null;
    /** Runs `fn` in a transaction with the signed-in user set for row-level security. */
    withTransaction<T>(fn: (trx: Transaction<Database>) => Promise<T>): Promise<T>;
  }
}

export interface AppOptions {
  /** Connected as the app role. */
  db: Kysely<Database>;
  version: VersionInfo;
  /** NODE_ENV. The stub user is refused in "production" (TODO(auth): remove with the stub). */
  nodeEnv: string;
  logLevel?: string;
}

export function buildApp({ db, version, nodeEnv, logLevel = 'info' }: AppOptions): FastifyInstance {
  assertStubUserAllowed(nodeEnv); // TODO(auth): remove with the stub
  const app = Fastify({ logger: { level: logLevel } });

  app.decorateRequest('user', null);
  app.decorateRequest('withTransaction', function withTransaction<
    T,
  >(this: { user: RequestUser | null }, fn: (trx: Transaction<Database>) => Promise<T>) {
    return withUserTransaction(db, this.user?.id ?? null, fn);
  });
  app.addHook('onRequest', (request, _reply, done) => {
    request.user = STUB_USER; // TODO(auth)
    done();
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

  app.get('/api/version', () => version);

  return app;
}
