// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyRequest } from 'fastify';
import { ApiError, forbidden } from '../errors.js';

/**
 * Only the SuperAdmin. Used as a hook on every backup route: a Family Admin (or anyone else) is refused with 403 whatever the
 * page shows, and an unauthenticated request is refused with 401. This is the server-side check; the web app only hides the tab.
 */
export function requireSuperAdmin(request: FastifyRequest): void {
  if (!request.user) throw new ApiError(401, 'unauthenticated');
  if (request.user.role !== 'superadmin') throw forbidden();
}
