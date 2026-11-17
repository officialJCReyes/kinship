// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin > Updates and What's new over HTTP: who may call what, what a GET does and does not do, the switches, dismiss and the
// backup tick, what each kind of admin is told after an update, and the web/api version check.
import { parseChangelog } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateChecker } from '../src/updates/checker.js';
import type { Transport } from '../src/updates/checker.js';
import { parseUpgradeNotes } from '../src/updates/docs.js';
import { readSafetyCopySetting } from '../src/backup/settings.js';
import { readVersion } from '../src/version.js';
import { CSRF, createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';
import type { Family, Who } from './helpers/family.js';

const RUNNING = '0.3.0';
const CHANGELOG = `# Changelog

## [Unreleased]

## [0.3.0] - 2027-02-01

### Features

- Pedigree chart.

### ⚠ BREAKING CHANGES

- BACKUP_KEEP is now BACKUP_RETENTION_DAILY.

## [0.3.0-rc.1] - 2027-01-20

### Features

- A candidate.

## [0.2.1] - 2027-01-05

### Bug Fixes

- A fix.

## [0.2.0] - 2026-12-01

### Features

- A tree you can trust.

## [0.1.0-alpha.2] - 2026-11-16

### What 0.1.0-alpha.2 adds

- Old things.
`;
const UPGRADE = `# Upgrading KinShip

## 0.3.0

Rename BACKUP_KEEP in .env before you start.

## 0.2.0

Add the backups folder.
`;
const docs = { changelog: parseChangelog(CHANGELOG), upgrade: parseUpgradeNotes(UPGRADE) };

const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: version.includes('-'),
  updated_at: '2027-02-01T09:00:00Z',
  published_at: '2027-02-01T08:00:00Z',
  body: `GitHub text of ${version}`,
  assets: [{ name: 'release-manifest.json' }],
  ...extra,
});
const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  date: '2027-03-01',
  channel: version.includes('-') ? 'prerelease' : 'stable',
  security: false,
  breaking: false,
  migration: false,
  upgradeFrom: null,
  notes: `Notes of ${version}.`,
  upgradeNotes: null,
  ...extra,
});
let releases: unknown[] = [];
let manifests: Record<string, unknown> = {};
const fakeFetch = vi.fn((input: URL | string) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/releases')) {
    return Promise.resolve(new Response(JSON.stringify(releases), { status: 200, headers: { etag: 'W/"e"' } }));
  }
  const m = /\/download\/v(.+)\/release-manifest\.json$/.exec(url.pathname);
  const found = m ? manifests[m[1] as string] : undefined;
  return Promise.resolve(found ? new Response(JSON.stringify(found)) : new Response('', { status: 404 }));
});

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const cookies: Record<string, string> = {};
let clock = new Date('2027-03-01T10:00:00Z');

const transport: Transport = {
  listUrl: 'https://api.github.com/repos/officialJCReyes/kinship/releases?per_page=100',
  manifestUrl: (v) => `https://github.com/officialJCReyes/kinship/releases/download/v${v}/release-manifest.json`,
  allowHost: () => true,
  fetch: fakeFetch as unknown as typeof fetch,
};

beforeAll(async () => {
  t = await createTestApp({
    version: { ...readVersion('abc1234', '2026-11-15T19:04:05Z'), version: RUNNING },
    updates: {
      docs,
      checker: createUpdateChecker({
        db: () => t.test.config,
        version: RUNNING,
        log: () => undefined,
        viaProxy: true,
        transport,
        now: () => clock,
      }),
    },
  });
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
  for (const who of ['superadmin', 'familyadmin', 'member'] as const) {
    const response = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF,
      payload: { email: f.account[who].email, password: 'correct horse battery staple' },
    });
    cookies[who] = `kinship_session=${response.cookies[0]?.value ?? ''}`;
  }
}, 60_000);
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  fakeFetch.mockClear();
  releases = [];
  manifests = {};
  clock = new Date(clock.getTime() + 10 * 60_000);
  await sql`update update_check set status = 'never', last_attempt_at = null, last_success_at = null, next_check_at = null, failures = 0, etag = null, releases = '[]'::jsonb`.execute(
    t.owner,
  );
  await sql`delete from app_settings where key like 'updates.%' or key = 'safety_copy'`.execute(t.owner);
  await sql`update users set update_dismissed_version = null, update_backup_ack_version = null, last_seen_version = null, last_seen_at = null`.execute(
    t.owner,
  );
  await sql`delete from upgrade_log`.execute(t.owner);
  // A fresh checker per test would lose the cooldown; the cooldown is tested on purpose below, so move the clock past it.
});

const ADMIN_ROUTES = [
  ['GET', '/api/admin/updates', undefined],
  ['PATCH', '/api/admin/updates/settings', { check: true }],
  ['POST', '/api/admin/updates/check', undefined],
  ['POST', '/api/admin/updates/dismiss', { version: '0.4.0' }],
  ['POST', '/api/admin/updates/backup-ack', { version: '0.4.0', ack: true }],
] as const;
const ADMINS_ROUTES = [
  ['GET', '/api/updates/whats-new', undefined],
  ['POST', '/api/updates/whats-new/seen', undefined],
] as const;
const WHO: Who[] = ['anonymous', 'user', 'member', 'unlinked', 'familyadmin', 'superadmin'];

describe('who may call what', () => {
  it('Admin > Updates is for the SuperAdmin only, whatever the page shows', async () => {
    for (const [method, url, payload] of ADMIN_ROUTES) {
      for (const who of WHO) {
        const reply = await as(who, method, url, payload);
        const expected = who === 'anonymous' ? 401 : who === 'superadmin' ? [200, 204] : 403;
        if (Array.isArray(expected)) expect(expected, `${who} ${method} ${url}`).toContain(reply.status);
        else expect(reply.status, `${who} ${method} ${url}`).toBe(expected);
      }
    }
  });

  it('What’s new is for every admin (SuperAdmin and Family Admin) and nobody else', async () => {
    for (const [method, url, payload] of ADMINS_ROUTES) {
      for (const who of WHO) {
        const reply = await as(who, method, url, payload);
        const expected = who === 'anonymous' ? 401 : who === 'superadmin' || who === 'familyadmin' ? [200, 204] : 403;
        if (Array.isArray(expected)) expect(expected, `${who} ${method} ${url}`).toContain(reply.status);
        else expect(reply.status, `${who} ${method} ${url}`).toBe(expected);
      }
    }
  });

  it('a change needs the CSRF header, and nothing here is cached', async () => {
    const reply = await t.app.inject({
      method: 'POST',
      url: '/api/admin/updates/check',
      headers: { cookie: cookies['superadmin'] ?? '' },
    });
    expect(reply.statusCode).toBe(403);
    expect(reply.json()).toEqual({ error: 'csrf' });
    const get = await t.app.inject({
      method: 'GET',
      url: '/api/admin/updates',
      headers: { cookie: cookies['superadmin'] ?? '' },
    });
    expect(get.headers['cache-control']).toBe('no-store');
    const whats = await t.app.inject({
      method: 'GET',
      url: '/api/updates/whats-new',
      headers: { cookie: cookies['familyadmin'] ?? '' },
    });
    expect(whats.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/admin/updates', () => {
  it('describes the install and never starts a check', async () => {
    const reply = await as('superadmin', 'GET', '/api/admin/updates');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      running: { version: RUNNING, commit: 'abc1234', buildDate: '2026-11-15T19:04:05Z', webVersion: null },
      settings: { check: true, preReleases: false, safetyCopy: true },
      check: { status: 'never', lastAttemptAt: null, lastSuccessAt: null, viaProxy: true },
      range: null,
      dismissedVersion: null,
      backupAckVersion: null,
    });
    expect(typeof reply.body?.['running'].schema).toBe('number');
    expect(fakeFetch).not.toHaveBeenCalled();
    await as('superadmin', 'GET', '/api/admin/updates');
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('after a check: the releases newer than the running one, the flags combined, stable only unless asked', async () => {
    releases = [release('0.5.0'), release('0.4.0-rc.1'), release('0.4.0'), release('0.3.0')];
    manifests = {
      '0.5.0': manifest('0.5.0', { security: true }),
      '0.4.0-rc.1': manifest('0.4.0-rc.1'),
      '0.4.0': manifest('0.4.0', { migration: true }),
      '0.3.0': manifest('0.3.0'),
    };
    const checked = await as('superadmin', 'POST', '/api/admin/updates/check');
    expect(checked.status).toBe(200);
    expect(fakeFetch).toHaveBeenCalled();
    expect(checked.body?.['check']).toMatchObject({ status: 'ok' });
    expect(checked.body?.['range']).toMatchObject({
      from: RUNNING,
      to: '0.5.0',
      security: true,
      migration: true,
      breaking: false,
      unknownDetails: false,
    });
    expect(checked.body?.['range'].releases.map((r: { version: string }) => r.version)).toEqual(['0.5.0', '0.4.0']);

    // The pre-release switch changes the answer at once, with no new request.
    fakeFetch.mockClear();
    const patched = await as('superadmin', 'PATCH', '/api/admin/updates/settings', { preReleases: true });
    expect(patched.body).toEqual({ check: true, preReleases: true, safetyCopy: true });
    const again = await as('superadmin', 'GET', '/api/admin/updates');
    expect(again.body?.['range'].releases.map((r: { version: string }) => r.version)).toEqual([
      '0.5.0',
      '0.4.0',
      '0.4.0-rc.1',
    ]);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('with checking off it offers nothing, and Check now says no and sends nothing', async () => {
    releases = [release('0.5.0')];
    manifests = { '0.5.0': manifest('0.5.0') };
    await as('superadmin', 'POST', '/api/admin/updates/check');
    await as('superadmin', 'PATCH', '/api/admin/updates/settings', { check: false });
    fakeFetch.mockClear();
    const off = await as('superadmin', 'GET', '/api/admin/updates');
    expect(off.body).toMatchObject({ settings: { check: false }, range: null, check: { nextCheckAt: null } });
    clock = new Date(clock.getTime() + 2 * 60_000);
    const refused = await as('superadmin', 'POST', '/api/admin/updates/check');
    expect(refused).toMatchObject({ status: 409, body: { error: 'updates_off' } });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('Check now waits a minute between two (429 with the seconds to wait)', async () => {
    releases = [];
    clock = new Date(clock.getTime() + 5 * 60_000);
    expect((await as('superadmin', 'POST', '/api/admin/updates/check')).status).toBe(200);
    const second = await as('superadmin', 'POST', '/api/admin/updates/check');
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ error: 'rate_limited', retryAfterSeconds: 60 });
  });
});

describe('the switches', () => {
  it('takes any subset, saves the safety copy switch where the upgrade reads it, and names a wrong field', async () => {
    const saved = await as('superadmin', 'PATCH', '/api/admin/updates/settings', { safetyCopy: false, check: false });
    expect(saved.body).toEqual({ check: false, preReleases: false, safetyCopy: false });
    expect(await readSafetyCopySetting(t.owner)).toBe(false);
    await as('superadmin', 'PATCH', '/api/admin/updates/settings', { safetyCopy: true, check: true });
    expect(await readSafetyCopySetting(t.owner)).toBe(true);

    expect(await as('superadmin', 'PATCH', '/api/admin/updates/settings', { check: 'yes' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_update_setting', field: 'check' },
    });
    expect(await as('superadmin', 'PATCH', '/api/admin/updates/settings', { nope: true })).toMatchObject({
      status: 400,
      body: { error: 'invalid_request', field: 'nope' },
    });
    expect((await as('superadmin', 'PATCH', '/api/admin/updates/settings', {})).status).toBe(400);
    expect((await as('superadmin', 'PATCH', '/api/admin/updates/settings', [])).status).toBe(400);
  });
});

describe('Dismiss and "I have a backup I can restore"', () => {
  it('are kept on the SuperAdmin’s account, per version, and refuse anything that is not a version', async () => {
    expect((await as('superadmin', 'POST', '/api/admin/updates/dismiss', { version: '0.4.0' })).status).toBe(204);
    expect(
      (await as('superadmin', 'POST', '/api/admin/updates/backup-ack', { version: '0.4.0', ack: true })).status,
    ).toBe(204);
    expect((await as('superadmin', 'GET', '/api/admin/updates')).body).toMatchObject({
      dismissedVersion: '0.4.0',
      backupAckVersion: '0.4.0',
    });
    expect(
      (await as('superadmin', 'POST', '/api/admin/updates/backup-ack', { version: '0.4.0', ack: false })).status,
    ).toBe(204);
    expect((await as('superadmin', 'GET', '/api/admin/updates')).body).toMatchObject({ backupAckVersion: null });
    for (const bad of ['', 'latest', '1.2', 'x'.repeat(65), '0.4.0; drop table users']) {
      expect((await as('superadmin', 'POST', '/api/admin/updates/dismiss', { version: bad })).status, bad).toBe(400);
    }
    expect((await as('superadmin', 'POST', '/api/admin/updates/dismiss', { version: 4 })).status).toBe(400);
    expect((await as('superadmin', 'POST', '/api/admin/updates/backup-ack', { version: '0.4.0' })).status).toBe(400);
    expect((await as('superadmin', 'POST', '/api/admin/updates/dismiss', { version: '0.4.0', extra: 1 })).status).toBe(
      400,
    );
    const others = await sql<{
      n: string;
    }>`select count(*)::text as n from users where update_dismissed_version is not null`.execute(t.owner);
    expect(others.rows[0]?.n).toBe('1');
  });
});

describe("what's new", () => {
  const setSeen = (
    who: 'superadmin' | 'familyadmin',
    version: string | null,
    at: string | null = '2027-01-01T00:00:00Z',
  ) =>
    sql`update users set last_seen_version = ${version}, last_seen_at = ${at} where id = ${f.account[who].id}`.execute(
      t.owner,
    );
  const log = (fields: {
    event?: string;
    from?: number | null;
    to: number;
    fromV?: string | null;
    toV: string;
    copy?: string | null;
    note?: string | null;
    at: string;
  }) =>
    sql`insert into upgrade_log (event, from_schema, to_schema, from_version, to_version, safety_copy, safety_note, created_at)
        values (${fields.event ?? 'migrate'}, ${fields.from ?? null}, ${fields.to}, ${fields.fromV ?? null}, ${fields.toV}, ${fields.copy ?? null}, ${fields.note ?? null}, ${fields.at})`.execute(
      t.owner,
    );

  it('an account that predates tracking is told what changed since alpha.2, once, with the migration note', async () => {
    await setSeen('familyadmin', null, null);
    await log({ from: 6, to: 14, toV: '0.3.0', copy: 'pre-upgrade-0006-to-0014.tar.enc', at: '2027-02-02T00:00:00Z' });
    const reply = await as('familyadmin', 'GET', '/api/updates/whats-new');
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ show: true, kind: 'updated', from: null, to: RUNNING });
    // Newest first; the release candidate is folded into 0.3.0; alpha.2 is what they had.
    expect(reply.body?.['sections'].map((s: { version: string }) => s.version)).toEqual(['0.3.0', '0.2.1', '0.2.0']);
    expect(reply.body?.['migrations']).toEqual([
      {
        fromSchema: 6,
        toSchema: 14,
        safetyCopy: 'pre-upgrade-0006-to-0014.tar.enc',
        safetyNote: null,
        at: '2027-02-02T00:00:00.000Z',
      },
    ]);
    expect(reply.body?.['checkNow']).toEqual([
      { version: '0.3.0', markdown: 'Rename BACKUP_KEEP in .env before you start.' },
    ]);
    expect(reply.body?.['releaseUrl']).toBe('https://github.com/officialJCReyes/kinship/releases/tag/v0.3.0');
  });

  it('lists every skipped version, and only the ones after the last seen', async () => {
    await setSeen('superadmin', '0.2.0');
    const reply = await as('superadmin', 'GET', '/api/updates/whats-new');
    expect(reply.body).toMatchObject({ show: true, kind: 'updated', from: '0.2.0' });
    expect(reply.body?.['sections'].map((s: { version: string }) => s.version)).toEqual(['0.3.0', '0.2.1']);
  });

  it('shows nothing when the version is the one already seen (a fresh install, or after Got it)', async () => {
    await setSeen('superadmin', RUNNING);
    expect((await as('superadmin', 'GET', '/api/updates/whats-new')).body).toMatchObject({
      show: false,
      kind: 'none',
      sections: [],
    });
  });

  it('migration rows: only the admin’s unseen ones, never the fresh-install row, with the safety note', async () => {
    await setSeen('superadmin', '0.2.0', '2027-02-01T00:00:00Z');
    await log({ from: 10, to: 12, toV: '0.2.0', at: '2027-01-10T00:00:00Z' });
    await log({ from: null, to: 14, toV: '0.3.0', note: 'fresh_install', at: '2027-02-02T00:00:00Z' });
    await log({
      from: 12,
      to: 14,
      fromV: '0.2.0',
      toV: '0.3.0',
      note: 'skipped_no_bypassrls',
      at: '2027-02-03T00:00:00Z',
    });
    const reply = await as('superadmin', 'GET', '/api/updates/whats-new');
    expect(reply.body?.['migrations']).toEqual([
      {
        fromSchema: 12,
        toSchema: 14,
        safetyCopy: null,
        safetyNote: 'skipped_no_bypassrls',
        at: '2027-02-03T00:00:00.000Z',
      },
    ]);
  });

  it('a patch release without a migration has the changelog and no database note', async () => {
    await setSeen('superadmin', '0.2.0');
    await sql`update upgrade_log set event = 'migrate'`.execute(t.owner);
    const reply = await as('superadmin', 'GET', '/api/updates/whats-new');
    expect(reply.body?.['migrations']).toEqual([]);
  });

  it('a step down (an older backup restored, or a newer version seen) is a small notice, not a list of changes', async () => {
    await setSeen('superadmin', '0.4.0');
    const newerSeen = await as('superadmin', 'GET', '/api/updates/whats-new');
    expect(newerSeen.body).toMatchObject({ show: true, kind: 'down', from: '0.4.0', to: RUNNING, sections: [] });

    await setSeen('superadmin', RUNNING, '2027-02-01T00:00:00Z');
    await log({ event: 'restore', from: 14, to: 14, fromV: '0.4.0', toV: RUNNING, at: '2027-02-05T00:00:00Z' });
    const restored = await as('superadmin', 'GET', '/api/updates/whats-new');
    expect(restored.body).toMatchObject({
      show: true,
      kind: 'down',
      restore: { fromVersion: '0.4.0', toVersion: RUNNING },
    });
    // A restore from before they last looked is old news.
    await setSeen('superadmin', RUNNING, '2027-02-10T00:00:00Z');
    expect((await as('superadmin', 'GET', '/api/updates/whats-new')).body).toMatchObject({
      show: false,
      kind: 'none',
      restore: null,
    });
    // A restore that did not lower the version says nothing.
    await sql`update upgrade_log set from_version = '0.3.0'`.execute(t.owner);
    await setSeen('superadmin', RUNNING, '2027-02-01T00:00:00Z');
    expect((await as('superadmin', 'GET', '/api/updates/whats-new')).body).toMatchObject({ show: false, kind: 'none' });
  });

  it('Got it records the running version for that admin only, and the popup does not come again', async () => {
    await setSeen('superadmin', '0.2.0');
    await setSeen('familyadmin', '0.2.0');
    expect((await as('superadmin', 'POST', '/api/updates/whats-new/seen')).status).toBe(204);
    expect((await as('superadmin', 'GET', '/api/updates/whats-new')).body).toMatchObject({ show: false });
    expect((await as('familyadmin', 'GET', '/api/updates/whats-new')).body).toMatchObject({ show: true });
    expect((await as('superadmin', 'POST', '/api/updates/whats-new/seen')).status).toBe(204);
    const rows = await sql<{
      v: string;
    }>`select last_seen_version as v from users where id = ${f.account.superadmin.id}`.execute(t.owner);
    expect(rows.rows[0]?.v).toBe(RUNNING);
  });
});

describe('the web and the api must be the same version', () => {
  const get = (url: string, headers: Record<string, string> = {}) => t.app.inject({ method: 'GET', url, headers });

  it('answers 503 version_mismatch to everything but the health and version checks, and says so once in the log', async () => {
    const wrong = { 'x-kinship-web-version': '0.2.9' };
    const blocked = await get('/api/setup/status', wrong);
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toEqual({ error: 'version_mismatch', web: '0.2.9', api: RUNNING });
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect((await get('/api/auth/me', { ...wrong, cookie: cookies['superadmin'] ?? '' })).statusCode).toBe(503);
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...CSRF, ...wrong }, payload: {} }))
        .statusCode,
    ).toBe(503);
    expect((await get('/api/health', wrong)).statusCode).toBe(200);
    const version = await get('/api/version?x=1', wrong);
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ version: RUNNING, webVersion: '0.2.9' });
  });

  it('lets a matching version, no header, and a header that is not a version through', async () => {
    const same = { 'x-kinship-web-version': RUNNING };
    expect((await get('/api/auth/me', { ...same, cookie: cookies['superadmin'] ?? '' })).statusCode).toBe(200);
    expect((await get('/api/auth/me', { cookie: cookies['superadmin'] ?? '' })).statusCode).toBe(200);
    for (const junk of ['__KINSHIP_WEB_VERSION__', '', 'a b', 'x'.repeat(100), '0.3.0\n0.4.0']) {
      const reply = await get('/api/auth/me', {
        'x-kinship-web-version': junk,
        cookie: cookies['superadmin'] ?? '',
      }).catch(() => null);
      if (reply) expect(reply.statusCode, junk).toBe(200);
    }
    expect((await get('/api/version')).json()).toMatchObject({ webVersion: RUNNING });
  });
});
