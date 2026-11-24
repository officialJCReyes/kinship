// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, LINK_KINDS, PEOPLE_PAGE_DEFAULT, PEOPLE_PAGE_MAX, SEARCH_MAX_LENGTH } from '@kinship/shared';
import type {
  AddChildRequest,
  AddParentRequest,
  AddSiblingRequest,
  SiblingResponse,
  LinkableChildrenResponse,
  LinkKind,
  UpdateParentLinkRequest,
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
import { getMedia, mediaPeople, deleteMediaOnlyOf } from '../media/store.js';
import { removeFiles } from './media.js';
import { canAddChildUnder, canEditPerson, isAdmin } from '../people/actor.js';
import type { Actor } from '../people/actor.js';
import { parseDateInput } from '../people/dates.js';
import { linkableChildren } from '../people/link-children.js';
import { withActor } from '../people/run.js';
import { cleanName, cleanOptionalName } from '../people/names.js';
import {
  UNION_COLUMNS,
  decodeCursor,
  deletePreview,
  encodeCursor,
  getParentageRow,
  getParentSets,
  getPerson,
  getUnion,
  insertPerson,
  insertPlaceholder,
  isUuid,
  labelsOfPerson,
  listPeople,
  normalizeSearchWords,
  parentAgeWarnings,
  partnerChildrenOf,
  personHasAccount,
  removeOrphanPlaceholders,
  singleParentChildLinks,
  toParentage,
  toPerson,
  unionsBetween,
  unionsOfPerson,
  updatePerson,
  withChildren,
} from '../people/store.js';
import type { PersonRow, PersonValues } from '../people/store.js';
import type { FilesService } from '../files/state.js';
import type { RouteLimit } from './shared.js';

type Trx = Transaction<Database>;

const uuidParam = (name: string) => ({
  type: 'object',
  required: [name],
  properties: { [name]: { type: 'string', maxLength: 64 } },
});

const kindSchema = { type: 'string', enum: [...LINK_KINDS] } as const;

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
  secondSurname: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
  marriedSurname: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
  namePrefix: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
  nameSuffix: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
  nickname: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
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
  properties: { ...personProperties, photoMediaId: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 64 }] } },
};

export function parseGender(raw: unknown): 'male' | 'female' | 'other' | null {
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
    second_surname: cleanOptionalName(input.secondSurname, 'invalid_second_surname'),
    married_surname: cleanOptionalName(input.marriedSurname, 'invalid_married_surname'),
    name_prefix: cleanOptionalName(input.namePrefix, 'invalid_name_prefix'),
    name_suffix: cleanOptionalName(input.nameSuffix, 'invalid_name_suffix'),
    nickname: cleanOptionalName(input.nickname, 'invalid_nickname'),
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
  if (patch.secondSurname !== undefined) {
    values.second_surname = cleanOptionalName(patch.secondSurname, 'invalid_second_surname');
  }
  if (patch.marriedSurname !== undefined) {
    values.married_surname = cleanOptionalName(patch.marriedSurname, 'invalid_married_surname');
  }
  if (patch.namePrefix !== undefined) values.name_prefix = cleanOptionalName(patch.namePrefix, 'invalid_name_prefix');
  if (patch.nameSuffix !== undefined) values.name_suffix = cleanOptionalName(patch.nameSuffix, 'invalid_name_suffix');
  if (patch.nickname !== undefined) values.nickname = cleanOptionalName(patch.nickname, 'invalid_nickname');
  if (patch.gender !== undefined) values.gender = parseGender(patch.gender);
  if (patch.photoMediaId !== undefined) {
    if (patch.photoMediaId !== null && !isUuid(patch.photoMediaId)) throw notFound('photo_not_found');
    values.photo_media_id = patch.photoMediaId;
  }
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

export function registerPeopleRoutes(app: FastifyInstance, limit: RouteLimit, files?: FilesService): void {
  const run = withActor;

  // --- list and search ------------------------------------------------------
  app.get(
    '/api/people',
    {
      config: limit,
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
  app.get(
    '/api/people/:id',
    { config: limit, schema: { params: uuidParam('id') } },
    async (request): Promise<PersonDetail> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('person_not_found');
      return run(request, async (trx, actor) => {
        const person = await getPerson(trx, id);
        if (!person) throw notFound('person_not_found');
        const parents = await getParentSets(trx, id);
        const unions = await withChildren(trx, await unionsOfPerson(trx, id));
        const singles = await singleParentChildLinks(trx, id);
        const admin = isAdmin(actor);
        return {
          person: toPerson(person),
          parents,
          unions,
          singleParentChildren: singles,
          permissions: {
            edit: await canEditPerson(trx, actor, person),
            delete: admin,
            addChild: await canAddChildUnder(trx, actor, id),
          },
          hasAccount: await personHasAccount(trx, id),
          labels: await labelsOfPerson(trx, id),
          partnerChildren: await partnerChildrenOf(
            trx,
            id,
            [...new Set(unions.map((u) => u.partnerIds.find((p) => p !== id) ?? u.partnerIds[0]))],
            actor.lineageView,
          ),
        };
      });
    },
  );

  // --- create (admins; a Member adds people only as children, below) ---------
  app.post(
    '/api/people',
    { config: limit, schema: { body: personInputSchema } },
    async (request, reply): Promise<PersonResponse> => {
      const body = request.body as PersonInput;
      const result = await run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        const row = await insertPerson(trx, actor.id, parsePersonInput(body));
        return { person: toPerson(row), warnings: [] };
      });
      void reply.code(201);
      return result;
    },
  );

  // --- change ---------------------------------------------------------------
  app.patch(
    '/api/people/:id',
    { config: limit, schema: { params: uuidParam('id'), body: personPatchSchema } },
    async (request): Promise<PersonResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as PersonPatch;
      if (!isUuid(id)) throw notFound('person_not_found');
      return run(request, async (trx, actor) => {
        const current = await getPerson(trx, id);
        if (!current) throw notFound('person_not_found');
        if (!(await canEditPerson(trx, actor, current))) throw forbidden();
        const values = parsePersonPatch(body, current);
        if (current.is_placeholder) {
          // Giving an unknown parent a name makes them an ordinary person. Both names are needed (the form sends both).
          if (values.given_name === undefined || values.surname === undefined)
            throw badRequest('placeholder_needs_name');
          values.is_placeholder = false;
        }
        if (values.photo_media_id) {
          // The profile photo must be a photo of this person. Said clearly here; the database insists on it too.
          if (!(await getMedia(trx, values.photo_media_id))) throw notFound('photo_not_found');
          if (!(await mediaPeople(trx, values.photo_media_id)).includes(id)) throw conflict('photo_not_linked');
        }
        const row = await updatePerson(trx, id, values);
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
      config: limit,
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
      const gone = await run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (!(await getPerson(trx, id))) throw notFound('person_not_found');
        if (await personHasAccount(trx, id)) throw conflict('person_has_account');
        const preview = await deletePreview(trx, id);
        if ((preview.unions > 0 || preview.children > 0) && !confirmed) {
          throw conflict('confirm_required', { ...preview });
        }
        // The photos that show only this person go with them; a photo that shows someone else too stays (its link goes).
        const photos = await deleteMediaOnlyOf(trx, id);
        // The database moves the children and removes the unions (trigger in migration 0004).
        await trx.deleteFrom('people').where('id', '=', id).execute();
        // An "Unknown" pair nobody hangs from any more goes with the last child.
        await removeOrphanPlaceholders(trx);
        return photos;
      });
      // After the commit, so a rolled-back delete never loses a file (one left behind is only an orphan the sweeper removes).
      removeFiles(request, files, gone.storageIds);
      return reply.code(204).send();
    },
  );

  // --- add a child under a person (admins, and Members under themselves and their descendants) ---
  app.post(
    '/api/people/:id/children',
    {
      config: limit,
      schema: {
        params: uuidParam('id'),
        body: {
          type: 'object',
          required: ['child'],
          additionalProperties: false,
          properties: {
            child: personInputSchema,
            unionId: { type: 'string', maxLength: 64 },
            kind: kindSchema,
            link: dateSchema,
          },
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
        const kind: LinkKind = body.kind ?? 'birth';
        // Adoption links change two families, so they are for admins; a Member adding a child adds a birth link.
        if (kind !== 'birth' && !isAdmin(actor)) throw forbidden();
        const link = parseDateInput(body.link ?? null);
        if (body.unionId !== undefined) {
          if (!isUuid(body.unionId)) throw notFound('union_not_found');
          const union = await getUnion(trx, body.unionId);
          if (!union) throw notFound('union_not_found');
          if (union.partner_a_id !== id && union.partner_b_id !== id) throw badRequest('union_parent_mismatch');
        }
        const values = parsePersonInput(body.child);
        const child = await insertPerson(trx, actor.id, values);
        const row = {
          kind,
          union_id: body.unionId ?? null,
          parent_id: body.unionId === undefined ? id : null,
          link_date: link?.value ?? null,
          link_precision: link?.precision ?? ('exactly' as const),
        };
        await trx
          .insertInto('person_parents')
          .values({ child_id: child.id, ...row, created_by: actor.id })
          .execute();
        return {
          person: toPerson(child),
          parentage: toParentage(row),
          warnings: await parentAgeWarnings(trx, child.id),
        };
      });
      void reply.code(201);
      return result;
    },
  );

  // --- add a brother or sister (admins) ------------------------------------------
  // One transaction. The new person gets the same parent set as this person. When this person has no parents of that
  // kind (birth only), two placeholder parents ("Unknown father", "Unknown mother") and an Unknown relationship are
  // created and both children are linked to them. With one parent, that parent is reused and no placeholder is added.
  app.post(
    '/api/people/:id/siblings',
    {
      config: limit,
      schema: {
        params: uuidParam('id'),
        body: {
          type: 'object',
          required: ['sibling'],
          additionalProperties: false,
          properties: { sibling: personInputSchema, kind: kindSchema, link: dateSchema },
        },
      },
    },
    async (request, reply): Promise<SiblingResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as AddSiblingRequest;
      if (!isUuid(id)) throw notFound('person_not_found');
      const result = await run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (!(await getPerson(trx, id))) throw notFound('person_not_found');
        const kind: LinkKind = body.kind ?? 'birth';
        const link = parseDateInput(body.link ?? null);
        const values = parsePersonInput(body.sibling);
        const placeholders: PersonRow[] = [];
        let set = await getParentageRow(trx, id, kind);
        if (!set) {
          if (kind !== 'birth') throw badRequest('sibling_needs_parent');
          const father = await insertPlaceholder(trx, actor.id, 'male');
          const mother = await insertPlaceholder(trx, actor.id, 'female');
          placeholders.push(father, mother);
          const [a, b] = father.id < mother.id ? [father.id, mother.id] : [mother.id, father.id];
          const union = await trx
            .insertInto('unions')
            .values({ partner_a_id: a, partner_b_id: b, status: 'unknown', created_by: actor.id })
            .returning(UNION_COLUMNS)
            .executeTakeFirstOrThrow();
          await trx
            .insertInto('person_parents')
            .values({ child_id: id, kind, union_id: union.id, parent_id: null, created_by: actor.id })
            .execute();
          set = await getParentageRow(trx, id, kind);
          if (!set) throw badRequest('sibling_needs_parent');
        }
        const sibling = await insertPerson(trx, actor.id, values);
        const row = {
          kind,
          union_id: set.union_id,
          parent_id: set.parent_id,
          link_date: link?.value ?? null,
          link_precision: link?.precision ?? ('exactly' as const),
        };
        await trx
          .insertInto('person_parents')
          .values({ child_id: sibling.id, ...row, created_by: actor.id })
          .execute();
        return {
          person: toPerson(sibling),
          parentage: toParentage(row),
          placeholders: placeholders.map(toPerson),
          warnings: await parentAgeWarnings(trx, sibling.id),
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
      config: limit,
      schema: {
        params: uuidParam('id'),
        body: {
          type: 'object',
          required: ['parentId'],
          additionalProperties: false,
          properties: {
            parentId: { type: 'string', maxLength: 64 },
            unionId: { type: 'string', maxLength: 64 },
            kind: kindSchema,
            link: dateSchema,
          },
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

        const kind: LinkKind = body.kind ?? 'birth';
        const link = parseDateInput(body.link ?? null);
        const existing = await getParentageRow(trx, childId, kind);
        let parentage: Parentage;

        if (!existing) {
          const row =
            body.unionId === undefined
              ? { union_id: null, parent_id: body.parentId }
              : { union_id: (await requireUnionWith(trx, body.unionId, body.parentId)).id, parent_id: null };
          const values = {
            kind,
            ...row,
            link_date: link?.value ?? null,
            link_precision: link?.precision ?? ('exactly' as const),
          };
          await trx
            .insertInto('person_parents')
            .values({ child_id: childId, ...values, created_by: actor.id })
            .execute();
          parentage = toParentage(values);
        } else if (existing.parent_id !== null) {
          if (existing.parent_id === body.parentId) throw conflict('parent_already_linked');
          // A second parent joins the set: the relationship the two already have, or a new one with status Unknown.
          const union = await unionForNewParent(trx, actor, existing.parent_id, body.parentId, body.unionId);
          await trx
            .updateTable('person_parents')
            .set({ union_id: union.id, parent_id: null })
            .where('child_id', '=', childId)
            .where('kind', '=', kind)
            .execute();
          parentage = toParentage({ ...existing, union_id: union.id, parent_id: null });
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

  // --- children who could also be another person's (admins; ADR 0039) ----------------
  // The children who hang from this person alone. With `partner` (an existing person who would become their second parent),
  // the ones the database would refuse are left out; `exclude` leaves out a child the dialog links anyway.
  app.get(
    '/api/people/:id/linkable-children',
    {
      config: limit,
      schema: {
        params: uuidParam('id'),
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            partner: { type: 'string', maxLength: 64 },
            exclude: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (request): Promise<LinkableChildrenResponse> => {
      const { id } = request.params as { id: string };
      const query = request.query as { partner?: string; exclude?: string };
      if (!isUuid(id)) throw notFound('person_not_found');
      return run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (!(await getPerson(trx, id))) throw notFound('person_not_found');
        const partner = query.partner ?? null;
        if (partner !== null && (!isUuid(partner) || !(await getPerson(trx, partner))))
          throw notFound('person_not_found');
        const exclude = query.exclude !== undefined && isUuid(query.exclude) ? [query.exclude] : [];
        const found = await linkableChildren(trx, id, partner, exclude);
        return { children: found.map(({ row, kind }) => ({ child: toPerson(row), kind })) };
      });
    },
  );

  // --- remove one parent --------------------------------------------------------
  app.delete(
    '/api/people/:id/parents/:parentId',
    {
      config: limit,
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
        // A person cannot be a parent in both sets (except in a stepparent adoption, where the adoptive set is a
        // union), so the parent says which set to take them out of. When the adoptive set is the union of the
        // staying birth parent and the stepparent, removing the stepparent leaves the adoptive set as the birth
        // parent alone, which the database refuses (it would repeat a birth parent), so that set is removed.
        for (const kind of LINK_KINDS) {
          const existing = await getParentageRow(trx, childId, kind);
          if (!existing) continue;
          if (existing.parent_id !== null) {
            if (existing.parent_id !== parentId) continue;
            await trx.deleteFrom('person_parents').where('child_id', '=', childId).where('kind', '=', kind).execute();
            return { parentage: null, warnings: [] };
          }
          const union = await getUnion(trx, existing.union_id as string);
          if (!union || (union.partner_a_id !== parentId && union.partner_b_id !== parentId)) continue;
          const remaining = union.partner_a_id === parentId ? union.partner_b_id : union.partner_a_id;
          const other = await getParentageRow(trx, childId, kind === 'birth' ? 'adoptive' : 'birth');
          const otherParents = other ? await parentsOfRow(trx, other) : [];
          if (otherParents.includes(remaining)) {
            await trx.deleteFrom('person_parents').where('child_id', '=', childId).where('kind', '=', kind).execute();
            return { parentage: null, warnings: [] };
          }
          await trx
            .updateTable('person_parents')
            .set({ union_id: null, parent_id: remaining })
            .where('child_id', '=', childId)
            .where('kind', '=', kind)
            .execute();
          return { parentage: toParentage({ ...existing, union_id: null, parent_id: remaining }), warnings: [] };
        }
        throw notFound('parent_not_found');
      });
    },
  );

  // --- change the date of a parent link (admins) ---------------------------------
  app.patch(
    '/api/people/:id/parents/:kind',
    {
      config: limit,
      schema: {
        params: {
          type: 'object',
          required: ['id', 'kind'],
          properties: { id: { type: 'string', maxLength: 64 }, kind: { type: 'string', maxLength: 16 } },
        },
        body: { type: 'object', required: ['link'], additionalProperties: false, properties: { link: dateSchema } },
      },
    },
    async (request): Promise<ParentageResponse> => {
      const { id: childId, kind } = request.params as { id: string; kind: string };
      const body = request.body as UpdateParentLinkRequest;
      if (!isUuid(childId)) throw notFound('person_not_found');
      if (!(LINK_KINDS as readonly string[]).includes(kind)) throw badRequest('invalid_link_kind');
      return run(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        const link = parseDateInput(body.link);
        const existing = await getParentageRow(trx, childId, kind as LinkKind);
        if (!existing) throw notFound('parent_not_found');
        await trx
          .updateTable('person_parents')
          .set({ link_date: link?.value ?? null, link_precision: link?.precision ?? 'exactly' })
          .where('child_id', '=', childId)
          .where('kind', '=', kind as LinkKind)
          .execute();
        return {
          parentage: toParentage({
            ...existing,
            link_date: link?.value ?? null,
            link_precision: link?.precision ?? 'exactly',
          }),
          warnings: [],
        };
      });
    },
  );
}

/** The parents in one set of links. */
async function parentsOfRow(trx: Trx, row: { union_id: string | null; parent_id: string | null }): Promise<string[]> {
  if (row.parent_id !== null) return [row.parent_id];
  const union = row.union_id ? await getUnion(trx, row.union_id) : undefined;
  return union ? [union.partner_a_id, union.partner_b_id] : [];
}

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
    .returning(UNION_COLUMNS)
    .executeTakeFirstOrThrow();
}
