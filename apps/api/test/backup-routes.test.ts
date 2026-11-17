// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKUP_ROUTES, BACKUP_TICKET_SECONDS } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createScheduler } from '../src/backup/scheduler.js';
import type { Scheduler } from '../src/backup/scheduler.js';
import { CSRF, PASSWORD, createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { Family, Who } from './helpers/family.js';
import { testConfig, testTools } from './helpers/pg-tools.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';

const PASS = 'a long backup passphrase for tests';
const CHEAP = { N: 2 ** 4, r: 8, p: 1 };

let t: TestApp;
let dir: string;
let family: Family;
let scheduler: Scheduler;
let as: Awaited<ReturnType<typeof signInAll>>;
const holder: { scheduler?: Scheduler } = {};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kinship-routes-'));
  const lazy = new Proxy({} as Scheduler, {
    get: (_target, prop) => (holder.scheduler as unknown as Record<string | symbol, unknown>)[prop],
  });
  t = await createTestApp({ backups: { scheduler: lazy, dir } });
  family = await buildFamily(t.owner);
  scheduler = createScheduler({
    config: { ...testConfig(t.test, dir, PASS), migrationsDir: realMigrationsDir },
    tools: testTools(),
    log: () => undefined,
    appVersion: '0.2.0-test',
    kdf: CHEAP,
  });
  holder.scheduler = scheduler;
  as = await signInAll(t.app, family);
}, 90_000);

afterAll(async () => {
  await t.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Waits until nothing is running (a manual backup or a test is a background job). */
async function idle(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (!scheduler.running) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('a backup job never finished');
}

describe('who may use the backup routes', () => {
  const roles: Who[] = ['anonymous', ...ACCOUNTS];
  const call = (who: Who, method: 'GET' | 'POST' | 'PATCH', path: string) =>
    as(
      who,
      method,
      path === '/api/admin/backups/download' ? `${path}?ticket=nothing` : path,
      method === 'GET' ? undefined : method === 'PATCH' ? { schedule: 'off' } : { name: 'x', password: 'y' },
    );

  it.each(BACKUP_ROUTES.map((r) => [r.method, r.path] as const))(
    '%s %s: 401 for nobody, 403 for everyone but the SuperAdmin',
    async (method, path) => {
      for (const who of roles) {
        if (who === 'superadmin') continue;
        const response = await call(who, method, path);
        expect(response.status, `${who} ${method} ${path}`).toBe(who === 'anonymous' ? 401 : 403);
      }
    },
  );

  it('the SuperAdmin is let in (and a bad request is a 4xx from the route itself, not a refusal)', async () => {
    expect((await as('superadmin', 'GET', '/api/admin/backups')).status).toBe(200);
    expect((await as('superadmin', 'GET', '/api/admin/backups/settings')).status).toBe(200);
    expect((await as('superadmin', 'GET', '/api/admin/backups/download?ticket=x')).status).toBe(404);
  });

  it('needs the CSRF header on the state-changing routes', async () => {
    const cookie = (
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: CSRF,
        payload: { email: family.account.superadmin.email, password: PASSWORD },
      })
    ).headers['set-cookie'];
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/admin/backups',
      headers: { cookie: String(cookie).split(';')[0] ?? '' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'csrf' });
  });

  it('answers 503 backup_unavailable when this api has no backup service', async () => {
    const bare = await createTestApp();
    try {
      const f = await buildFamily(bare.owner);
      const asBare = await signInAll(bare.app, f);
      expect(await asBare('superadmin', 'GET', '/api/admin/backups')).toMatchObject({
        status: 503,
        body: { error: 'backup_unavailable' },
      });
    } finally {
      await bare.close();
    }
  }, 60_000);
});

describe('listing, starting and testing', () => {
  it('starts a backup (202), refuses a second while it runs, and then lists it', async () => {
    const first = await as('superadmin', 'POST', '/api/admin/backups');
    expect(first).toMatchObject({ status: 202, body: { started: true } });
    expect(await as('superadmin', 'POST', '/api/admin/backups')).toMatchObject({
      status: 409,
      body: { error: 'backup_busy' },
    });
    expect(await as('superadmin', 'POST', '/api/admin/backups/test')).toMatchObject({
      status: 409,
      body: { error: 'backup_busy' },
    });
    await idle();
    const list = await as('superadmin', 'GET', '/api/admin/backups');
    expect(list.status).toBe(200);
    expect(list.body?.['backups']).toHaveLength(1);
    expect(list.body?.['backups'][0]).toMatchObject({
      kind: 'manual',
      encrypted: true,
      appVersion: '0.2.0-test',
      tested: 'ok',
    });
    expect(list.body?.['status']).toMatchObject({
      enabled: true,
      passphrase: 'ok',
      folderWritable: true,
      running: false,
      healthy: true,
      problems: [],
    });
    expect(list.body?.['status'].lastRun).toMatchObject({ kind: 'manual', ok: true });
    expect(list.body?.['status'].lastTest).toMatchObject({ ok: true, mode: 'restore' });
  }, 120_000);

  it('tests the newest backup on request', async () => {
    expect(await as('superadmin', 'POST', '/api/admin/backups/test')).toMatchObject({ status: 202 });
    await idle();
    const list = await as('superadmin', 'GET', '/api/admin/backups');
    expect(list.body?.['status'].lastTest).toMatchObject({ ok: true, rows: expect.any(Number) as number });
  }, 120_000);

  it('lists plain safety copies too, marked as not encrypted', async () => {
    writeFileSync(join(dir, 'pre-upgrade-0012-to-0013.sql.gz'), 'x');
    const list = await as('superadmin', 'GET', '/api/admin/backups');
    const plain = (list.body?.['backups'] as Array<Record<string, unknown>>).find(
      (b) => b['name'] === 'pre-upgrade-0012-to-0013.sql.gz',
    );
    expect(plain).toMatchObject({ kind: 'pre-upgrade', encrypted: false, tested: null });
  });

  it('never puts the passphrase or a database password in a response, and never caches one', async () => {
    const responses = await Promise.all([
      t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: CSRF,
        payload: { email: family.account.superadmin.email, password: PASSWORD },
      }),
    ]);
    const cookie = String(responses[0]?.headers['set-cookie']).split(';')[0] ?? '';
    for (const url of ['/api/admin/backups', '/api/admin/backups/settings']) {
      const r = await t.app.inject({ method: 'GET', url, headers: { ...CSRF, cookie } });
      expect(r.headers['cache-control']).toBe('no-store');
      for (const secret of [PASS, t.test.config.ownerPassword, t.test.config.appPassword])
        expect(r.body).not.toContain(secret);
    }
  });
});

describe('the settings', () => {
  it('start as the defaults and change when the SuperAdmin says so', async () => {
    expect((await as('superadmin', 'GET', '/api/admin/backups/settings')).body).toEqual({
      schedule: 'daily',
      time: '03:00',
      weekday: 0,
      keepDaily: 7,
      keepWeekly: 4,
      keepMonthly: 6,
      includeFiles: true,
      testAfterBackup: true,
      timeZone: 'UTC',
    });
    const saved = await as('superadmin', 'PATCH', '/api/admin/backups/settings', {
      schedule: 'weekly',
      weekday: 3,
      time: '04:15',
      keepDaily: 3,
      timeZone: 'Europe/Berlin',
      testAfterBackup: false,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      schedule: 'weekly',
      weekday: 3,
      time: '04:15',
      keepDaily: 3,
      timeZone: 'Europe/Berlin',
      testAfterBackup: false,
      keepWeekly: 4,
    });
    const rows = await sql<{
      key: string;
      value: unknown;
      updated_by: string;
    }>`select key, value, updated_by from app_settings order by key`.execute(t.owner);
    expect(rows.rows.find((r) => r.key === 'backup.schedule')).toMatchObject({
      value: 'weekly',
      updated_by: family.account.superadmin.id,
    });
    // The scheduler (which reads as the owner) sees it, and the page's status follows.
    const status = await scheduler.status();
    expect(status.settings).toMatchObject({ schedule: 'weekly', timeZone: 'Europe/Berlin', keepDaily: 3 });
    expect(status.nextRunAt).not.toBeNull();
  });

  it('names the field that is wrong, and changes nothing when anything is', async () => {
    const before = (await as('superadmin', 'GET', '/api/admin/backups/settings')).body;
    for (const [body, field] of [
      [{ schedule: 'hourly' }, 'schedule'],
      [{ time: '25:00' }, 'time'],
      [{ keepDaily: 0, schedule: 'daily' }, 'keepDaily'],
      [{ timeZone: 'Mars/Olympus' }, 'timeZone'],
      [{ passphrase: 'x' }, 'passphrase'],
    ] as const) {
      const response = await as('superadmin', 'PATCH', '/api/admin/backups/settings', body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ field });
    }
    expect((await as('superadmin', 'PATCH', '/api/admin/backups/settings', {})).status).toBe(400);
    expect((await as('superadmin', 'GET', '/api/admin/backups/settings')).body).toEqual(before);
  });
});

describe('downloading', () => {
  const signIn = async (): Promise<string> => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload: { email: family.account.superadmin.email, password: PASSWORD },
    });
    return String(res.headers['set-cookie']).split(';')[0] ?? '';
  };
  const send = (cookie: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t.app.inject({
      method,
      url,
      headers: { ...CSRF, cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const archiveName = async (cookie: string) =>
    (
      (await send(cookie, 'GET', '/api/admin/backups')).json() as {
        backups: Array<{ name: string; encrypted: boolean }>;
      }
    ).backups.find((b) => b.encrypted)?.name as string;
  const ticketFor = async (cookie: string, name: string, password = PASSWORD) =>
    send(cookie, 'POST', '/api/admin/backups/download-ticket', { name, password });

  it('hands over exactly the archive, with a one-time ticket, and never caches it', async () => {
    const cookie = await signIn();
    const name = await archiveName(cookie);
    const issued = await ticketFor(cookie, name);
    expect(issued.statusCode).toBe(200);
    const { ticket, expiresAt } = issued.json() as { ticket: string; expiresAt: string };
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(BACKUP_TICKET_SECONDS * 1000);
    expect(issued.headers['cache-control']).toBe('no-store');

    const download = await send(cookie, 'GET', `/api/admin/backups/download?ticket=${ticket}`);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.equals(readFileSync(join(dir, name)))).toBe(true);
    expect(download.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${name}"`,
      'x-content-type-options': 'nosniff',
    });
    expect(download.rawPayload.subarray(0, 4).toString()).toBe('KSBK');

    // Spent: the same ticket never works twice.
    expect((await send(cookie, 'GET', `/api/admin/backups/download?ticket=${ticket}`)).statusCode).toBe(404);
  }, 60_000);

  it('is tied to the session that asked: another session of the same account cannot use it, and it is spent for everyone', async () => {
    const mine = await signIn();
    const other = await signIn();
    const name = await archiveName(mine);
    const { ticket } = (await ticketFor(mine, name)).json() as { ticket: string };
    expect((await send(other, 'GET', `/api/admin/backups/download?ticket=${ticket}`)).statusCode).toBe(404);
    expect((await send(mine, 'GET', `/api/admin/backups/download?ticket=${ticket}`)).statusCode).toBe(404);
  }, 60_000);

  it('expires after 30 seconds', async () => {
    const cookie = await signIn();
    const name = await archiveName(cookie);
    const { ticket } = (await ticketFor(cookie, name)).json() as { ticket: string };
    const real = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => real() + (BACKUP_TICKET_SECONDS + 1) * 1000);
    try {
      expect((await send(cookie, 'GET', `/api/admin/backups/download?ticket=${ticket}`)).statusCode).toBe(404);
    } finally {
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('only ever hands out one of our encrypted archives, found by listing the folder', async () => {
    const cookie = await signIn();
    symlinkSync('/etc/hosts', join(dir, 'kinship-2026-02-02-0000.tar.enc'));
    writeFileSync(join(dir, 'notes.txt'), 'private');
    for (const bad of [
      '../etc/passwd',
      '/etc/passwd',
      '..%2Fetc%2Fpasswd',
      'kinship-2026-11-14-0300.tar.enc/../../notes.txt',
      'notes.txt',
      'state.json',
      'pre-upgrade-0012-to-0013.sql.gz', // a plain safety copy is listed but not offered
      'kinship-2026-02-02-0000.tar.enc', // a link
      'kinship-1999-01-01-0000.tar.enc', // not there
      'x'.repeat(120),
    ]) {
      const response = await ticketFor(cookie, bad);
      expect(response.statusCode, bad).toBe(404);
      expect(response.json()).toEqual({ error: 'backup_not_found' });
    }
    expect(
      (await send(cookie, 'POST', '/api/admin/backups/download-ticket', { name: 'x'.repeat(200), password: PASSWORD }))
        .statusCode,
    ).toBe(400);
  }, 60_000);

  it('a wrong password is refused, counted, and after ten of them even the right one waits', async () => {
    const cookie = await signIn();
    const name = await archiveName(cookie);
    for (let i = 0; i < 10; i++) {
      expect((await ticketFor(cookie, name, `wrong password number ${i}`)).statusCode).toBe(400);
    }
    const locked = await ticketFor(cookie, name);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  }, 120_000);
});
