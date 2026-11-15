// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, PEOPLE_PAGE_DEFAULT, PEOPLE_PAGE_MAX, SEARCH_MAX_LENGTH } from '@kinship/shared';
import type {
  AddChildRequest,
  AddParentRequest,
  ChildResponse,
  Parentage,
  ParentageResponse,
  PeoplePage,
  PersonDetail,
  PersonInput,
  PersonPatch,
  PersonResponse,
} from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { canAddChildUnder, canEditPerson, isAdmin } from '../people/actor.js';
import type { Actor } from '../people/actor.js';
import { parseDateInput } from '../people/dates.js';
import { withActor } from '../people/run.js';
import { cleanName } from '../people/names.js';
import {
  decodeCursor,
  deletePreview,
  encodeCursor,
  getParentageRow,
  getPerson,
  getUnion,
  insertPerson,
  isUuid,
  listPeople,
  normalizeSearchWords,
  parentAgeWarnings,
  personHasAccount,
  singleParentChildIds,
  toParentage,
  toPerson,
  unionsBetween,
  unionsOfPerson,
  updatePerson,
  withChildren,
} from '../people/store.js';
import type { PersonValues } from '../people/store.js';

type Trx = Transaction<Database>;

const uuidParam = (name: string) => ({
  type: 'object',
  required: [name],
  properties: { [name]: { type: 'string', maxLength: 64 } },
});

const dateSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      required: ['value'],
      additionalProperties: false,
      properties: { value: { type: 'string', maxLength: 40 }, precision: { type: 'string', maxLength: 16 } },
    },
  ],
};

const personProperties = {
  givenName: { type: 'string', maxLength: 400 },
  surname: { type: 'string', maxLength: 400 },
  gender: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 16 }] },
  birth: dateSchema,
  deceased: { type: 'boolean' },
  death: dateSchema,
};
const personInputSchema = {
  type: 'object',
  required: ['givenName', 'surname'],
  additionalProperties: false,
  properties: personProperties,
};
const personPatchSchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: personProperties,
};

function parseGender(raw: unknown): 'male' | 'female' | 'other' | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && (GENDERS as readonly string[]).includes(raw))
    return raw as 'male' | 'female' | 'other';
  throw badRequest('invalid_gender');
}

/** The values for a new person, checked. */
export function parsePersonInput(input: PersonInput): PersonValues {
  const birth = parseDateInput(input.birth ?? null);
  const death = parseDateInput(input.death ?? null);
  const deceased = input.deceased ?? death !== null;
  if (death !== null && !deceased) throw badRequest('invalid_date');
  return {
    given_name: cleanName(input.givenName, 'invalid_given_name'),
    surname: cleanName(input.surname, 'invalid_surname'),
    gender: parseGender(input.gender),
    birth_date: birth?.value ?? null,
    birth_precision: birth?.precision ?? 'exactly',
    deceased,
    death_date: death?.value ?? null,
    death_precision: death?.precision ?? 'exactly',
  };
}

/** The columns to change for a patch. A person marked living again loses their death date. */
function parsePersonPatch(patch: PersonPatch, current: { deceased: boolean }): Partial<PersonValues> {
  const values: Partial<PersonValues> = {};
  if (patch.givenName !== undefined) values.given_name = cleanName(patch.givenName, 'invalid_given_name');
  if (patch.surname !== undefined) values.surname = cleanName(patch.surname, 'invalid_surname');
  if (patch.gender !== undefined) values.gender = parseGender(patch.gender);
  if (patch.birth !== undefined) {
    const birth = parseDateInput(patch.birth);
    values.birth_date = birth?.value ?? null;
    values.birth_precision = birth?.precision ?? 'exactly';
  }
  if (patch.death !== undefined) {
    const death = parseDateInput(patch.death);
    values.death_date = death?.value ?? null;
    values.death_precision = death?.precision ?? 'exactly';
    if (death !== null && patch.deceased === undefined && !current.deceased) values.deceased = true;
    if (death !== null && patch.deceased === false) throw badRequest('invalid_date');
  }
  if (patch.deceased !== undefined) {
    values.deceased = patch.deceased;
    if (!patch.deceased && patch.death === undefined) {
      values.death_date = null;
      values.death_precision = 'exactly';
    }
  }
  return values;
}

export function registerPeopleRoutes(app: FastifyInstance): void {
  const run = withActor;

  // --- list and search ------------------------------------------------------
  app.get(
    '/api/people',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string', maxLength: SEARCH_MAX_LENGTH },
            limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
            cursor: { type: 'string', maxLength: 512 },
          },
        },
      },
    },
    async (request): Promise<PeoplePage> => {
      const query = request.query as { q?: string; limit?: string; cursor?: string };
      const limit = Math.min(Math.max(Number(query.limit ?? PEOPLE_PAGE_DEFAULT), 1), PEOPLE_PAGE_MAX);
      const after = query.cursor ? decodeCursor(query.cursor) : undefined;
      return run(request, async (trx) => {
        const words = await normalizeSearchWords(trx, query.q ?? '');
        const { rows, hasMore } = await listPeople(trx, { words, limit, after });
        const last = rows.at(-1);
        return { items: rows.map(toPerson), nextCursor: hasMore && last ? encodeCursor(last) : null };
      });
    },
  );

  // --- one person -----------------------------------------------------------
  app.get('/api/people/:id', { schema: { params: uuidParam('id') } }, async (request): Promise<PersonDetail> => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) throw notFound('person_not_found');
    return run(request, async (trx, actor) => {
      const person = await getPerson(trx, id);
      if (!person) throw notFound('person_not_found');
      const parentRow = await getParentageRow(trx, id);
      const unions = await withChildren(trx, await unionsOfPerson(trx, id));
      const singles = await singleParentChildIds(trx, id);
      const admin = isAdmin(actor);
      return {
        person: toPerson(person),
        parentage: parentRow ? toParentage(parentRow) : null,
        unions,
        singleParentChildIds: singles,
        permissions: {
          edit: await canEditPerson(trx, actor, person),
          delete: admin,
          addChild: await canAddChildUnder(trx, actor, id),
        },
        hasAccount: await personHasAccount(trx, id),
      };
    });
  });

  // --- create (admins; a Member adds people only as children, below) ---------
  app.post('/api/people', { schema: { body: personInputSchema } }, async (request, reply): Promise<PersonResponse> => {
    const body = request.body as PersonInput;
    const result = await run(request, async (trx, actor) => {
      if (!isAdmin(actor)) throw forbidden();
      const row = await insertPerson(trx, actor.id, parsePersonInput(body));
      return { person: toPerson(row), warnings: [] };
    });
    void reply.code(201);
    return result;
  });

  // --- change ---------------------------------------------------------------
  app.patch(
    '/api/people/:id',
    { schema: { params: uuidParam('id'), body: personPatchSchema } },
    async (request): Promise<PersonResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as PersonPatch;
      if (!isUuid(id)) throw notFound('person_not_found');
      return run(request, async (trx, actor) => {
        const current = await getPerson(trx, id);
        if (!current) throw notFound('person_not_found');
        if (!(await canEditPerson(trx, actor, current))) throw forbidden();
        const row = await updatePerson(trx, id, parsePersonPatch(body, current));
        if (!row) throw forbidden(); // the row-level security policy said no after all
        const warnings = body.birth !== undefined ? await parentAgeWarnings(trx, id) : [];
        return { person: toPerson(row), warnings };
      });
    },
  );

  // --- delete (admins, with an explicit confirm when it takes relationships with it) ---
  app.delete(
    '/api/people/:id',
    {
      schema: {
        params: uuidParam('id'),
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { confirm: { type: 'string', enum: ['true', 'false'] } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const confirmed = (request.query as { confirm?: string }).confirm === 'true';
      if (!isUuid(id)) throw notFound('person_not_found');
      await run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (!(await getPerson(trx, id))) throw notFound('person_not_found');
        if (await personHasAccount(trx, id)) throw conflict('person_has_account');
        const preview = await deletePreview(trx, id);
        if ((preview.unions > 0 || preview.children > 0) && !confirmed) {
          throw conflict('confirm_required', { ...preview });
        }
        // The database moves the children and removes the unions (trigger in migration 0004).
        await trx.deleteFrom('people').where('id', '=', id).execute();
      });
      return reply.code(204).send();
    },
  );

  // --- add a child under a person (admins, and Members under themselves and their descendants) ---
  app.post(
    '/api/people/:id/children',
    {
      schema: {
        params: uuidParam('id'),
        body: {
          type: 'object',
          required: ['child'],
          additionalProperties: false,
          properties: { child: personInputSchema, unionId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply): Promise<ChildResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as AddChildRequest;
      if (!isUuid(id)) throw notFound('person_not_found');
      const result = await run(request, async (trx, actor) => {
        if (!(await getPerson(trx, id))) throw notFound('person_not_found');
        if (!(await canAddChildUnder(trx, actor, id))) throw forbidden();
        if (body.unionId !== undefined) {
          if (!isUuid(body.unionId)) throw notFound('union_not_found');
          const union = await getUnion(trx, body.unionId);
          if (!union) throw notFound('union_not_found');
          if (union.partner_a_id !== id && union.partner_b_id !== id) throw badRequest('union_parent_mismatch');
        }
        const values = parsePersonInput(body.child);
        const child = await insertPerson(trx, actor.id, values);
        await trx
          .insertInto('person_parents')
          .values({
            child_id: child.id,
            union_id: body.unionId ?? null,
            parent_id: body.unionId === undefined ? id : null,
            created_by: actor.id,
          })
          .execute();
        return {
          person: toPerson(child),
          parentage: { unionId: body.unionId ?? null, parentId: body.unionId === undefined ? id : null },
          warnings: await parentAgeWarnings(trx, child.id),
        };
      });
      void reply.code(201);
      return result;
    },
  );

  // --- add a parent to an existing person (admins) -----------------------------
  app.post(
    '/api/people/:id/parents',
    {
      schema: {
        params: uuidParam('id'),
        body: {
          type: 'object',
          required: ['parentId'],
          additionalProperties: false,
          properties: { parentId: { type: 'string', maxLength: 64 }, unionId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request, reply): Promise<ParentageResponse> => {
      const { id: childId } = request.params as { id: string };
      const body = request.body as AddParentRequest;
      if (!isUuid(childId) || !isUuid(body.parentId)) throw notFound('person_not_found');
      const result = await run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (!(await getPerson(trx, childId)) || !(await getPerson(trx, body.parentId)))
          throw notFound('person_not_found');
        if (childId === body.parentId) throw badRequest('parent_is_self');

        const existing = await getParentageRow(trx, childId);
        let parentage: Parentage;

        if (!existing) {
          if (body.unionId === undefined) {
            parentage = { unionId: null, parentId: body.parentId };
          } else {
            const union = await requireUnionWith(trx, body.unionId, body.parentId);
            parentage = { unionId: union.id, parentId: null };
          }
          await trx
            .insertInto('person_parents')
            .values({
              child_id: childId,
              union_id: parentage.unionId,
              parent_id: parentage.parentId,
              created_by: actor.id,
            })
            .execute();
        } else if (existing.parent_id !== null) {
          if (existing.parent_id === body.parentId) throw conflict('parent_already_linked');
          const union = await unionForNewParent(trx, actor, existing.parent_id, body.parentId, body.unionId);
          await trx
            .updateTable('person_parents')
            .set({ union_id: union.id, parent_id: null })
            .where('child_id', '=', childId)
            .execute();
          parentage = { unionId: union.id, parentId: null };
        } else {
          const union = await getUnion(trx, existing.union_id as string);
          if (union && (union.partner_a_id === body.parentId || union.partner_b_id === body.parentId)) {
            throw conflict('parent_already_linked');
          }
          throw conflict('too_many_parents');
        }
        return { parentage, warnings: await parentAgeWarnings(trx, childId) };
      });
      void reply.code(201);
      return result;
    },
  );

  // --- remove one parent --------------------------------------------------------
  app.delete(
    '/api/people/:id/parents/:parentId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'parentId'],
          properties: { id: { type: 'string', maxLength: 64 }, parentId: { type: 'string', maxLength: 64 } },
        },
      },
    },
    async (request): Promise<ParentageResponse> => {
      const { id: childId, parentId } = request.params as { id: string; parentId: string };
      if (!isUuid(childId)) throw notFound('person_not_found');
      return run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (!(await getPerson(trx, childId))) throw notFound('person_not_found');
        const existing = await getParentageRow(trx, childId);
        if (!existing) throw notFound('parent_not_found');

        if (existing.parent_id !== null) {
          if (existing.parent_id !== parentId) throw notFound('parent_not_found');
          await trx.deleteFrom('person_parents').where('child_id', '=', childId).execute();
          return { parentage: null, warnings: [] };
        }
        const union = await getUnion(trx, existing.union_id as string);
        if (!union || (union.partner_a_id !== parentId && union.partner_b_id !== parentId)) {
          throw notFound('parent_not_found');
        }
        const remaining = union.partner_a_id === parentId ? union.partner_b_id : union.partner_a_id;
        await trx
          .updateTable('person_parents')
          .set({ union_id: null, parent_id: remaining })
          .where('child_id', '=', childId)
          .execute();
        return { parentage: { unionId: null, parentId: remaining }, warnings: [] };
      });
    },
  );
}

/** A union that exists and has this person as one of its partners. */
async function requireUnionWith(trx: Trx, unionId: string, personId: string) {
  if (!isUuid(unionId)) throw notFound('union_not_found');
  const union = await getUnion(trx, unionId);
  if (!union) throw notFound('union_not_found');
  if (union.partner_a_id !== personId && union.partner_b_id !== personId) throw badRequest('union_parent_mismatch');
  return union;
}

/**
 * The union a child will hang from once it gets a second parent: the one the caller named, the
 * only one these two people have, or a new one with status Unknown ("unmarried parents", per the
 * requirements). Two people with several unions need the caller to say which.
 */
async function unionForNewParent(
  trx: Trx,
  actor: Actor,
  existingParent: string,
  newParent: string,
  unionId: string | undefined,
) {
  if (unionId !== undefined) {
    const union = await requireUnionWith(trx, unionId, newParent);
    if (union.partner_a_id !== existingParent && union.partner_b_id !== existingParent) {
      throw badRequest('union_parent_mismatch');
    }
    return union;
  }
  const between = await unionsBetween(trx, existingParent, newParent);
  if (between.length > 1) throw conflict('union_ambiguous');
  const found = between[0];
  if (found) return found;
  const [a, b] = existingParent < newParent ? [existingParent, newParent] : [newParent, existingParent];
  return trx
    .insertInto('unions')
    .values({ partner_a_id: a, partner_b_id: b, status: 'unknown', created_by: actor.id })
    .returning([
      'id',
      'partner_a_id',
      'partner_b_id',
      'status',
      'start_date',
      'start_precision',
      'end_date',
      'end_precision',
      'created_at',
      'updated_at',
    ])
    .executeTakeFirstOrThrow();
}
