// SPDX-License-Identifier: AGPL-3.0-or-later
import { UNION_END_STATUSES, UNION_STATUSES } from '@kinship/shared';
import type { UnionInput, UnionPatch, UnionResponse, UnionStatus } from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { canEditUnion, isAdmin } from '../people/actor.js';
import { parseDateInput } from '../people/dates.js';
import { withActor } from '../people/run.js';
import { countUnionChildren, getPerson, getUnion, isUuid, unionsBetween, withChildren } from '../people/store.js';
import type { UnionRow } from '../people/store.js';
import type { RouteLimit } from './shared.js';

type Trx = Transaction<Database>;

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
const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } };

function parseStatus(raw: unknown): UnionStatus {
  if (typeof raw === 'string' && (UNION_STATUSES as readonly string[]).includes(raw)) return raw as UnionStatus;
  throw badRequest('invalid_union_status');
}
const hasEndDate = (status: UnionStatus): boolean => (UNION_END_STATUSES as readonly string[]).includes(status);

async function respond(trx: Trx, row: UnionRow): Promise<UnionResponse> {
  const [union] = await withChildren(trx, [row]);
  if (!union) throw notFound('union_not_found');
  return { union };
}

/** The same two people already have a relationship with this status and start date. */
async function isDuplicate(
  trx: Trx,
  a: string,
  b: string,
  status: UnionStatus,
  start: { value: string; precision: string } | null,
  ignoreId?: string,
): Promise<boolean> {
  const others = await unionsBetween(trx, a, b);
  return others.some(
    (u) =>
      u.id !== ignoreId &&
      u.status === status &&
      (u.start_date ?? null) === (start?.value ?? null) &&
      (start === null || u.start_precision === start.precision),
  );
}

export function registerUnionRoutes(app: FastifyInstance, limit: RouteLimit): void {
  app.post(
    '/api/unions',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['partnerIds', 'status'],
          additionalProperties: false,
          properties: {
            partnerIds: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', maxLength: 64 } },
            status: { type: 'string', maxLength: 32 },
            start: dateSchema,
            end: dateSchema,
          },
        },
      },
    },
    async (request, reply): Promise<UnionResponse> => {
      const body = request.body as UnionInput;
      const result = await withActor(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        const [first, second] = body.partnerIds;
        if (first === second) throw badRequest('partners_identical');
        if (!isUuid(first) || !isUuid(second)) throw notFound('person_not_found');
        const status = parseStatus(body.status);
        const start = parseDateInput(body.start ?? null);
        const end = parseDateInput(body.end ?? null);
        if (end !== null && !hasEndDate(status)) throw badRequest('end_date_not_allowed');
        if (!(await getPerson(trx, first)) || !(await getPerson(trx, second))) throw notFound('person_not_found');
        const [a, b] = first < second ? [first, second] : [second, first];
        if (await isDuplicate(trx, a, b, status, start)) throw conflict('duplicate_relationship');
        const row = await trx
          .insertInto('unions')
          .values({
            partner_a_id: a,
            partner_b_id: b,
            status,
            start_date: start?.value ?? null,
            start_precision: start?.precision ?? 'exactly',
            end_date: end?.value ?? null,
            end_precision: end?.precision ?? 'exactly',
            created_by: actor.id,
          })
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
        return respond(trx, row);
      });
      void reply.code(201);
      return result;
    },
  );

  app.get(
    '/api/unions/:id',
    { config: limit, schema: { params: idParams } },
    async (request): Promise<UnionResponse> => {
      const { id } = request.params as { id: string };
      if (!isUuid(id)) throw notFound('union_not_found');
      return withActor(request, async (trx) => {
        const row = await getUnion(trx, id);
        if (!row) throw notFound('union_not_found');
        return respond(trx, row);
      });
    },
  );

  app.patch(
    '/api/unions/:id',
    {
      config: limit,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { status: { type: 'string', maxLength: 32 }, start: dateSchema, end: dateSchema },
        },
      },
    },
    async (request): Promise<UnionResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as UnionPatch;
      if (!isUuid(id)) throw notFound('union_not_found');
      return withActor(request, async (trx, actor) => {
        const current = await getUnion(trx, id);
        if (!current) throw notFound('union_not_found');
        if (!canEditUnion(actor, current)) throw forbidden();

        const status = body.status === undefined ? current.status : parseStatus(body.status);
        const start = body.start === undefined ? undefined : parseDateInput(body.start);
        const end = body.end === undefined ? undefined : parseDateInput(body.end);
        const endAfter = end === undefined ? current.end_date : (end?.value ?? null);
        // Moving to a status without an end date while one is stored is refused, not silently erased:
        // send `end: null` together with the new status.
        if (endAfter !== null && !hasEndDate(status)) throw badRequest('end_date_not_allowed');

        const startAfter =
          start === undefined
            ? { value: current.start_date, precision: current.start_precision }
            : { value: start?.value ?? null, precision: start?.precision ?? 'exactly' };
        if (
          await isDuplicate(
            trx,
            current.partner_a_id,
            current.partner_b_id,
            status,
            startAfter.value === null ? null : { value: startAfter.value, precision: startAfter.precision },
            id,
          )
        ) {
          throw conflict('duplicate_relationship');
        }

        const row = await trx
          .updateTable('unions')
          .set({
            status,
            ...(start !== undefined
              ? { start_date: start?.value ?? null, start_precision: start?.precision ?? 'exactly' }
              : {}),
            ...(end !== undefined ? { end_date: end?.value ?? null, end_precision: end?.precision ?? 'exactly' } : {}),
          })
          .where('id', '=', id)
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
          .executeTakeFirst();
        if (!row) throw forbidden();
        return respond(trx, row);
      });
    },
  );

  app.delete('/api/unions/:id', { config: limit, schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) throw notFound('union_not_found');
    await withActor(request, async (trx, actor) => {
      if (!isAdmin(actor)) throw forbidden();
      if (!(await getUnion(trx, id))) throw notFound('union_not_found');
      // Children never disappear with a relationship: change its status instead.
      if ((await countUnionChildren(trx, id)) > 0) throw conflict('union_has_children');
      await trx.deleteFrom('unions').where('id', '=', id).execute();
    });
    return reply.code(204).send();
  });
}
