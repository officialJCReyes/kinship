// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db.js';
import { createSession, deleteSession, findLogin, updatePasswordHash } from '../auth/store.js';
import { getDummyHash, hashPassword, MAX_PASSWORD_LENGTH, needsRehash, verifyPassword } from '../auth/passwords.js';
import { generateSessionToken, hashToken } from '../auth/tokens.js';
import { withUserTransaction } from '../request-context.js';
import { isValidEmail, normalizeEmail, retrySeconds, sleep } from './shared.js';
import type { RouteDeps } from './shared.js';

export const SESSION_COOKIE = 'kinship_session';

/** HttpOnly, SameSite=Lax, and Secure whenever the request came in over HTTPS. */
export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, expiresAt: Date): void {
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    path: '/',
    expires: expiresAt,
  });
}

/** Starts a session for a user and sets the cookie. */
export async function startSession(
  deps: Pick<RouteDeps, 'db' | 'sessions'>,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const token = generateSessionToken();
  const expiresAt = await createSession(deps.db, {
    userId,
    tokenHash: hashToken(token),
    idleSeconds: deps.sessions.idleSeconds,
    maxSeconds: deps.sessions.maxSeconds,
  });
  setSessionCookie(request, reply, token, expiresAt);
}

export function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, limiters, failureDelayMs, requestLimit } = deps;

  app.post(
    '/api/auth/login',
    {
      config: { rateLimit: requestLimit },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', maxLength: 320 },
            password: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const email = normalizeEmail(body.email);
      const ipKey = request.ip;

      const wait = Math.max(limiters.loginIp.retryAfterMs(ipKey), limiters.loginAccount.retryAfterMs(email));
      if (wait > 0) {
        const seconds = retrySeconds(wait);
        return reply
          .code(429)
          .header('Retry-After', String(seconds))
          .send({ error: 'rate_limited', retryAfterSeconds: seconds });
      }

      // Unknown email and wrong password must look and take the same: verify against a dummy hash when
      // there is no account, and give the same answer for both.
      const login = isValidEmail(email) ? await findLogin(db, email) : undefined;
      const passwordOk = await verifyPassword(login?.passwordHash ?? (await getDummyHash()), body.password);

      if (!login || !passwordOk) {
        limiters.loginIp.recordFailure(ipKey);
        limiters.loginAccount.recordFailure(email);
        await sleep(failureDelayMs);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      limiters.loginAccount.reset(email);
      if (needsRehash(login.passwordHash)) {
        await updatePasswordHash(db, login.userId, await hashPassword(body.password));
      }
      await startSession(deps, request, reply, login.userId);
      // Read the signed-in person back through row-level security, as every other request does.
      const me = await readMe(db, login.userId);
      return reply.send(me);
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.sessionTokenHash) await deleteSession(db, request.sessionTokenHash);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'unauthenticated' });
    const me = await readMe(db, request.user.id);
    if (!me) return reply.code(401).send({ error: 'unauthenticated' });
    return me;
  });
}

/**
 * The signed-in person and the tree name, read as that person, so row-level
 * security applies: the app role cannot see anyone else's row here.
 */
export async function readMe(db: Kysely<Database>, userId: string) {
  const result = await withUserTransaction(db, userId, async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select(['id', 'email', 'display_name', 'role'])
      .where('id', '=', userId)
      .executeTakeFirst();
    const tree = await trx.selectFrom('family_tree').select('name').executeTakeFirst();
    return { user, treeName: tree?.name ?? null };
  });
  if (!result.user) return undefined;
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.display_name,
      role: result.user.role,
    },
    treeName: result.treeName,
  };
}
