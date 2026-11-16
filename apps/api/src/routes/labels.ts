// SPDX-License-Identifier: AGPL-3.0-or-later
import type { LabelInput, LabelPatch, LabelResponse } from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import type { Transaction } from 'kysely';
import type { Database } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { isAdmin } from '../people/actor.js';
import { cleanLabel, cleanOptionalLabel } from '../people/names.js';
import { withActor } from '../people/run.js';
import { LABEL_COLUMNS, getLabel, getPerson, isUuid, toLabel } from '../people/store.js';
import type { RouteLimit } from './shared.js';

type Trx = Transaction<Database>;

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } };
const labelText = { type: 'string', maxLength: 400 };
const reverseText = { anyOf: [{ type: 'null' }, labelText] };

/** The same two people already carry this label in this direction (any case). */
async function isDuplicate(trx: Trx, fromId: string, toId: string, label: string, ignoreId?: string): Promise<boolean> {
  let query = trx
    .selectFrom('relationship_labels')
    .select('id')
    .where('from_id', '=', fromId)
    .where('to_id', '=', toId)
    .where((eb) => eb(eb.fn('lower', ['label']), '=', label.toLowerCase()));
  if (ignoreId) query = query.where('id', '<>', ignoreId);
  return (await query.executeTakeFirst()) !== undefined;
}

/**
 * Custom relationship labels ("Godmother", "Guardian"). Admins only; everyone signed in reads them through
 * GET /api/people/:id. A label is a note: it never creates a parent or partner link and nothing about the tree reads it.
 */
export function registerLabelRoutes(app: FastifyInstance, limit: RouteLimit): void {
  app.post(
    '/api/labels',
    {
      config: limit,
      schema: {
        body: {
          type: 'object',
          required: ['fromId', 'toId', 'label'],
          additionalProperties: false,
          properties: {
            fromId: { type: 'string', maxLength: 64 },
            toId: { type: 'string', maxLength: 64 },
            label: labelText,
            reverseLabel: reverseText,
          },
        },
      },
    },
    async (request, reply): Promise<LabelResponse> => {
      const body = request.body as LabelInput;
      const result = await withActor(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        if (body.fromId === body.toId) throw badRequest('invalid_label');
        if (!isUuid(body.fromId) || !isUuid(body.toId)) throw notFound('person_not_found');
        const label = cleanLabel(body.label);
        const reverse = cleanOptionalLabel(body.reverseLabel);
        if (!(await getPerson(trx, body.fromId)) || !(await getPerson(trx, body.toId))) {
          throw notFound('person_not_found');
        }
        if (await isDuplicate(trx, body.fromId, body.toId, label)) throw conflict('duplicate_label');
        const row = await trx
          .insertInto('relationship_labels')
          .values({
            from_id: body.fromId,
            to_id: body.toId,
            label,
            reverse_label: reverse,
            created_by: actor.id,
          })
          .returning(LABEL_COLUMNS)
          .executeTakeFirstOrThrow();
        return { label: toLabel(row) };
      });
      void reply.code(201);
      return result;
    },
  );

  app.patch(
    '/api/labels/:id',
    {
      config: limit,
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { label: labelText, reverseLabel: reverseText },
        },
      },
    },
    async (request): Promise<LabelResponse> => {
      const { id } = request.params as { id: string };
      const body = request.body as LabelPatch;
      if (!isUuid(id)) throw notFound('label_not_found');
      return withActor(request, async (trx, actor) => {
        if (!isAdmin(actor)) throw forbidden();
        const current = await getLabel(trx, id);
        if (!current) throw notFound('label_not_found');
        const label = body.label === undefined ? current.label : cleanLabel(body.label);
        if (await isDuplicate(trx, current.from_id, current.to_id, label, id)) throw conflict('duplicate_label');
        const row = await trx
          .updateTable('relationship_labels')
          .set({
            label,
            ...(body.reverseLabel !== undefined ? { reverse_label: cleanOptionalLabel(body.reverseLabel) } : {}),
          })
          .where('id', '=', id)
          .returning(LABEL_COLUMNS)
          .executeTakeFirst();
        if (!row) throw forbidden();
        return { label: toLabel(row) };
      });
    },
  );

  app.delete('/api/labels/:id', { config: limit, schema: { params: idParams } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isUuid(id)) throw notFound('label_not_found');
    await withActor(request, async (trx, actor) => {
      if (!isAdmin(actor)) throw forbidden();
      if (!(await getLabel(trx, id))) throw notFound('label_not_found');
      await trx.deleteFrom('relationship_labels').where('id', '=', id).execute();
    });
    return reply.code(204).send();
  });
}
