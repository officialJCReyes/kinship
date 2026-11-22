// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin: whether photos can be stored, and the non-secret id of the file key. SuperAdmin only, never cached.
import type { FilesStatus } from '@kinship/shared';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { requireSuperAdmin } from '../auth/guards.js';
import type { FilesService } from '../files/state.js';
import type { RouteLimit } from './shared.js';

export function registerFilesAdminRoutes(
  app: FastifyInstance,
  limit: RouteLimit,
  files: FilesService | undefined,
): void {
  app.addHook('onRequest', async (request) => {
    requireSuperAdmin(request);
  });
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
  });
  app.get('/api/admin/files', { config: limit }, async (request): Promise<FilesStatus> => {
    // Looked at again on every request, so fixing the mount shows up without a restart.
    const status = files ? await files.refresh() : { state: 'key_missing' as const, keyId: null };
    const totals = await request.withTransaction((trx) =>
      sql<{ n: string; bytes: string }>`
          select count(*)::text as n, coalesce(sum(size + avatar_size), 0)::text as bytes from media_files`.execute(
        trx,
      ),
    );
    return { ...status, photos: Number(totals.rows[0]?.n ?? 0), photoBytes: Number(totals.rows[0]?.bytes ?? 0) };
  });
}
