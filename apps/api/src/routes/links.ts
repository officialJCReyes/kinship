// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AcceptLinkRequest, LinkLookup, LinkLookupRequest } from '@kinship/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { acceptInvitation, lookupLink } from '../auth/links.js';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';
import { hashToken } from '../auth/tokens.js';
import { ApiError, fromDatabaseError } from '../errors.js';
import { readMe, startSession } from './auth.js';
import { retrySeconds, sleep } from './shared.js';
import type { RouteDeps } from './shared.js';

const GLOBAL_KEY = 'links';
const tokenSchema = { type: 'string', minLength: 1, maxLength: 256 };

/**
 * The public side of invitations and set-password links. The token is in the BODY (never a URL, so it is in no
 * access log), the responses are never cached, and every kind of bad link (unknown, expired, used, revoked) gets
 * the identical 404 { error: 'invalid_link' } after one indexed lookup. The token is checked before any password is hashed.
 */
export function registerLinkRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, limiters, failureDelayMs, requestLimit } = deps;

  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
  });

  const tooMany = (request: FastifyRequest, reply: FastifyReply) => {
    const wait = Math.max(limiters.linkIp.retryAfterMs(request.ip), limiters.linkGlobal.retryAfterMs(GLOBAL_KEY));
    if (wait <= 0) return undefined;
    const seconds = retrySeconds(wait);
    return reply
      .code(429)
      .header('Retry-After', String(seconds))
      .send({ error: 'rate_limited', retryAfterSeconds: seconds });
  };

  /** The one answer for any link that does not work. It counts as a failure and costs a short pause. */
  const invalidLink = async (request: FastifyRequest, reply: FastifyReply) => {
    limiters.linkIp.recordFailure(request.ip);
    limiters.linkGlobal.recordFailure(GLOBAL_KEY);
    await sleep(failureDelayMs);
    return reply.code(404).send({ error: 'invalid_link' });
  };

  app.post(
    '/api/links/lookup',
    {
      config: { rateLimit: requestLimit },
      schema: {
        body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: tokenSchema } },
      },
    },
    async (request, reply) => {
      const limited = tooMany(request, reply);
      if (limited) return limited;
      const { token } = request.body as LinkLookupRequest;
      const link = await lookupLink(db, hashToken(token.trim()));
      if (!link) return invalidLink(request, reply);
      const body: LinkLookup =
        link.kind === 'invite'
          ? {
              kind: 'invite',
              treeName: link.treeName,
              email: link.email,
              role: link.role,
              person: link.personName === null ? null : { name: link.personName },
              note: link.note,
              invitedBy: link.invitedBy,
              expiresAt: link.expiresAt.toISOString(),
            }
          : {
              kind: 'reset',
              treeName: link.treeName,
              displayName: link.displayName,
              expiresAt: link.expiresAt.toISOString(),
            };
      return body;
    },
  );

  app.post(
    '/api/links/accept',
    {
      config: { rateLimit: requestLimit },
      schema: {
        body: {
          type: 'object',
          required: ['token', 'password'],
          additionalProperties: false,
          properties: {
            token: tokenSchema,
            password: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
            displayName: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const limited = tooMany(request, reply);
      if (limited) return limited;
      const body = request.body as AcceptLinkRequest;
      const tokenHash = hashToken(body.token.trim());

      // The token first: a bad link costs one indexed lookup, no argon2.
      const link = await lookupLink(db, tokenHash);
      if (!link) return invalidLink(request, reply);

      if (body.password.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({ error: 'password_too_short', minLength: MIN_PASSWORD_LENGTH });
      }

      let userId: string;
      try {
        if (link.kind === 'invite') {
          // With a linked person the account takes that person's name; otherwise the invitee gives theirs.
          const given = body.displayName?.trim() ?? '';
          if (link.personName === null && given.length < 1)
            return reply.code(400).send({ error: 'invalid_display_name' });
          userId = await acceptInvitation(db, {
            tokenHash,
            displayName: link.personName === null ? given : null,
            passwordHash: await hashPassword(body.password),
          });
        } else {
          return invalidLink(request, reply);
        }
      } catch (error) {
        // Lost a race (another accept, a revoke, the email or the person taken meanwhile): the same generic answer.
        const known = error instanceof ApiError ? error : fromDatabaseError(error);
        if (known?.code === 'invalid_link') return invalidLink(request, reply);
        throw error;
      }

      limiters.linkIp.reset(request.ip);
      await startSession(deps, request, reply, userId);
      const me = await readMe(db, userId);
      void reply.code(201);
      return me;
    },
  );
}
