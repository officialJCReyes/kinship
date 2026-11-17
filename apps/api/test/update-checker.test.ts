// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The daily update check against a local stand-in for GitHub: what it sends (and does not), conditional requests, the
// manifests, every way it can fail, and the schedule. Nothing here talks to the internet.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createJobRunner } from '../src/jobs/runner.js';
import { createUpdateChecker, parseReleaseList, backoffMs } from '../src/updates/checker.js';
import type { Transport } from '../src/updates/checker.js';
import { USER_AGENT, getLimited, githubHosts, FetchError } from '../src/updates/http.js';
import { readCheckState } from '../src/updates/state.js';
import { writeUpdateSettings } from '../src/updates/settings.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir } from './helpers/migrations-dir.js';

const golden = JSON.parse(
  readFileSync(new URL('../../../scripts/fixtures/release-manifest.golden.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const manifest = (version: string, extra: Record<string, unknown> = {}) => ({
  ...golden,
  version,
  channel: version.includes('-') ? 'prerelease' : 'stable',
  security: false,
  breaking: false,
  migration: false,
  notes: `Notes of ${version}.`,
  upgradeNotes: null,
  ...extra,
});

interface Seen {
  path: string;
  headers: IncomingMessage['headers'];
}

/** A stand-in for api.github.com and the release downloads. Each test sets what it answers. */
let stub: Server;
let base: string;
let seen: Seen[];
let handler: (req: IncomingMessage, res: ServerResponse) => void;

beforeAll(async () => {
  stub = createServer((req, res) => {
    seen.push({ path: req.url ?? '', headers: req.headers });
    handler(req, res);
  });
  await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => stub.close(resolve));
});
beforeEach(() => {
  seen = [];
  handler = (_req, res) => res.writeHead(500).end();
});

const transport = (extra: Partial<Transport> = {}): Transport => ({
  listUrl: `${base}/releases`,
  manifestUrl: (version) => `${base}/dl/v${version}/release-manifest.json`,
  allowHost: (url) => url.hostname === '127.0.0.1' && url.port === new URL(base).port,
  ...extra,
});

const release = (version: string, extra: Record<string, unknown> = {}) => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: version.includes('-'),
  updated_at: '2026-12-01T09:00:00Z',
  published_at: '2026-12-01T08:00:00Z',
  body: `GitHub text of ${version}`,
  assets: [{ name: 'compose.yml' }, { name: 'release-manifest.json' }],
  ...extra,
});

function serve(
  releases: unknown[],
  manifests: Record<string, unknown | ((res: ServerResponse) => void)>,
  options: { etag?: string } = {},
) {
  handler = (req, res) => {
    if (req.url === '/releases') {
      if (options.etag && req.headers['if-none-match'] === options.etag) return void res.writeHead(304).end();
      res.writeHead(200, { 'content-type': 'application/json', ...(options.etag ? { etag: options.etag } : {}) });
      return void res.end(JSON.stringify(releases));
    }
    const m = /^\/dl\/v(.+)\/release-manifest\.json$/.exec(req.url ?? '');
    const entry = m ? manifests[m[1] as string] : undefined;
    if (typeof entry === 'function') return entry(res);
    if (entry === undefined) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(entry));
  };
}

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
  await ensureAppRole(t.owner, t.config.appUser, t.config.appPassword);
  await runMigrations(t.owner, { dir: realMigrationsDir, appRole: t.config.appUser });
});
afterAll(async () => {
  await t.cleanup();
});
beforeEach(async () => {
  await sql`update update_check set status = 'never', last_attempt_at = null, last_success_at = null, next_check_at = null, failures = 0, etag = null, releases = '[]'::jsonb`.execute(
    t.owner,
  );
  await sql`delete from app_settings where key like 'updates.%'`.execute(t.owner);
});

let clockNow = new Date('2026-12-01T10:00:00Z');
const checker = (options: { version?: string; transport?: Transport; random?: () => number } = {}) =>
  createUpdateChecker({
    db: t.config,
    version: options.version ?? '0.2.0',
    log: () => undefined,
    viaProxy: false,
    transport: options.transport ?? transport(),
    now: () => clockNow,
    random: options.random ?? (() => 0.5),
  });

describe('a check', () => {
  it('reads the list and the manifests of newer releases, and sends nothing about the install', async () => {
    serve(
      [
        release('0.3.0'),
        release('0.2.5', { assets: [] }),
        release('0.2.0'),
        release('0.1.0'),
        release('0.4.0', { draft: true }),
        release('0.3.1-rc.1'),
        { tag_name: 'nightly', assets: [] },
        'not an object',
      ],
      {
        '0.3.0': manifest('0.3.0', { migration: true }),
        '0.3.1-rc.1': manifest('0.3.1-rc.1'),
      },
      { etag: 'W/"abc"' },
    );
    const outcome = await checker().checkNow();
    expect(outcome).toMatchObject({ ran: true, status: 'ok' });
    const state = await readCheckState(t.owner);
    expect(state.status).toBe('ok');
    expect(state.failures).toBe(0);
    expect(state.releases.map((r) => [r.version, r.details, r.migration, r.channel])).toEqual([
      ['0.3.1-rc.1', true, false, 'prerelease'],
      ['0.3.0', true, true, 'stable'],
      ['0.2.5', false, false, 'stable'],
    ]);
    expect(state.releases.find((r) => r.version === '0.2.5')?.notes).toBe('GitHub text of 0.2.5');
    expect(state.etag).toBe('0.2.0|W/"abc"');
    // 24 hours, give or take two.
    const wait = (state.nextCheckAt?.getTime() ?? 0) - clockNow.getTime();
    expect(wait).toBeGreaterThanOrEqual(22 * 3_600_000);
    expect(wait).toBeLessThanOrEqual(26 * 3_600_000);

    // What was sent: a constant user agent, an Accept, GitHub's API version; no token, no cookie, no referrer, no version.
    expect(seen.map((s) => s.path)).toEqual([
      '/releases',
      '/dl/v0.3.1-rc.1/release-manifest.json',
      '/dl/v0.3.0/release-manifest.json',
    ]);
    for (const request of seen) {
      expect(request.headers['user-agent']).toBe(USER_AGENT);
      expect(USER_AGENT).not.toMatch(/\d/);
      for (const name of ['authorization', 'cookie', 'referer', 'origin', 'x-forwarded-for', 'if-none-match']) {
        expect(request.headers[name], name).toBeUndefined();
      }
      const everything = JSON.stringify(request.headers);
      expect(everything).not.toContain(t.config.name);
      expect(everything).not.toContain('0.2.0');
    }
    expect(seen[0]?.headers['accept']).toBe('application/vnd.github+json');
    expect(seen[0]?.headers['x-github-api-version']).toBe('2022-11-28');
  });

  it('asks again with the ETag, takes a 304 as "unchanged", and does not read the manifests again', async () => {
    serve([release('0.3.0')], { '0.3.0': manifest('0.3.0', { security: true }) }, { etag: 'W/"abc"' });
    await checker().checkNow();
    seen = [];
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    const second = await checker().checkNow();
    expect(second).toMatchObject({ ran: true, status: 'unchanged' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.headers['if-none-match']).toBe('W/"abc"');
    const state = await readCheckState(t.owner);
    expect(state.releases.map((r) => [r.version, r.security])).toEqual([['0.3.0', true]]);
    expect(state.lastSuccessAt?.toISOString()).toBe(clockNow.toISOString());
  });

  it('does not use an ETag from a different running version', async () => {
    serve(
      [release('0.3.0'), release('0.2.5')],
      { '0.3.0': manifest('0.3.0'), '0.2.5': manifest('0.2.5') },
      { etag: 'W/"abc"' },
    );
    await checker({ version: '0.2.5' }).checkNow();
    seen = [];
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    // The install went back to 0.2.0 (a restore): the stored list only holds what was newer than 0.2.5.
    await checker({ version: '0.2.0' }).checkNow();
    expect(seen[0]?.headers['if-none-match']).toBeUndefined();
    expect((await readCheckState(t.owner)).releases.map((r) => r.version)).toEqual(['0.3.0', '0.2.5']);
  });

  it('reads a manifest again only when the release changed, or when an earlier read failed', async () => {
    serve([release('0.3.0'), release('0.2.5')], {
      '0.3.0': manifest('0.3.0'),
      '0.2.5': (res: ServerResponse) => void res.writeHead(500).end(),
    });
    await checker().checkNow();
    expect((await readCheckState(t.owner)).releases.map((r) => [r.version, r.details])).toEqual([
      ['0.3.0', true],
      ['0.2.5', false],
    ]);
    seen = [];
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    await checker().checkNow();
    expect(seen.map((s) => s.path)).toEqual(['/releases', '/dl/v0.2.5/release-manifest.json']);
    seen = [];
    serve([release('0.3.0', { updated_at: '2026-12-05T00:00:00Z' }), release('0.2.5')], {
      '0.3.0': manifest('0.3.0', { breaking: true }),
      '0.2.5': manifest('0.2.5'),
    });
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    await checker().checkNow();
    expect((await readCheckState(t.owner)).releases.map((r) => [r.version, r.details, r.breaking])).toEqual([
      ['0.3.0', true, true],
      ['0.2.5', true, false],
    ]);
  });

  it('treats a manifest that is malformed, for another version, or too big as "no details"', async () => {
    const huge = (res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...manifest('0.3.3'), notes: 'x'.repeat(300_000) }));
    };
    serve([release('0.3.1'), release('0.3.2'), release('0.3.3'), release('0.3.4')], {
      '0.3.1': { version: '0.3.1', date: 'yesterday' },
      '0.3.2': manifest('0.3.9'),
      '0.3.3': huge,
      '0.3.4': (res: ServerResponse) => void res.writeHead(200).end('not json at all'),
    });
    await checker().checkNow();
    const state = await readCheckState(t.owner);
    expect(state.status).toBe('ok');
    expect(state.releases.map((r) => [r.version, r.details, r.migration])).toEqual([
      ['0.3.4', false, false],
      ['0.3.3', false, false],
      ['0.3.2', false, false],
      ['0.3.1', false, false],
    ]);
  });

  it('never offers as stable what GitHub marks as a pre-release', async () => {
    serve([release('0.3.0', { prerelease: true })], { '0.3.0': manifest('0.3.0') });
    await checker().checkNow();
    expect((await readCheckState(t.owner)).releases[0]?.channel).toBe('prerelease');
  });

  it('follows a redirect to a GitHub host only, a few times at most', async () => {
    serve([release('0.3.0'), release('0.3.1'), release('0.3.2')], {});
    const original = handler;
    handler = (req, res) => {
      if (req.url === '/dl/v0.3.0/release-manifest.json') return void res.writeHead(302, { location: '/cdn/a' }).end();
      if (req.url === '/cdn/a') return void res.writeHead(200).end(JSON.stringify(manifest('0.3.0')));
      if (req.url === '/dl/v0.3.1/release-manifest.json') {
        return void res.writeHead(302, { location: `http://localhost:${new URL(base).port}/cdn/a` }).end();
      }
      if (req.url === '/dl/v0.3.2/release-manifest.json')
        return void res.writeHead(302, { location: '/dl/v0.3.2/release-manifest.json' }).end();
      original(req, res);
    };
    await checker().checkNow();
    const state = await readCheckState(t.owner);
    expect(state.releases.map((r) => [r.version, r.details])).toEqual([
      ['0.3.2', false],
      ['0.3.1', false],
      ['0.3.0', true],
    ]);
    expect(seen.some((s) => s.headers.host?.startsWith('localhost'))).toBe(false);
  });
});

describe('when it does not work', () => {
  it('offline: keeps what it knew, says so quietly, and waits longer each time', async () => {
    serve([release('0.3.0')], { '0.3.0': manifest('0.3.0') });
    await checker().checkNow();
    const good = await readCheckState(t.owner);
    const dead = createNetServer();
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve));
    const port = (dead.address() as AddressInfo).port;
    await new Promise((resolve) => dead.close(resolve));
    const gone = transport({ listUrl: `http://127.0.0.1:${port}/releases`, allowHost: () => true });
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    const first = await checker({ transport: gone }).checkNow();
    expect(first).toMatchObject({ ran: true, status: 'offline' });
    let state = await readCheckState(t.owner);
    expect(state.status).toBe('offline');
    expect(state.failures).toBe(1);
    expect(state.releases.map((r) => r.version)).toEqual(['0.3.0']);
    expect(state.lastSuccessAt?.toISOString()).toBe(good.lastSuccessAt?.toISOString());
    expect((state.nextCheckAt?.getTime() ?? 0) - clockNow.getTime()).toBe(3_600_000);
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    await checker({ transport: gone }).checkNow();
    state = await readCheckState(t.owner);
    expect(state.failures).toBe(2);
    expect((state.nextCheckAt?.getTime() ?? 0) - clockNow.getTime()).toBe(2 * 3_600_000);
    expect([1, 2, 3, 4, 5, 6, 7].map(backoffMs)).toEqual([1, 2, 4, 8, 16, 24, 24].map((h) => h * 3_600_000));
  });

  it('rate limited: waits at least as long as GitHub says', async () => {
    handler = (_req, res) => {
      res.writeHead(403, {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor(clockNow.getTime() / 1000) + 5 * 3600),
        'retry-after': '18000',
      });
      res.end('{}');
    };
    expect(await checker().checkNow()).toMatchObject({ status: 'rate_limited' });
    const state = await readCheckState(t.owner);
    expect((state.nextCheckAt?.getTime() ?? 0) - clockNow.getTime()).toBe(5 * 3_600_000);
    handler = (_req, res) => void res.writeHead(429).end();
    clockNow = new Date(clockNow.getTime() + 2 * 60_000);
    expect(await checker().checkNow()).toMatchObject({ status: 'rate_limited' });
  });

  it('a plain 403 or 500, bad JSON, the wrong shape, or a huge list is "bad response"', async () => {
    const cases: Array<(res: ServerResponse) => void> = [
      (res) => void res.writeHead(403).end(),
      (res) => void res.writeHead(500).end(),
      (res) => void res.writeHead(200).end('<html>a captive portal</html>'),
      (res) => void res.writeHead(200).end('{"message":"not a list"}'),
      (res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`[${'"x",'.repeat(700_000)}"x"]`);
      },
    ];
    for (const respond of cases) {
      handler = (_req, res) => respond(res);
      clockNow = new Date(clockNow.getTime() + 2 * 60_000);
      expect(await checker().checkNow(), String(respond)).toMatchObject({ status: 'bad_response' });
    }
    expect((await readCheckState(t.owner)).releases).toEqual([]);
  });
});

describe('the switch and Check now', () => {
  it('with checking off nothing is sent at all', async () => {
    serve([release('0.3.0')], {});
    await writeUpdateSettings(t.owner, { check: false }, null);
    const c = checker();
    await expect(c.checkNow()).rejects.toMatchObject({ status: 409, code: 'updates_off' });
    clockNow = new Date('2026-12-01T10:00:00Z');
    const runner = createJobRunner(() => undefined);
    runner.register(c.job);
    await runner.tick(new Date(clockNow.getTime() + 3 * 86_400_000));
    await runner.tick(new Date(clockNow.getTime() + 4 * 86_400_000));
    expect(seen).toEqual([]);
    expect((await readCheckState(t.owner)).status).toBe('never');
  });

  it('is single-flight, waits a minute between two, and at most ten an hour', async () => {
    let release_: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release_ = resolve));
    handler = (_req, res) => void gate.then(() => res.writeHead(200).end('[]'));
    clockNow = new Date('2026-12-01T10:00:00Z');
    const c = checker();
    const slow = c.checkNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(c.checkNow()).rejects.toMatchObject({ status: 409, code: 'update_check_busy' });
    release_();
    await slow;
    await expect(c.checkNow()).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      extra: { retryAfterSeconds: 60 },
    });
    handler = (_req, res) => void res.writeHead(200).end('[]');
    for (let i = 0; i < 9; i++) {
      clockNow = new Date(clockNow.getTime() + 61_000);
      await c.checkNow();
    }
    clockNow = new Date(clockNow.getTime() + 61_000);
    await expect(c.checkNow()).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });
});

describe('the schedule', () => {
  it('first checks a few minutes after the first look, then about a day later, and looks again when a switch changes', async () => {
    serve([release('0.3.0')], { '0.3.0': manifest('0.3.0') });
    const start = new Date('2026-12-01T10:00:00Z');
    clockNow = start;
    const c = checker({ random: () => 0.5 });
    const runner = createJobRunner(() => undefined);
    runner.register(c.job);
    await runner.tick(start);
    expect(seen).toEqual([]);
    // random 0.5 gives 2 + 4 = 6 minutes
    await runner.tick(new Date(start.getTime() + 5 * 60_000));
    expect(seen).toEqual([]);
    clockNow = new Date(start.getTime() + 6 * 60_000);
    await runner.tick(clockNow);
    expect(seen.length).toBeGreaterThan(0);
    seen = [];
    await runner.tick(new Date(clockNow.getTime() + 3 * 3_600_000));
    expect(seen).toEqual([]);
    clockNow = new Date(clockNow.getTime() + 24 * 3_600_000 + 60_000);
    await runner.tick(clockNow);
    expect(seen.length).toBeGreaterThan(0);

    // A restart does not check again: the next time is in the database.
    seen = [];
    const again = checker();
    const runner2 = createJobRunner(() => undefined);
    runner2.register(again.job);
    await runner2.tick(new Date(clockNow.getTime() + 60_000));
    expect(seen).toEqual([]);

    // Off, then on: noticed at the next tick, not in an hour.
    await writeUpdateSettings(t.owner, { check: false }, null);
    const far = new Date(clockNow.getTime() + 3 * 86_400_000);
    await runner2.tick(far);
    expect(seen).toEqual([]);
    await writeUpdateSettings(t.owner, { check: true }, null);
    again.settingsChanged();
    await runner2.tick(new Date(far.getTime() + 60_000));
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe('the job runner', () => {
  it('keeps one failing job from the others, never runs a job twice at once, and refuses a duplicate name', async () => {
    const logs: string[] = [];
    const runner = createJobRunner((_l, message) => logs.push(message));
    let ran = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    runner.register({ name: 'bad', run: () => Promise.reject(new Error('secret detail')) });
    runner.register({
      name: 'slow',
      run: async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 30));
        concurrent--;
        ran++;
      },
    });
    expect(() => runner.register({ name: 'bad', run: () => Promise.resolve() })).toThrow(/already registered/);
    await Promise.all([runner.tick(), runner.tick(), runner.tick()]);
    expect(ran).toBe(1);
    expect(maxConcurrent).toBe(1);
    expect(logs.some((m) => m.includes('"bad" failed'))).toBe(true);
    expect(logs.join(' ')).not.toContain('secret detail');
  });
});

describe('what comes back from GitHub is read field by field', () => {
  it('skips drafts, odd tags and non-objects, and cuts the list at 100', () => {
    const list = parseReleaseList([
      release('1.0.0'),
      release('1.1.0', { draft: true }),
      { tag_name: 'v1.2' },
      null,
      5,
      'x',
      { tag_name: 7 },
      ...Array.from({ length: 200 }, (_, i) => release(`2.0.${i}`)),
    ]);
    expect(list?.[0]?.version).toBe('1.0.0');
    // Only the first 100 entries of the answer are looked at (six of them are not releases).
    expect(list).toHaveLength(94);
    expect(parseReleaseList({})).toBeNull();
    expect(parseReleaseList(null)).toBeNull();
    expect(parseReleaseList([{ tag_name: 'v1.0.0', body: 5, assets: 'no', updated_at: 3, published_at: 'x' }])).toEqual(
      [{ version: '1.0.0', prerelease: false, updatedAt: '', publishedDate: null, body: '', hasManifest: false }],
    );
  });

  it('only talks to GitHub: https, its own hosts, no credentials, no odd port', () => {
    const ok = [
      'https://api.github.com/x',
      'https://github.com/x',
      'https://objects.githubusercontent.com/x',
      'https://release-assets.githubusercontent.com/x',
    ];
    const bad = [
      'http://api.github.com/x',
      'https://evilgithub.com/x',
      'https://github.com.evil.test/x',
      'https://githubusercontent.com/x',
      'https://user:pw@github.com/x',
      'https://github.com:8443/x',
      'https://evil.test/github.com',
      'ftp://github.com/x',
    ];
    for (const url of ok) expect(githubHosts(new URL(url)), url).toBe(true);
    for (const url of bad) expect(githubHosts(new URL(url)), url).toBe(false);
  });

  it('refuses a start URL that is not allowed, and a body over the limit', async () => {
    await expect(getLimited('https://evil.test/x', { maxBytes: 10, timeoutMs: 1000 })).rejects.toBeInstanceOf(
      FetchError,
    );
    handler = (_req, res) => void res.writeHead(200).end('x'.repeat(100));
    await expect(
      getLimited(`${base}/x`, { maxBytes: 10, timeoutMs: 1000, allowHost: transport().allowHost }),
    ).rejects.toMatchObject({ failure: 'too_large' });
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '5000' });
      res.end('x'.repeat(5000));
    };
    await expect(
      getLimited(`${base}/x`, { maxBytes: 10, timeoutMs: 1000, allowHost: transport().allowHost }),
    ).rejects.toMatchObject({ failure: 'too_large' });
    handler = () => undefined; // never answers
    await expect(
      getLimited(`${base}/x`, { maxBytes: 10, timeoutMs: 100, allowHost: transport().allowHost }),
    ).rejects.toMatchObject({ failure: 'timeout' });
  });
});

describe('the proxy', () => {
  it('sends the check through HTTPS_PROXY (a CONNECT to the target), and not when it is unset', async () => {
    const connects: string[] = [];
    const proxy = createNetServer((socket) => {
      socket.once('data', (data) => {
        connects.push(data.toString('utf8').split('\r\n')[0] ?? '');
        socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      });
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as AddressInfo).port;
    const script = `
      import { useProxyFromEnv } from './src/updates/proxy.ts';
      const used = useProxyFromEnv();
      const r = await fetch('https://updates-proxy-test.invalid/x').then(() => 'reached', (e) => 'failed');
      console.log(JSON.stringify({ used, r }));`;
    const run = (env: Record<string, string>) =>
      promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        env: { PATH: process.env['PATH'] ?? '', ...env },
        encoding: 'utf8',
        timeout: 20_000,
      });
    const through = await run({ HTTPS_PROXY: `http://127.0.0.1:${port}` });
    expect(JSON.parse(through.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({ used: true, r: 'failed' });
    expect(connects).toEqual(['CONNECT updates-proxy-test.invalid:443 HTTP/1.1']);
    // NO_PROXY keeps a host off the proxy.
    connects.length = 0;
    await run({ HTTPS_PROXY: `http://127.0.0.1:${port}`, NO_PROXY: 'updates-proxy-test.invalid' });
    expect(connects).toEqual([]);
    const direct = await run({});
    expect(JSON.parse(direct.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({ used: false, r: 'failed' });
    expect(connects).toEqual([]);
    await new Promise((resolve) => proxy.close(resolve));
  });
});
