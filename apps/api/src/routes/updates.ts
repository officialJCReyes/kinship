// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin > Updates (SuperAdmin only, checked here on every route) and the What's new popup (any admin). A GET never starts a
// check: only the schedule and POST /api/admin/updates/check do, and that one is rate-limited.
import { offeredRange, parseSemver, parseUpdateSettings, releasePageUrl } from '@kinship/shared';
import type {
  UpdateBackupAckRequest,
  UpdateDismissRequest,
  UpdateSettings,
  UpdatesResponse,
  WhatsNewResponse,
} from '@kinship/shared';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { requireSuperAdmin } from '../auth/guards.js';
import { ApiError, badRequest, forbidden } from '../errors.js';
import type { UpdateChecker } from '../updates/checker.js';
import type { BundledDocs } from '../updates/docs.js';
import { readUpdateSettings, writeUpdateSettings } from '../updates/settings.js';
import { readCheckState } from '../updates/state.js';
import { computeLatest, computeWhatsNew } from '../updates/whats-new.js';
import type { LogRow } from '../updates/whats-new.js';
import type { VersionInfo } from '../version.js';
import type { RouteLimit } from './shared.js';

/** What the routes need from the running api. */
export interface UpdatesService {
  checker: UpdateChecker;
  docs: BundledDocs;
}

export interface UpdatesRouteDeps {
  version: VersionInfo;
  /** The version the web container last reported. */
  webVersion: () => string | null;
  service: UpdatesService;
}

const versionBody = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: { version: { type: 'string', maxLength: 64 } },
};

export function registerUpdateRoutes(app: FastifyInstance, limit: RouteLimit, deps: UpdatesRouteDeps): void {
  const { version, service } = deps;
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('Cache-Control', 'no-store');
  });

  async function status(request: Parameters<typeof requireSuperAdmin>[0]): Promise<UpdatesResponse> {
    const user = request.user;
    if (!user) throw new ApiError(401, 'unauthenticated');
    const read = await request.withTransaction(async (trx) => {
      const settings = await readUpdateSettings(trx);
      const state = await readCheckState(trx);
      const mine = await sql<{ d: string | null; a: string | null }>`
        select update_dismissed_version as d, update_backup_ack_version as a from users where id = ${user.id}`.execute(
        trx,
      );
      const schema = await sql<{ n: number }>`select schema_number as n from schema_info`.execute(trx);
      return { settings, state, mine: mine.rows[0], schema: schema.rows[0]?.n ?? null };
    });
    const { settings, state } = read;
    return {
      running: {
        version: version.version,
        commit: version.commit,
        buildDate: version.buildDate,
        schema: read.schema,
        webVersion: deps.webVersion(),
      },
      settings,
      check: {
        status: state.status,
        lastAttemptAt: state.lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
        nextCheckAt: settings.check ? (state.nextCheckAt?.toISOString() ?? null) : null,
        viaProxy: service.checker.viaProxy,
      },
      range: settings.check ? offeredRange(state.releases, version.version, settings.preReleases) : null,
      dismissedVersion: read.mine?.d ?? null,
      backupAckVersion: read.mine?.a ?? null,
    };
  }

  // ---- SuperAdmin ----
  app.register(async (admin) => {
    admin.addHook('onRequest', async (request) => {
      requireSuperAdmin(request);
    });

    admin.get('/api/admin/updates', { config: limit }, async (request) => status(request));

    admin.patch(
      '/api/admin/updates/settings',
      { config: limit, schema: { body: { type: 'object', minProperties: 1, additionalProperties: true } } },
      async (request): Promise<UpdateSettings> => {
        const user = request.user;
        const parsed = parseUpdateSettings(request.body);
        if (!parsed.ok) throw new ApiError(400, parsed.code, { field: parsed.field });
        const saved = await request.withTransaction(async (trx) => {
          await writeUpdateSettings(trx, parsed.settings, user?.id ?? null);
          return readUpdateSettings(trx);
        });
        service.checker.settingsChanged();
        return saved;
      },
    );

    admin.post('/api/admin/updates/check', { config: limit }, async (request) => {
      await service.checker.checkNow();
      return status(request);
    });

    admin.post(
      '/api/admin/updates/dismiss',
      { config: limit, schema: { body: versionBody } },
      async (request, reply) => {
        const user = request.user;
        const { version: dismissed } = request.body as UpdateDismissRequest;
        if (!user) throw new ApiError(401, 'unauthenticated');
        if (!parseSemver(dismissed)) throw badRequest('invalid_version');
        await request.withTransaction((trx) =>
          sql`update users set update_dismissed_version = ${dismissed} where id = ${user.id}`.execute(trx),
        );
        return reply.code(204).send();
      },
    );

    admin.post(
      '/api/admin/updates/backup-ack',
      {
        config: limit,
        schema: {
          body: {
            type: 'object',
            required: ['version', 'ack'],
            additionalProperties: false,
            properties: { version: { type: 'string', maxLength: 64 }, ack: { type: 'boolean' } },
          },
        },
      },
      async (request, reply) => {
        const user = request.user;
        const body = request.body as UpdateBackupAckRequest;
        if (!user) throw new ApiError(401, 'unauthenticated');
        if (!parseSemver(body.version)) throw badRequest('invalid_version');
        const value = body.ack ? body.version : null;
        await request.withTransaction((trx) =>
          sql`update users set update_backup_ack_version = ${value} where id = ${user.id}`.execute(trx),
        );
        return reply.code(204).send();
      },
    );
  });

  // ---- any admin ----
  app.register(async (admins) => {
    admins.addHook('onRequest', async (request) => {
      if (!request.user) throw new ApiError(401, 'unauthenticated');
      if (request.user.role !== 'superadmin' && request.user.role !== 'familyadmin') throw forbidden();
    });

    admins.get(
      '/api/updates/whats-new',
      {
        config: limit,
        schema: {
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: { latest: { type: 'string', enum: ['1'] } },
          },
        },
      },
      async (request): Promise<WhatsNewResponse> => {
        const user = request.user;
        if (!user) throw new ApiError(401, 'unauthenticated');
        const read = await request.withTransaction(async (trx) => {
          const mine = await sql<{ v: string | null; at: Date | null }>`
          select last_seen_version as v, last_seen_at as at from users where id = ${user.id}`.execute(trx);
          const log = await sql<LogRow>`
          select event, from_schema, to_schema, from_version, to_version, safety_copy, safety_note, created_at
          from upgrade_log order by created_at, id limit 200`.execute(trx);
          return { mine: mine.rows[0], log: log.rows };
        });
        if ((request.query as { latest?: string }).latest === '1') {
          return computeLatest({ running: version.version, log: read.log, docs: service.docs });
        }
        return computeWhatsNew({
          running: version.version,
          lastSeenVersion: read.mine?.v ?? null,
          lastSeenAt: read.mine?.at ?? null,
          log: read.log,
          docs: service.docs,
        });
      },
    );

    // "Got it": this admin has seen the running version. Idempotent; it never sets any other version.
    admins.post('/api/updates/whats-new/seen', { config: limit }, async (request, reply) => {
      const user = request.user;
      if (!user) throw new ApiError(401, 'unauthenticated');
      await request.withTransaction((trx) =>
        sql`update users set last_seen_version = ${version.version}, last_seen_at = now() where id = ${user.id}`.execute(
          trx,
        ),
      );
      return reply.code(204).send();
    });
  });
}

export { releasePageUrl };
