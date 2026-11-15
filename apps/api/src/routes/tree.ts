// SPDX-License-Identifier: AGPL-3.0-or-later
import { TREE_MAX_GENERATIONS } from '@kinship/shared';
import type { TreeResponse } from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../errors.js';
import { withActor } from '../people/run.js';
import { getPerson, isUuid, loadTree } from '../people/store.js';

const generations = { type: 'string', pattern: '^[0-9]{1,2}$' };

export function registerTreeRoutes(app: FastifyInstance): void {
  // The people and links needed to draw a tree around one person: `up` generations of ancestors,
  // `down` of descendants, everyone's partners, and (collateral=true) the other descendants of
  // those ancestors, which is what the Family tree view draws.
  app.get(
    '/api/tree/:personId',
    {
      schema: {
        params: { type: 'object', required: ['personId'], properties: { personId: { type: 'string', maxLength: 64 } } },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { up: generations, down: generations, collateral: { type: 'string', enum: ['true', 'false'] } },
        },
      },
    },
    async (request): Promise<TreeResponse> => {
      const { personId } = request.params as { personId: string };
      const query = request.query as { up?: string; down?: string; collateral?: string };
      if (!isUuid(personId)) throw notFound('person_not_found');
      const clamp = (raw: string | undefined, fallback: number) =>
        Math.min(raw === undefined ? fallback : Number(raw), TREE_MAX_GENERATIONS);
      return withActor(request, async (trx) => {
        if (!(await getPerson(trx, personId))) throw notFound('person_not_found');
        return loadTree(trx, {
          focalId: personId,
          up: clamp(query.up, 3),
          down: clamp(query.down, 2),
          collateral: query.collateral === 'true',
        });
      });
    },
  );
}
