// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SetupRequest } from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import { checkSetupToken, completeSetup, needsSetup, SETUP_ALREADY_DONE, SETUP_INVALID_TOKEN } from '../auth/store.js';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';
import { hashToken } from '../auth/tokens.js';
import { ApiError } from '../errors.js';
import { cleanName } from '../people/names.js';
import { readMe, startSession } from './auth.js';
import { isValidEmail, normalizeEmail, retrySeconds, sleep } from './shared.js';
import type { RouteDeps } from './shared.js';

const GLOBAL_KEY = 'setup';

function sqlState(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

export function registerSetupRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, limiters, failureDelayMs, requestLimit } = deps;

  app.get('/api/setup/status', async () => ({ needsSetup: await needsSetup(db) }));

  app.post(
    '/api/setup',
    {
      config: { rateLimit: requestLimit },
      schema: {
        body: {
          type: 'object',
          required: ['token', 'email', 'displayName', 'password', 'treeName'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', maxLength: 256 },
            email: { type: 'string', maxLength: 320 },
            displayName: { type: 'string', maxLength: 200 },
            password: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
            treeName: { type: 'string', maxLength: 200 },
            person: {
              type: 'object',
              required: ['givenName', 'surname'],
              additionalProperties: false,
              properties: {
                givenName: { type: 'string', maxLength: 400 },
                surname: { type: 'string', maxLength: 400 },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as SetupRequest;

      // Fails closed: once an account exists this endpoint only ever says no.
      if (!(await needsSetup(db))) return reply.code(409).send({ error: 'already_set_up' });

      const wait = Math.max(limiters.setupIp.retryAfterMs(request.ip), limiters.setupGlobal.retryAfterMs(GLOBAL_KEY));
      if (wait > 0) {
        const seconds = retrySeconds(wait);
        return reply
          .code(429)
          .header('Retry-After', String(seconds))
          .send({ error: 'rate_limited', retryAfterSeconds: seconds });
      }

      const rejectToken = async () => {
        // Another attempt may have finished setup between our first check and now (the token is
        // deleted with it). That is "already set up", not a bad guess, and it must not count as one.
        if (!(await needsSetup(db))) return reply.code(409).send({ error: 'already_set_up' });
        limiters.setupIp.recordFailure(request.ip);
        limiters.setupGlobal.recordFailure(GLOBAL_KEY);
        await sleep(failureDelayMs);
        return reply.code(403).send({ error: 'invalid_setup_token' });
      };

      // Token first, before any other check or any password hashing.
      const tokenHash = hashToken(body.token.trim());
      if (!(await checkSetupToken(db, tokenHash))) return rejectToken();

      const email = normalizeEmail(body.email);
      const displayName = body.displayName.trim();
      const treeName = body.treeName.trim();
      if (!isValidEmail(email)) return reply.code(400).send({ error: 'invalid_email' });
      if (displayName.length < 1) return reply.code(400).send({ error: 'invalid_display_name' });
      if (treeName.length < 1) return reply.code(400).send({ error: 'invalid_tree_name' });
      if (body.password.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({ error: 'password_too_short', minLength: MIN_PASSWORD_LENGTH });
      }

      let person: { givenName: string; surname: string } | undefined;
      if (body.person) {
        try {
          person = {
            givenName: cleanName(body.person.givenName, 'invalid_given_name'),
            surname: cleanName(body.person.surname, 'invalid_surname'),
          };
        } catch (error) {
          if (error instanceof ApiError) return reply.code(error.status).send({ error: error.code });
          throw error;
        }
      }

      let userId: string;
      try {
        userId = await completeSetup(db, {
          tokenHash,
          email,
          displayName,
          passwordHash: await hashPassword(body.password),
          treeName,
          person,
        });
      } catch (error) {
        const code = sqlState(error);
        if (code === SETUP_ALREADY_DONE) return reply.code(409).send({ error: 'already_set_up' });
        if (code === SETUP_INVALID_TOKEN) return rejectToken();
        throw error;
      }

      await startSession(deps, request, reply, userId);
      return reply.code(201).send(await readMe(db, userId));
    },
  );
}
