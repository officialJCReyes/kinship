// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseUserSettings, SETTING_ERROR_CODES } from '@kinship/shared';
import type { SetupCheckRequest, SetupRequest, UserSettings } from '@kinship/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  checkSetupToken,
  completeSetup,
  completeSetupFamily,
  needsSetup,
  SETUP_ALREADY_DONE,
  SETUP_INVALID_TOKEN,
} from '../auth/store.js';
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';
import { hashToken } from '../auth/tokens.js';
import { ApiError } from '../errors.js';
import { cleanName } from '../people/names.js';
import { parseSetupFamily } from '../people/setup-family.js';
import { withUserTransaction } from '../request-context.js';
import { readMe, settingsColumns, startSession } from './auth.js';
import { isValidEmail, normalizeEmail, retrySeconds, sleep } from './shared.js';
import type { RouteDeps } from './shared.js';

const GLOBAL_KEY = 'setup';

function sqlState(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The setting a code belongs to, so the error can name `settings.theme`. */
function settingField(code: string): string {
  const key = Object.entries(SETTING_ERROR_CODES).find(([, value]) => value === code)?.[0];
  return key ? `settings.${key}` : 'settings';
}

export function registerSetupRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { db, limiters, failureDelayMs, requestLimit } = deps;

  /** 429 while this address (or everyone) has failed too often; undefined when the attempt may go on. */
  const limited = (request: FastifyRequest, reply: FastifyReply) => {
    const wait = Math.max(limiters.setupIp.retryAfterMs(request.ip), limiters.setupGlobal.retryAfterMs(GLOBAL_KEY));
    if (wait <= 0) return undefined;
    const seconds = retrySeconds(wait);
    return reply
      .code(429)
      .header('Retry-After', String(seconds))
      .send({ error: 'rate_limited', retryAfterSeconds: seconds });
  };

  const rejectToken = async (request: FastifyRequest, reply: FastifyReply) => {
    // Another attempt may have finished setup between our first check and now (the token is
    // deleted with it). That is "already set up", not a bad guess, and it must not count as one.
    if (!(await needsSetup(db))) return reply.code(409).send({ error: 'already_set_up' });
    limiters.setupIp.recordFailure(request.ip);
    limiters.setupGlobal.recordFailure(GLOBAL_KEY);
    await sleep(failureDelayMs);
    return reply.code(403).send({ error: 'invalid_setup_token', field: 'token' });
  };

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
            settings: { type: 'object', additionalProperties: true },
            // Checked field by field in parseSetupFamily, so an error can name the field.
            family: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as SetupRequest;

      // Fails closed: once an account exists this endpoint only ever says no.
      if (!(await needsSetup(db))) return reply.code(409).send({ error: 'already_set_up' });
      const tooMany = limited(request, reply);
      if (tooMany) return tooMany;

      // Token first, before any other check or any password hashing.
      const tokenHash = hashToken(body.token.trim());
      if (!(await checkSetupToken(db, tokenHash))) return rejectToken(request, reply);

      const bad = (code: string, field: string, extra: Record<string, unknown> = {}) =>
        reply.code(400).send({ error: code, field, ...extra });
      const email = normalizeEmail(body.email);
      const displayName = body.displayName.trim();
      const treeName = body.treeName.trim();
      if (!isValidEmail(email)) return bad('invalid_email', 'email');
      if (displayName.length < 1) return bad('invalid_display_name', 'displayName');
      if (treeName.length < 1) return bad('invalid_tree_name', 'treeName');
      if (body.password.length < MIN_PASSWORD_LENGTH) {
        return bad('password_too_short', 'password', { minLength: MIN_PASSWORD_LENGTH });
      }
      if (body.person !== undefined && body.family !== undefined) return bad('invalid_request', 'family');

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

      // The new account's own display settings (for example the color scheme picked in the wizard).
      let settings: Partial<UserSettings> | undefined;
      if (body.settings !== undefined) {
        const parsed = parseUserSettings(body.settings);
        if (!parsed.ok)
          return bad(parsed.code, parsed.code === 'invalid_request' ? 'settings' : settingField(parsed.code));
        settings = parsed.settings;
      }

      // The wizard's family: checked in full before anything is hashed or written (ApiError carries the field).
      const family = body.family === undefined ? undefined : parseSetupFamily(body.family);

      let userId: string;
      try {
        const passwordHash = await hashPassword(body.password);
        userId = family
          ? await completeSetupFamily(db, {
              tokenHash,
              email,
              displayName,
              passwordHash,
              treeName,
              settings: settings ?? {},
              family,
            })
          : await completeSetup(db, { tokenHash, email, displayName, passwordHash, treeName, person });
      } catch (error) {
        const code = sqlState(error);
        if (code === SETUP_ALREADY_DONE) return reply.code(409).send({ error: 'already_set_up' });
        if (code === SETUP_INVALID_TOKEN) return rejectToken(request, reply);
        throw error;
      }

      // The wizard's settings were stored with the account. A scripted install that sends only `settings` saves them here.
      if (settings && !family) {
        await withUserTransaction(db, userId, (trx) =>
          trx.updateTable('users').set(settingsColumns(settings)).where('id', '=', userId).execute(),
        );
      }
      await startSession(deps, request, reply, userId);
      return reply.code(201).send(await readMe(db, userId));
    },
  );

  // Is this the setup token? Asked when the wizard leaves its first step, so a wrong token is found before the person
  // has typed the rest. It shares the failure limiters (and so the lockout) with POST /api/setup.
  app.post(
    '/api/setup/check',
    {
      config: { rateLimit: requestLimit },
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: { token: { type: 'string', maxLength: 256 } },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.body as SetupCheckRequest;
      if (!(await needsSetup(db))) return reply.code(409).send({ error: 'already_set_up' });
      const tooMany = limited(request, reply);
      if (tooMany) return tooMany;
      if (!(await checkSetupToken(db, hashToken(token.trim())))) return rejectToken(request, reply);
      return reply.code(204).send();
    },
  );
}
