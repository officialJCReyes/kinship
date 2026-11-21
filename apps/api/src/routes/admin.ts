// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  canDisableAccount,
  canLinkPerson,
  canMakeSetPasswordLink,
  rolesSettableBy,
  ROLES_INVITABLE_BY,
} from '@kinship/shared';
import type {
  AccountPersonLogLine,
  AccountDeletedLogLine,
  AccountRoleLogLine,
  AccountStateLogLine,
  AccountStateResponse,
  AccountsResponse,
  AccountSummary,
  ChangeRoleInput,
  DeleteAccountInput,
  DeleteAccountPreview,
  ChangeRoleResponse,
  InvitationInput,
  LinkCreated,
  LinkPersonInput,
  LinkPersonResponse,
  LinkPreview,
  OpenLinkSummary,
  Role,
} from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import {
  changeAccountRole,
  createInvitation,
  createResetLink,
  deleteAccount,
  deletePreview,
  disableAccount,
  enableAccount,
  linkAccountPerson,
  linkPreview,
  listInviters,
  listOpenLinks,
  regenerateLink,
  revokeLink,
  unlinkAccountPerson,
} from '../auth/links.js';
import { generateLinkToken, hashToken } from '../auth/tokens.js';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { getPerson, isUuid } from '../people/store.js';
import { isValidEmail, normalizeEmail } from './shared.js';
import type { RouteLimit } from './shared.js';

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } };
const isAdminRole = (role: Role): boolean => role === 'superadmin' || role === 'familyadmin';

/**
 * The Users page: accounts, invitations and set-password links. Admins only (the API says 403 to anyone else, and
 * the database functions check again). A response that carries a link, or that is about links, is never cached.
 */
export function registerAdminRoutes(app: FastifyInstance, limit: RouteLimit): void {
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
  });
  app.addHook('onRequest', async (request) => {
    if (request.user && !isAdminRole(request.user.role)) throw forbidden();
  });

  app.post(
    '/api/admin/invitations',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['email', 'role'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', maxLength: 320 },
            role: { type: 'string', enum: ['superadmin', 'familyadmin', 'member', 'user'] },
            personId: { type: ['string', 'null'], maxLength: 64 },
            note: { type: ['string', 'null'], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply): Promise<LinkCreated> => {
      const body = request.body as InvitationInput;
      const actor = request.user;
      if (!actor) throw forbidden();
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) throw badRequest('invalid_email');
      if (!ROLES_INVITABLE_BY[actor.role].includes(body.role)) throw new ApiError(403, 'role_not_allowed');
      if (body.personId != null && !isUuid(body.personId)) throw notFound('person_not_found');
      const personId = body.personId ?? null;
      const token = generateLinkToken();
      const created = await request.withTransaction(async (trx) => {
        // A placeholder ("Unknown father") is never the person to link. The database function refuses it too.
        if (personId && (await getPerson(trx, personId))?.is_placeholder) throw conflict('person_is_placeholder');
        return createInvitation(trx, {
          email,
          role: body.role,
          personId: body.personId ?? null,
          note: body.note ?? null,
          tokenHash: hashToken(token),
        });
      });
      void reply.code(201);
      return { linkId: created.id, kind: 'invite', token, expiresAt: created.expiresAt.toISOString() };
    },
  );

  app.get('/api/admin/accounts', { config: limit }, async (request): Promise<AccountsResponse> => {
    const actor = request.user;
    if (!actor) throw forbidden();
    return request.withTransaction(async (trx) => {
      const users = await trx
        .selectFrom('users')
        .select([
          'id',
          'email',
          'display_name',
          'role',
          'person_id',
          'last_sign_in_at',
          'password_changed_at',
          'password_changed_via',
          'disabled_at',
          'created_at',
        ])
        .orderBy('created_at')
        .orderBy('id')
        .execute();
      const links = await listOpenLinks(trx);
      const inviters = await listInviters(trx);
      const personIds = [
        ...new Set([...users.map((u) => u.person_id), ...links.map((l) => l.person_id)].filter((id) => id !== null)),
      ];
      // placeholders: included (a linked person, by id; a placeholder is never linked to an account)
      const people = personIds.length
        ? await trx.selectFrom('people').select(['id', 'given_name', 'surname']).where('id', 'in', personIds).execute()
        : [];
      const personName = new Map(people.map((p) => [p.id, `${p.given_name} ${p.surname}`.trim()]));
      const personOf = (id: string | null) => {
        const name = id ? personName.get(id) : undefined;
        return id && name ? { id, name } : null;
      };
      const summary = (link: (typeof links)[number]): OpenLinkSummary => ({
        id: link.id,
        expiresAt: link.expires_at.toISOString(),
        expired: link.expired,
        canManage: link.can_manage,
      });
      const resetFor = new Map(links.filter((l) => l.kind === 'reset' && l.user_id).map((l) => [l.user_id, l]));

      // The guard is a count: how many active SuperAdmins there are, never "there is only one".
      const activeSuperAdmins = users.filter((u) => u.role === 'superadmin' && u.disabled_at === null).length;
      const accounts: AccountSummary[] = users.map((user) => {
        const reset = resetFor.get(user.id);
        const disabled = user.disabled_at !== null;
        const lastSuperAdmin = user.role === 'superadmin' && !disabled && activeSuperAdmins <= 1;
        return {
          id: user.id,
          kind: 'account',
          displayName: user.display_name,
          email: user.email,
          role: user.role,
          person: personOf(user.person_id),
          status: disabled ? 'disabled' : 'active',
          lastSignInAt: user.last_sign_in_at?.toISOString() ?? null,
          invitedBy: inviters.get(user.id) ?? null,
          passwordChangedAt: user.password_changed_at?.toISOString() ?? null,
          passwordChangedVia: user.password_changed_via,
          invitation: null,
          setPasswordLink: reset ? summary(reset) : null,
          canSetPasswordLink: !disabled && canMakeSetPasswordLink(actor, { id: user.id, role: user.role }),
          canLinkPerson: canLinkPerson(actor, { id: user.id, role: user.role }),
          allowedRoles: rolesSettableBy(actor, { id: user.id, role: user.role }),
          disabledAt: user.disabled_at?.toISOString() ?? null,
          canDisable: !lastSuperAdmin && canDisableAccount(actor, { id: user.id, role: user.role }),
          canDelete: disabled && canDisableAccount(actor, { id: user.id, role: user.role }),
          lastSuperAdmin,
        };
      });
      const invitations: AccountSummary[] = links
        .filter((l) => l.kind === 'invite')
        .map((link) => ({
          id: link.id,
          kind: 'invitation',
          displayName: null,
          email: link.email ?? '',
          role: link.role,
          person: personOf(link.person_id),
          status: link.expired ? 'expired' : 'invited',
          lastSignInAt: null,
          invitedBy: link.created_by_name,
          passwordChangedAt: null,
          passwordChangedVia: null,
          invitation: { ...summary(link), note: link.note },
          setPasswordLink: null,
          canSetPasswordLink: false,
          canLinkPerson: false,
          allowedRoles: [],
          disabledAt: null,
          canDisable: false,
          canDelete: false,
          lastSuperAdmin: false,
        }));
      return { accounts: [...accounts, ...invitations] };
    });
  });

  // --- link an existing account to a person (#8, migration 0016, ADR 0020) ---------------------------------------------
  const nullableUuid = { type: ['string', 'null'], maxLength: 64 };

  app.get(
    '/api/admin/accounts/:id/link-preview',
    {
      config: limit,
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          required: ['personId'],
          additionalProperties: false,
          properties: { personId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request): Promise<LinkPreview> => {
      const { id } = request.params as { id: string };
      const { personId } = request.query as { personId: string };
      if (!isUuid(id)) throw notFound('account_not_found');
      if (!isUuid(personId)) throw notFound('person_not_found');
      return request.withTransaction(async (trx) => {
        const row = await linkPreview(trx, id, personId);
        const names = await personNames(trx, [personId, ...(row.current_person_id ? [row.current_person_id] : [])]);
        return {
          role: row.account_role,
          person: { id: personId, name: names.get(personId) ?? '' },
          current: row.current_person_id
            ? { id: row.current_person_id, name: names.get(row.current_person_id) ?? '' }
            : null,
          descendantsInLine: Number(row.descendants_in_line),
          createdByAccountInLine: Number(row.created_by_account_in_line),
          losesEdit: Number(row.loses_edit),
        };
      });
    },
  );

  app.put(
    '/api/admin/accounts/:id/person',
    {
      config: limit,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['personId', 'currentPersonId'],
          additionalProperties: false,
          properties: { personId: { type: 'string', maxLength: 64 }, currentPersonId: nullableUuid },
        },
      },
    },
    async (request): Promise<LinkPersonResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as LinkPersonInput;
      const actor = request.user;
      if (!actor) throw forbidden();
      if (!isUuid(id)) throw notFound('account_not_found');
      if (!isUuid(body.personId)) throw notFound('person_not_found');
      if (body.currentPersonId !== null && !isUuid(body.currentPersonId)) throw badRequest('invalid_request');
      const result = await request.withTransaction(async (trx) => {
        const previous = await linkAccountPerson(trx, id, body.personId, body.currentPersonId);
        const names = await personNames(trx, [body.personId]);
        return { previous, name: names.get(body.personId) ?? '' };
      });
      // After the commit, and only when something changed. Ids only: no names, no emails (ADR 0020).
      if (result.previous !== body.personId) {
        const line: AccountPersonLogLine = {
          event: 'account_person_linked',
          actor: actor.id,
          account: id,
          from: result.previous,
          to: body.personId,
        };
        request.log.info(line, line.event);
      }
      return { accountId: id, person: { id: body.personId, name: result.name } };
    },
  );

  app.delete(
    '/api/admin/accounts/:id/person',
    {
      config: limit,
      schema: {
        params: idParams,
        querystring: {
          type: 'object',
          required: ['currentPersonId'],
          additionalProperties: false,
          properties: { currentPersonId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { currentPersonId } = request.query as { currentPersonId: string };
      const actor = request.user;
      if (!actor) throw forbidden();
      if (!isUuid(id)) throw notFound('account_not_found');
      if (!isUuid(currentPersonId)) throw badRequest('invalid_request');
      const previous = await request.withTransaction((trx) => unlinkAccountPerson(trx, id, currentPersonId));
      const line: AccountPersonLogLine = {
        event: 'account_person_unlinked',
        actor: actor.id,
        account: id,
        from: previous,
        to: null,
      };
      request.log.info(line, line.event);
      return reply.code(204).send();
    },
  );

  // --- change an account's role (#57, migration 0019, ADR 0029) -----------------------------------------------------
  const roleEnum = { type: 'string', enum: ['superadmin', 'familyadmin', 'member', 'user'] };
  app.patch(
    '/api/admin/accounts/:id/role',
    {
      config: limit,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['role', 'currentRole'],
          additionalProperties: false,
          properties: { role: roleEnum, currentRole: roleEnum },
        },
      },
    },
    async (request): Promise<ChangeRoleResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as ChangeRoleInput;
      const actor = request.user;
      if (!actor) throw forbidden();
      if (!isUuid(id)) throw notFound('account_not_found');
      // The role is read from the database on every request, so a change applies at once: no sign-out is needed.
      const previous = await request.withTransaction((trx) => changeAccountRole(trx, id, body.role, body.currentRole));
      if (previous !== body.role) {
        const line: AccountRoleLogLine = {
          event: 'account_role_changed',
          actor: actor.id,
          account: id,
          from: previous,
          to: body.role,
        };
        request.log.info(line, line.event);
      }
      return { accountId: id, role: body.role, previous };
    },
  );

  // --- disable and enable (#56, migration 0019, ADR 0029) -----------------------------------------------------------
  // Disabling signs the account out at once, revokes its open set-password link and refuses its sign-in with the same answer
  // a wrong password gets. Its person link, history and shares stay. Both are quiet no-ops when the account is already so.
  for (const action of ['disable', 'enable'] as const) {
    app.post(
      `/api/admin/accounts/:id/${action}`,
      { config: limit, schema: { params: idParams } },
      async (request): Promise<AccountStateResponse> => {
        const { id } = request.params as { id: string };
        const actor = request.user;
        if (!actor) throw forbidden();
        if (!isUuid(id)) throw notFound('account_not_found');
        const result = await request.withTransaction(async (trx) => {
          if (action === 'enable') return { changed: await enableAccount(trx, id), disabledAt: null };
          return disableAccount(trx, id);
        });
        if (result.changed) {
          const line: AccountStateLogLine = { event: `account_${action}d`, actor: actor.id, account: id };
          request.log.info(line, line.event);
        }
        return {
          accountId: id,
          status: action === 'enable' ? 'active' : 'disabled',
          disabledAt: result.disabledAt?.toISOString() ?? null,
        };
      },
    );
  }

  // --- delete (#56, ADR 0029): only a disabled account, with its email typed ---------------------------------------------
  app.get(
    '/api/admin/accounts/:id/delete-preview',
    { config: limit, schema: { params: idParams } },
    async (request): Promise<DeleteAccountPreview> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('account_not_found');
      const row = await request.withTransaction((trx) => deletePreview(trx, id));
      return {
        accountId: id,
        role: row.account_role,
        disabled: row.is_disabled,
        peopleAdded: Number(row.people_added),
      };
    },
  );

  // POST with a body (not DELETE with a query) so the typed email is in no URL and so in no request log.
  app.post(
    '/api/admin/accounts/:id/delete',
    {
      config: limit,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['confirmEmail'],
          additionalProperties: false,
          properties: { confirmEmail: { type: 'string', maxLength: 320 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as DeleteAccountInput;
      const actor = request.user;
      if (!actor) throw forbidden();
      if (!isUuid(id)) throw notFound('account_not_found');
      await request.withTransaction((trx) => deleteAccount(trx, id, body.confirmEmail));
      const line: AccountDeletedLogLine = { event: 'account_deleted', actor: actor.id, account: id };
      request.log.info(line, line.event);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/admin/links/:id/regenerate',
    { config: limit, schema: { params: idParams } },
    async (request): Promise<LinkCreated> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('link_not_found');
      const token = generateLinkToken();
      const created = await request.withTransaction((trx) => regenerateLink(trx, id, hashToken(token)));
      return { linkId: created.id, kind: created.kind, token, expiresAt: created.expiresAt.toISOString() };
    },
  );

  app.post('/api/admin/links/:id/revoke', { config: limit, schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) throw notFound('link_not_found');
    await request.withTransaction((trx) => revokeLink(trx, id));
    return reply.code(204).send();
  });

  app.post(
    '/api/admin/accounts/:id/set-password-link',
    { config: limit, schema: { params: idParams } },
    async (request, reply): Promise<LinkCreated> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('account_not_found');
      const token = generateLinkToken();
      const created = await request.withTransaction((trx) => createResetLink(trx, id, hashToken(token)));
      void reply.code(201);
      return { linkId: created.id, kind: 'reset', token, expiresAt: created.expiresAt.toISOString() };
    },
  );
}

/** Display names of some people, by id (placeholders have an empty name; none is ever linked). */
async function personNames(trx: Parameters<typeof getPerson>[0], ids: string[]): Promise<Map<string, string>> {
  // placeholders: included (people looked up by id)
  const rows = await trx.selectFrom('people').select(['id', 'given_name', 'surname']).where('id', 'in', ids).execute();
  return new Map(rows.map((p) => [p.id, `${p.given_name} ${p.surname}`.trim()]));
}
