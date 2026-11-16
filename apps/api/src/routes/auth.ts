// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseUserSettings } from '@kinship/shared';
import type { ChangePasswordRequest, LoginRequest, MeResponse, UpdateMeRequest, UserSettings } from '@kinship/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { Database } from '../db.js';
import {
  changePassword,
  createSession,
  deleteSession,
  findLogin,
  resolveSession,
  updatePasswordHash,
} from '../auth/store.js';
import {
  getDummyHash,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  verifyPassword,
} from '../auth/passwords.js';
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
      const body = request.body as LoginRequest;
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

  // Change your own password. The account's other sessions are signed out and this one gets a new cookie, so a stolen
  // cookie dies with the change. The limits apply before any hashing, and a wrong current password counts as a failure.
  app.post(
    '/api/auth/password',
    {
      config: { rateLimit: requestLimit },
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          additionalProperties: false,
          properties: {
            currentPassword: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
            newPassword: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      const currentTokenHash = request.sessionTokenHash;
      if (!user || !currentTokenHash) return reply.code(401).send({ error: 'unauthenticated' });
      void reply.header('Cache-Control', 'no-store');
      const body = request.body as ChangePasswordRequest;

      const wait = Math.max(
        limiters.passwordIp.retryAfterMs(request.ip),
        limiters.passwordAccount.retryAfterMs(user.id),
      );
      if (wait > 0) {
        const seconds = retrySeconds(wait);
        return reply
          .code(429)
          .header('Retry-After', String(seconds))
          .send({ error: 'rate_limited', retryAfterSeconds: seconds });
      }
      if (body.newPassword.length < MIN_PASSWORD_LENGTH) {
        return reply.code(400).send({ error: 'password_too_short', minLength: MIN_PASSWORD_LENGTH });
      }

      const login = await findLogin(db, user.email);
      if (!login || login.userId !== user.id || !(await verifyPassword(login.passwordHash, body.currentPassword))) {
        limiters.passwordIp.recordFailure(request.ip);
        limiters.passwordAccount.recordFailure(user.id);
        await sleep(failureDelayMs);
        return reply.code(400).send({ error: 'invalid_current_password' });
      }
      limiters.passwordAccount.reset(user.id);

      const newToken = generateSessionToken();
      const newTokenHash = hashToken(newToken);
      const passwordHash = await hashPassword(body.newPassword);
      await request.withTransaction((trx) =>
        changePassword(trx, { userId: user.id, passwordHash, currentTokenHash, newTokenHash }),
      );
      const session = await resolveSession(db, newTokenHash, deps.sessions.idleSeconds);
      if (session) setSessionCookie(request, reply, newToken, session.expiresAt);
      return reply.code(204).send();
    },
  );

  // The account's own settings (My settings): which family its charts follow for an adopted person, the color
  // scheme, light or dark, the date format and which surname shows. Any non-empty subset. It changes nothing for
  // anyone else, and nothing about who can see what.
  app.patch(
    '/api/auth/me',
    {
      config: { rateLimit: requestLimit },
      schema: { body: { type: 'object', minProperties: 1, additionalProperties: true } },
    },
    async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'unauthenticated' });
      const parsed = parseUserSettings(request.body as UpdateMeRequest);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.code });
      const userId = request.user.id;
      await withUserTransaction(db, userId, (trx) =>
        trx.updateTable('users').set(settingsColumns(parsed.settings)).where('id', '=', userId).execute(),
      );
      const me = await readMe(db, userId);
      if (!me) return reply.code(401).send({ error: 'unauthenticated' });
      return me;
    },
  );
}

/** The users columns for a set of settings. */
export function settingsColumns(settings: Partial<UserSettings>) {
  return {
    ...(settings.lineageView !== undefined ? { lineage_view: settings.lineageView } : {}),
    ...(settings.colorScheme !== undefined ? { color_scheme: settings.colorScheme } : {}),
    ...(settings.theme !== undefined ? { theme: settings.theme } : {}),
    ...(settings.dateFormat !== undefined ? { date_format: settings.dateFormat } : {}),
    ...(settings.surnameChoice !== undefined ? { surname_choice: settings.surnameChoice } : {}),
  };
}

/**
 * The signed-in person and the tree name, read as that person, so row-level
 * security applies: the app role cannot see anyone else's row here.
 */
export async function readMe(db: Kysely<Database>, userId: string): Promise<MeResponse | undefined> {
  const result = await withUserTransaction(db, userId, async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select([
        'id',
        'email',
        'display_name',
        'role',
        'person_id',
        'lineage_view',
        'color_scheme',
        'theme',
        'date_format',
        'surname_choice',
        'password_changed_at',
        'password_changed_via',
      ])
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
      personId: result.user.person_id,
      lineageView: result.user.lineage_view,
      colorScheme: result.user.color_scheme,
      theme: result.user.theme,
      dateFormat: result.user.date_format,
      surnameChoice: result.user.surname_choice,
      passwordChangedAt: result.user.password_changed_at?.toISOString() ?? null,
      passwordChangedVia: result.user.password_changed_via,
    },
    treeName: result.treeName,
  };
}
