// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Restoring from the app (ADR 0031): the maintenance gate, the two routes, and the order of a restore (pause, drain, check again,
// close the pool, replace, record, exit). Every flow runs against a real Postgres 18 and a real backup.
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESTORE_TICKET_SECONDS, RESTORE_WORD } from '@kinship/shared';
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackup } from '../src/backup/archive.js';
import type { BackupContext } from '../src/backup/archive.js';
import { createRestoreService, lastRestoreOf, reconcileRestores } from '../src/backup/restore-service.js';
import { createScheduler } from '../src/backup/scheduler.js';
import { readState, recordRestoreStart } from '../src/backup/state.js';
import { createJobRunner } from '../src/jobs/runner.js';
import { createMaintenance } from '../src/maintenance.js';
import { CSRF, PASSWORD, createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';
import type { Family } from './helpers/family.js';
import { realMigrationsDir, tempMigrationsDir } from './helpers/migrations-dir.js';
import { testConfig, testTools } from './helpers/pg-tools.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Rig {
  t: TestApp;
  dir: string;
  family: Family;
  ctx: BackupContext;
  maintenance: ReturnType<typeof createMaintenance>;
  scheduler: ReturnType<typeof createScheduler>;
  logs: string[];
  exits: number[];
  calls: { paused: number; resumed: number; poolClosed: number };
  as: Awaited<ReturnType<typeof signInAll>>;
  app: FastifyInstance;
  release: () => void;
  service: ReturnType<typeof createRestoreService>;
}

/** A migrated database with the Hale family, the api on top with the maintenance gate and the restore service, and a backups folder. */
async function rig(
  options: {
    drainMs?: number;
    tools?: Partial<BackupContext['tools']>;
    migrationsDir?: string;
    configure?: (ctx: BackupContext) => BackupContext;
  } = {},
): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), 'kinship-restore-routes-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const maintenance = createMaintenance({ lastRestore: () => lastRestoreOf(dir) });
  const holder: { service?: ReturnType<typeof createRestoreService>; scheduler?: ReturnType<typeof createScheduler> } =
    {};
  // A request that never ends until a test says so, for the drain.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const t = await createTestApp(
    {
      maintenance,
      backups: {
        dir,
        scheduler: new Proxy({} as ReturnType<typeof createScheduler>, {
          get: (_target, prop) => (holder.scheduler as unknown as Record<string | symbol, unknown>)[prop],
        }),
        restore: new Proxy({} as ReturnType<typeof createRestoreService>, {
          get: (_target, prop) => (holder.service as unknown as Record<string | symbol, unknown>)[prop],
        }),
      },
    },
    (app) => {
      app.get('/api/test-slow', async () => {
        await gate;
        return { ok: true };
      });
    },
  );
  cleanups.push(() => t.close());
  const family = await buildFamily(t.owner);
  await sql`insert into family_tree (id, name) values (true, 'Hale Family')`.execute(t.owner);
  const logs: string[] = [];
  const migrationsDir = options.migrationsDir ?? realMigrationsDir;
  let ctx: BackupContext = {
    config: { ...testConfig(t.test, dir, PASS), migrationsDir },
    tools: { ...testTools(), ...options.tools },
    log: (level, message, fields) => logs.push(JSON.stringify({ level, message, ...fields })),
    appVersion: '0.3.0-test',
    kdf: CHEAP,
  };
  if (options.configure) ctx = options.configure(ctx);
  const scheduler = createScheduler(ctx);
  holder.scheduler = scheduler;
  const exits: number[] = [];
  const calls = { paused: 0, resumed: 0, poolClosed: 0 };
  const jobs = createJobRunner(() => undefined);
  const service = createRestoreService({
    ctx,
    maintenance,
    scheduler,
    pause: async () => {
      calls.paused += 1;
      jobs.pause();
      return jobs.idle(1000);
    },
    resume: () => {
      calls.resumed += 1;
      jobs.resume();
    },
    closePool: async () => {
      calls.poolClosed += 1;
      await t.db.destroy();
    },
    closeIdle: () => undefined,
    exit: (code) => exits.push(code),
    drainMs: options.drainMs ?? 5000,
    newId: () => 'restore-test-id',
  });
  holder.service = service;
  const as = await signInAll(t.app, family);
  return { t, dir, family, ctx, maintenance, scheduler, logs, exits, calls, as, app: t.app, release, service };
}

/** Everything that identifies the data, as the owner sees it. */
async function snapshot(owner: TestApp['owner']) {
  const counts = await sql<{ people: number; users: number; unions: number }>`
    select (select count(*) from people)::int as people, (select count(*) from users)::int as users,
           (select count(*) from unions)::int as unions`.execute(owner);
  return counts.rows[0];
}

async function waitFor(check: () => boolean | Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const check = (r: Rig, name: string, who: 'superadmin' | 'familyadmin' = 'superadmin') =>
  r.as(who, 'POST', '/api/admin/backups/restore-check', { name });
const restore = (r: Rig, body: object) => r.as('superadmin', 'POST', '/api/admin/backups/restore', body);

describe('the maintenance gate', () => {
  it('lets health, version and maintenance through and answers everything else 503 maintenance, without the database', async () => {
    const r = await rig();
    // Idle: the site serves.
    expect((await r.as('superadmin', 'GET', '/api/people')).status).toBe(200);
    expect(await r.as('anonymous', 'GET', '/api/maintenance')).toMatchObject({
      status: 200,
      body: { phase: 'idle', since: null },
    });
    r.maintenance.set('replacing');
    const gated = await r.app.inject({ method: 'GET', url: '/api/people', headers: CSRF });
    expect(gated.statusCode).toBe(503);
    expect(gated.json()).toEqual({ error: 'maintenance', phase: 'replacing' });
    expect(gated.headers['retry-after']).toBe('5');
    expect(gated.headers['cache-control']).toBe('no-store');
    for (const [method, url] of [
      ['POST', '/api/auth/login'],
      ['GET', '/api/auth/me'],
      ['GET', '/api/admin/backups'],
    ] as const) {
      expect((await r.app.inject({ method, url, headers: CSRF })).statusCode, url).toBe(503);
    }
    // Health is 200 with the phase, and works with the app pool gone.
    await r.t.db.destroy();
    expect((await r.app.inject({ url: '/api/health' })).json()).toEqual({ status: 'maintenance', database: 'ok' });
    expect((await r.app.inject({ url: '/api/health' })).statusCode).toBe(200);
    expect((await r.app.inject({ url: '/api/version' })).statusCode).toBe(200);
    const status = (await r.app.inject({ url: '/api/maintenance' })).json();
    expect(status).toEqual({ phase: 'replacing', since: expect.any(String) });
    r.maintenance.set('idle');
    expect((await r.app.inject({ url: '/api/maintenance' })).json()).toEqual({ phase: 'idle', since: null });
  }, 90_000);

  it('counts the requests that began before the gate, and waits for them', async () => {
    const r = await rig();
    const slow = r.app.inject({ method: 'GET', url: '/api/test-slow', headers: CSRF });
    await waitFor(() => r.maintenance.inFlight() === 1, 'the slow request to start');
    r.maintenance.set('pausing');
    expect(await r.maintenance.drain(50)).toBe(false);
    const drained = r.maintenance.drain(5000);
    r.release();
    expect(await drained).toBe(true);
    expect((await slow).statusCode).toBe(200);
    expect(r.maintenance.inFlight()).toBe(0);
    // The health, version and maintenance checks are not counted.
    await r.app.inject({ url: '/api/health' });
    await r.app.inject({ url: '/api/maintenance' });
    expect(r.maintenance.inFlight()).toBe(0);
  }, 60_000);

  it('has a cheap rate limit on the public maintenance status', async () => {
    const r = await rig();
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await r.app.inject({ url: '/api/maintenance' })).statusCode;
    expect(last).toBe(429);
  }, 60_000);

  it('pauses the scheduler and the job runner, and resumes them', async () => {
    const r = await rig();
    expect(r.scheduler.startRun()).toBe(true);
    await waitFor(() => !r.scheduler.running, 'the backup');
    r.scheduler.pause();
    expect(r.scheduler.startRun()).toBe(false);
    expect(r.scheduler.startTest()).toBe(false);
    await expect(r.scheduler.runNow()).rejects.toMatchObject({ kind: 'busy' });
    r.scheduler.resume();
    expect(r.scheduler.startTest()).toBe(true);
    await waitFor(() => !r.scheduler.running, 'the test');

    const jobs = createJobRunner(() => undefined);
    let runs = 0;
    jobs.register({ name: 'a', run: () => Promise.resolve(void (runs += 1)) });
    await jobs.tick();
    jobs.pause();
    await jobs.tick();
    expect(runs).toBe(1);
    jobs.resume();
    await jobs.tick();
    expect(runs).toBe(2);
    let finish: () => void = () => undefined;
    jobs.register({ name: 'slow', run: () => new Promise<void>((resolve) => (finish = resolve)) });
    const ticking = jobs.tick();
    expect(await jobs.idle(30)).toBe(false);
    finish();
    await ticking;
    expect(await jobs.idle(30)).toBe(true);
  }, 120_000);
});

describe('who may check and restore, and what the check says', () => {
  it('is for the SuperAdmin only; nobody else can even ask', async () => {
    const r = await rig();
    for (const who of ['anonymous', 'familyadmin', 'member', 'unlinked', 'user'] as const) {
      const expected = who === 'anonymous' ? 401 : 403;
      expect((await r.as(who, 'POST', '/api/admin/backups/restore-check', { name: 'x' })).status, who).toBe(expected);
      expect(
        (await r.as(who, 'POST', '/api/admin/backups/restore', { ticket: 'x', word: 'RESTORE', password: 'y' })).status,
        who,
      ).toBe(expected);
    }
    expect(r.maintenance.active()).toBe(false);
  }, 90_000);

  it('needs the CSRF header', async () => {
    const r = await rig();
    const cookie = String(
      (
        await r.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: CSRF,
          payload: { email: r.family.account.superadmin.email, password: PASSWORD },
        })
      ).headers['set-cookie'],
    ).split(';')[0];
    const response = await r.app.inject({
      method: 'POST',
      url: '/api/admin/backups/restore',
      headers: { cookie: cookie ?? '' },
      payload: { ticket: 'x', word: 'RESTORE', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'csrf' });
  }, 60_000);

  it('answers the facts for a listed archive, with a ticket, and changes nothing', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    const before = await snapshot(r.t.owner);
    const answer = await check(r, made.name);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({
      name: made.name,
      createdAt: made.manifest.createdAt,
      appVersion: '0.3.0-test',
      schema: made.manifest.schema,
      pendingMigrations: 0,
      newerApp: false,
      accounts: 5,
      ownAccountMissing: false,
      ticket: expect.any(String),
    });
    expect(Date.parse(answer.body?.['expiresAt'] as string) - Date.now()).toBeLessThanOrEqual(
      RESTORE_TICKET_SECONDS * 1000,
    );
    expect(r.maintenance.active()).toBe(false);
    expect(await snapshot(r.t.owner)).toEqual(before);
    // Still signed in, still served.
    expect((await r.as('superadmin', 'GET', '/api/people')).status).toBe(200);
    // Ask again after the account was "made" after the backup: it is not in it.
    await sql`update users set created_at = now() + interval '1 day' where id = ${r.family.account.superadmin.id}`.execute(
      r.t.owner,
    );
    expect((await check(r, made.name)).body?.['ownAccountMissing']).toBe(true);
    // No file path anywhere in the answer.
    expect(JSON.stringify(answer.body)).not.toContain(r.dir);
  }, 120_000);

  it('only restores a LISTED encrypted archive: traversal, absolute paths, plain copies and strangers are not found', async () => {
    const r = await rig();
    await createBackup(r.ctx, { kind: 'manual' });
    writeFileSync(join(r.dir, 'pre-upgrade-0012-to-0013.sql.gz'), 'DROP SCHEMA public CASCADE;');
    writeFileSync(join(r.dir, 'notes.tar.enc'), 'not ours');
    for (const name of [
      '../kinship-2026-01-01-0000.tar.enc',
      `${r.dir}/pre-restore-20260101-000000.tar.enc`,
      'pre-upgrade-0012-to-0013.sql.gz',
      'notes.tar.enc',
      'kinship-2026-01-01-0000.tar.enc',
      '',
    ]) {
      const answer = await check(r, name);
      expect(answer.status, name).toBe(404);
      expect(answer.body).toEqual({ error: 'backup_not_found' });
    }
    expect(r.maintenance.active()).toBe(false);
  }, 90_000);

  it('says why a backup cannot be restored (a wrong passphrase, a refusal), with codes and no paths', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    // A damaged archive: a code, no text from the tools.
    const bytes = readFileSync(join(r.dir, made.name));
    bytes[bytes.length - 50] = (bytes[bytes.length - 50] ?? 0) ^ 1;
    writeFileSync(join(r.dir, 'kinship-2020-01-01-0000.tar.enc'), bytes);
    const damaged = await check(r, 'kinship-2020-01-01-0000.tar.enc');
    expect(damaged.status).toBe(400);
    expect(damaged.body).toEqual({ error: 'restore_failed', errorKind: 'corrupt' });
    // Not enough room in the backups folder: both amounts, no path.
    const tight = await rig({ configure: (c) => ({ ...c, freeBytes: () => 1000 }) });
    const tightBackup = await createBackup({ ...tight.ctx, freeBytes: () => 1e12 }, { kind: 'manual' });
    const noRoom = await check(tight, tightBackup.name);
    expect(noRoom.body).toMatchObject({ error: 'restore_failed', errorKind: 'disk_space' });
    expect(String(noRoom.body?.['detail'])).toMatch(/bytes are needed.*1000 are available/);
    expect(JSON.stringify(noRoom.body)).not.toContain(tight.dir);
  }, 180_000);

  it('limits the check to six a minute for an account', async () => {
    const r = await rig();
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await check(r, 'kinship-2026-01-01-0000.tar.enc')).status;
    expect(last).toBe(429);
  }, 60_000);
});

describe('the restore route: the word, the password and the ticket', () => {
  it('refuses a wrong word and a wrong password without spending the ticket, and a ticket that is not this account’s', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    const { ticket } = (await check(r, made.name)).body as { ticket: string };
    expect(await restore(r, { ticket, word: 'restore', password: PASSWORD })).toMatchObject({
      status: 400,
      body: { error: 'invalid_restore_word' },
    });
    expect(await restore(r, { ticket, word: RESTORE_WORD, password: 'not the password at all' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_current_password' },
    });
    expect(await restore(r, { ticket: 'nothing', word: RESTORE_WORD, password: PASSWORD })).toMatchObject({
      status: 400,
      body: { error: 'restore_ticket_invalid' },
    });
    expect(r.maintenance.active()).toBe(false);
    expect(readState(r.dir).restores).toEqual([]);
    // The ticket survived all of that, and the extra properties are refused by the schema.
    expect((await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD, extra: 1 })).status).toBe(400);
    expect(r.exits).toEqual([]);
  }, 120_000);

  it('a ticket expires after 60 seconds', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    const { ticket } = (await check(r, made.name)).body as { ticket: string };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (RESTORE_TICKET_SECONDS + 1) * 1000);
    expect(await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD })).toMatchObject({
      status: 400,
      body: { error: 'restore_ticket_invalid' },
    });
    expect(r.maintenance.active()).toBe(false);
  }, 90_000);
});

describe('a restore from the app', () => {
  it('pauses, replaces everything, signs everyone out, records the result and exits 0', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    const before = await snapshot(r.t.owner);
    // Things happen after the backup.
    await sql`insert into people (given_name, surname) values ('Added', 'Later')`.execute(r.t.owner);
    await sql`delete from person_parents`.execute(r.t.owner);
    await sql`delete from unions`.execute(r.t.owner);
    const { ticket } = (await check(r, made.name)).body as { ticket: string };

    const answer = await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD });
    expect(answer).toMatchObject({ status: 202, body: { started: true } });
    await waitFor(() => r.exits.length > 0, 'the restore to end');
    expect(r.exits).toEqual([0]);

    // The data is the backup's, nobody is signed in, and the pool was closed once.
    expect(await snapshot(r.t.owner)).toEqual(before);
    expect((await sql`select count(*)::int as n from sessions`.execute(r.t.owner)).rows[0]).toEqual({ n: 0 });
    expect(r.calls).toEqual({ paused: 1, resumed: 0, poolClosed: 1 });
    // The gate stays up until the process is gone.
    expect(r.maintenance.phase()).toBe('finishing');
    expect((await r.app.inject({ method: 'GET', url: '/api/people', headers: CSRF })).statusCode).toBe(503);

    // state.json and the public status: how it ended, and the name of the safety copy, nothing else.
    const record = readState(r.dir).restores[0];
    expect(record).toMatchObject({
      id: 'restore-test-id',
      kind: 'restored',
      ok: true,
      backup: made.name,
      byUserId: r.family.account.superadmin.id,
      safetyCopy: expect.stringMatching(/^pre-restore-\d{8}-\d{6}\.tar\.enc$/) as string,
    });
    expect(existsSync(join(r.dir, record?.safetyCopy as string))).toBe(true);
    const status = (await r.app.inject({ url: '/api/maintenance' })).json();
    expect(status).toEqual({
      phase: 'finishing',
      since: expect.any(String),
      lastRestore: { ok: true, kind: 'restored', finishedAt: expect.any(String), safetyCopy: record?.safetyCopy },
    });

    // The log has ids only: no email, no path, no secret.
    const log = r.logs.join('\n');
    for (const secret of [
      PASS,
      r.t.test.config.ownerPassword,
      r.t.test.config.appPassword,
      r.dir,
      'superadmin@example.com',
    ])
      expect(log, secret).not.toContain(secret);
    expect(log).toContain('restore requested');
    expect(log).toContain(r.family.account.superadmin.id);
    expect(JSON.stringify(status)).not.toContain(r.dir);
  }, 180_000);

  it('a second click while it runs is 409, and a running backup stops it before anything is paused', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    // A backup running: no gate, no change.
    const ticket = (await check(r, made.name)).body?.['ticket'] as string;
    expect(r.scheduler.startRun()).toBe(true);
    expect(await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD })).toMatchObject({
      status: 409,
      body: { error: 'backup_busy' },
    });
    expect(r.maintenance.active()).toBe(false);
    expect(r.calls.paused).toBe(0);
    await waitFor(() => !r.scheduler.running, 'the backup');
    // Now the real one (the newest archive: the finished backup tidied the older one away), and a second click right after it.
    const newest = (
      (await r.as('superadmin', 'GET', '/api/admin/backups')).body?.['backups'] as Array<{ name: string }>
    )[0]!.name;
    const fresh = (await check(r, newest)).body?.['ticket'] as string;
    const first = await restore(r, { ticket: fresh, word: RESTORE_WORD, password: PASSWORD });
    expect(first.status).toBe(202);
    const spare = await r.service
      .start({ name: newest, userId: r.family.account.superadmin.id })
      .catch((e: unknown) => e);
    expect(spare).toMatchObject({ code: 'busy' });
    await waitFor(() => r.exits.length > 0, 'the restore to end');
    expect(r.exits).toEqual([0]);
  }, 240_000);

  it('a request still running when the drain ends: the gate lifts, nothing changed, no exit, no restart', async () => {
    const r = await rig({ drainMs: 150 });
    const made = await createBackup(r.ctx, { kind: 'manual' });
    const before = await snapshot(r.t.owner);
    const slow = r.app.inject({ method: 'GET', url: '/api/test-slow', headers: CSRF });
    await waitFor(() => r.maintenance.inFlight() === 1, 'the slow request to start');
    const { ticket } = (await check(r, made.name)).body as { ticket: string };
    expect((await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD })).status).toBe(202);
    await waitFor(() => r.maintenance.phase() === 'idle', 'the gate to lift');
    expect(r.exits).toEqual([]);
    expect(r.calls).toEqual({ paused: 1, resumed: 1, poolClosed: 0 });
    expect(await snapshot(r.t.owner)).toEqual(before);
    // The pool is still open, and the site serves again.
    r.release();
    await slow;
    expect((await r.as('superadmin', 'GET', '/api/people')).status).toBe(200);
    expect(readState(r.dir).restores[0]).toMatchObject({ kind: 'unchanged', ok: false, errorKind: 'drain_timeout' });
    expect(readdirSync(r.dir).filter((n) => n.startsWith('pre-restore'))).toEqual([]);
    expect((await r.app.inject({ url: '/api/maintenance' })).json()).toMatchObject({
      phase: 'idle',
      lastRestore: { ok: false, kind: 'unchanged' },
    });
  }, 180_000);

  it('a backup that is refused under the gate lifts it without closing anything', async () => {
    const r = await rig();
    const made = await createBackup(r.ctx, { kind: 'manual' });
    const { ticket } = (await check(r, made.name)).body as { ticket: string };
    // After the check, but before the restore: the archive turns out to be damaged.
    const bytes = readFileSync(join(r.dir, made.name));
    bytes[bytes.length - 50] = (bytes[bytes.length - 50] ?? 0) ^ 1;
    writeFileSync(join(r.dir, made.name), bytes);
    expect((await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD })).status).toBe(202);
    await waitFor(() => r.maintenance.phase() === 'idle', 'the gate to lift');
    expect(r.exits).toEqual([]);
    expect(r.calls.poolClosed).toBe(0);
    expect(readState(r.dir).restores[0]).toMatchObject({ kind: 'unchanged', errorKind: 'corrupt' });
  }, 120_000);

  it('a failure AFTER the pool is closed exits 1, leaves the data as it was, and says so on the status', async () => {
    const dirForTool = mkdtempSync(join(tmpdir(), 'kinship-tool-'));
    cleanups.push(() => rmSync(dirForTool, { recursive: true, force: true }));
    // pg_restore answers --version (the check) and fails when it is asked to read the dump (the replay).
    const real = testTools().pgRestore;
    const failing = join(dirForTool, 'pg_restore');
    writeFileSync(
      failing,
      `#!/bin/sh\nif [ "$1" = "--version" ]; then exec '${real}' --version; fi\necho "broken" >&2\nexit 1\n`,
    );
    chmodSync(failing, 0o755);
    const r = await rig({ tools: { pgRestore: failing } });
    const made = await createBackup(r.ctx, { kind: 'manual' });
    await sql`insert into people (given_name, surname) values ('Added', 'Later')`.execute(r.t.owner);
    const before = await snapshot(r.t.owner);
    const { ticket } = (await check(r, made.name)).body as { ticket: string };
    expect((await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD })).status).toBe(202);
    await waitFor(() => r.exits.length > 0, 'the restore to end');
    expect(r.exits).toEqual([1]);
    expect(r.calls.poolClosed).toBe(1);
    expect(r.calls.resumed).toBe(0);
    expect(await snapshot(r.t.owner)).toEqual(before);
    expect(readState(r.dir).restores[0]).toMatchObject({ kind: 'unchanged', ok: false, errorKind: 'tool' });
    // The safety copy was made before the replay and is kept.
    expect(readdirSync(r.dir).filter((n) => n.startsWith('pre-restore'))).toHaveLength(1);
    expect(r.maintenance.phase()).toBe('finishing');
    expect(r.logs.join('\n')).not.toContain(r.dir);
  }, 180_000);

  it('a newer database change that fails after the restore is reported as restored, not migrated, and exits 1', async () => {
    const migrations = await tempMigrationsDir(true);
    cleanups.push(() => migrations.remove());
    const r = await rig({ migrationsDir: migrations.dir });
    const made = await createBackup(r.ctx, { kind: 'manual' });
    // The image now carries a migration the backup does not have, and it fails.
    await migrations.add('9999_broken.sql', 'SELECT this_is_not_sql;');
    const { ticket } = (await check(r, made.name)).body as { ticket: string };
    expect((await check(r, made.name)).body).toMatchObject({ pendingMigrations: 1 });
    expect((await restore(r, { ticket, word: RESTORE_WORD, password: PASSWORD })).status).toBe(202);
    await waitFor(() => r.exits.length > 0, 'the restore to end');
    expect(r.exits).toEqual([1]);
    const record = readState(r.dir).restores[0];
    expect(record).toMatchObject({ kind: 'restored_not_migrated', ok: false });
    expect(lastRestoreOf(r.dir)).toMatchObject({ ok: false, kind: 'restored_not_migrated' });
  }, 180_000);
});

describe('state.json and the next start', () => {
  it('marks a restore that never ended as not finished, and reads the last result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kinship-reconcile-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(lastRestoreOf(dir)).toBeUndefined();
    await recordRestoreStart(dir, {
      id: 'r1',
      startedAt: '2026-11-22T10:00:00.000Z',
      kind: 'started',
      backup: 'kinship-2026-11-22-0300.tar.enc',
      byUserId: 'u-1',
    });
    // A started restore is not a result yet.
    expect(lastRestoreOf(dir)).toBeUndefined();
    const logs: string[] = [];
    await reconcileRestores(dir, (_level, message) => logs.push(message), new Date('2026-11-22T10:05:00.000Z'));
    expect(readState(dir).restores[0]).toMatchObject({
      kind: 'did_not_finish',
      ok: false,
      finishedAt: '2026-11-22T10:05:00.000Z',
      errorKind: 'interrupted',
    });
    expect(lastRestoreOf(dir)).toEqual({ ok: false, kind: 'did_not_finish', finishedAt: '2026-11-22T10:05:00.000Z' });
    expect(logs).toEqual(['a restore did not finish; the data is unchanged']);
    // Nothing to do the second time.
    await reconcileRestores(dir, (_level, message) => logs.push(message));
    expect(logs).toHaveLength(1);
  });
});
