// SPDX-License-Identifier: AGPL-3.0-or-later
import { LINEAGE_VIEWS } from '@kinship/shared';
import type { LineageView, RelationshipResponse } from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../errors.js';
import { relationshipBetween } from '../people/relationship.js';
import { withActor } from '../people/run.js';
import { getPerson, isUuid } from '../people/store.js';
import type { RouteLimit } from './shared.js';

export function registerRelationshipRoutes(app: FastifyInstance, limit: RouteLimit): void {
  // How the second person is related to the first (ADR 0028). Any signed-in account may ask: the tree is visible to
  // every role, and the answer carries names and years only (no health, DNA or identity data).
  app.get(
    '/api/relationship',
    {
      config: limit,
      schema: {
        querystring: {
          type: 'object',
          required: ['a', 'b'],
          additionalProperties: false,
          properties: {
            a: { type: 'string', maxLength: 64 },
            b: { type: 'string', maxLength: 64 },
            // Overrides the viewer's own setting.
            lineage: { type: 'string', enum: [...LINEAGE_VIEWS] },
          },
        },
      },
    },
    async (request): Promise<RelationshipResponse> => {
      const query = request.query as { a: string; b: string; lineage?: LineageView };
      if (!isUuid(query.a) || !isUuid(query.b)) throw notFound('person_not_found');
      return withActor(request, async (trx, actor) => {
        // An unknown parent is a hop on a path, never one of the two people asked about.
        for (const id of [query.a, query.b]) {
          const person = await getPerson(trx, id);
          if (!person || person.is_placeholder) throw notFound('person_not_found');
        }
        return relationshipBetween(trx, query.a, query.b, query.lineage ?? actor.lineageView);
      });
    },
  );
}
