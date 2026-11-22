// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin: whether photos can be stored, and the non-secret id of the file key. SuperAdmin only, never cached.
import type { FilesStatus } from '@kinship/shared';
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
  app.get('/api/admin/files', { config: limit }, async (): Promise<FilesStatus> => {
    // Looked at again on every request, so fixing the mount shows up without a restart.
    return files ? files.refresh() : { state: 'key_missing', keyId: null };
  });
}
