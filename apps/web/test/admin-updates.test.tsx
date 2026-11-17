// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_BACKUP_SETTINGS } from '@kinship/shared';
import type { BackupsResponse, KnownRelease, OfferedRange, UpdatesResponse, WhatsNewResponse } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALICE, ME, VERSION, calls, mockApi, renderApp, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cleanup();
});

const release = (version: string, change: Partial<KnownRelease> = {}): KnownRelease => ({
  version,
  date: '2026-12-03',
  channel: 'stable',
  security: false,
  breaking: false,
  migration: false,
  notes: `### Fixed\n\n- A fix in ${version}.`,
  upgradeNotes: null,
  details: true,
  ...change,
});
const range = (releases: KnownRelease[], from = '0.5.0'): OfferedRange => ({
  from,
  to: releases[0]?.version ?? from,
  releases,
  security: releases.some((r) => r.security),
  breaking: releases.some((r) => r.breaking),
  migration: releases.some((r) => r.migration),
  unknownDetails: releases.some((r) => !r.details),
});
const updates = (change: Partial<UpdatesResponse> = {}): UpdatesResponse => ({
  running: { version: '0.5.0', commit: 'abc1234', buildDate: '2026-11-15T19:04:05Z', schema: 41, webVersion: '0.5.0' },
  settings: { check: true, preReleases: false, safetyCopy: true },
  check: {
    status: 'ok',
    lastAttemptAt: '2026-11-15T08:12:00.000Z',
    lastSuccessAt: '2026-11-15T08:12:00.000Z',
    nextCheckAt: '2026-11-16T08:12:00.000Z',
    viaProxy: false,
  },
  range: null,
  dismissedVersion: null,
  backupAckVersion: null,
  ...change,
});
const backups = (lastSuccessAt: string | null, change: Record<string, unknown> = {}): BackupsResponse => ({
  status: {
    enabled: true,
    passphrase: 'ok',
    folderWritable: true,
    running: false,
    settings: DEFAULT_BACKUP_SETTINGS,
    nextRunAt: null,
    lastSuccessAt,
    lastRun: null,
    lastTest: null,
    healthy: true,
    problems: [],
    ...change,
  },
  backups: [],
});

const FAMILY_ADMIN = { ...ME, user: { ...ALICE, id: 'u2', role: 'familyadmin' } };
const MEMBER = { ...ME, user: { ...ALICE, id: 'u3', role: 'member' } };

function open(path: string, routes: Record<string, MockRoute> = {}, me: unknown = ME) {
  const fetchMock = mockApi({
    ...signedIn,
    '/api/auth/me': { status: 200, body: me },
    '/api/admin/accounts': { status: 200, body: { accounts: [], inviters: [] } },
    '/api/updates/whats-new': { status: 200, body: whatsNew({ show: false, kind: 'none' }) },
    ...routes,
  });
  renderApp(path);
  return fetchMock;
}

function whatsNew(change: Partial<WhatsNewResponse> = {}): WhatsNewResponse {
  return {
    show: true,
    kind: 'updated',
    from: '0.5.0',
    to: '0.6.0',
    sections: [
      {
        version: '0.6.0',
        date: '2026-12-03',
        groups: [
          { kind: 'new', title: 'Features', body: '- Medical history.\n- A <script>alert(1)</script> report.' },
          { kind: 'fixed', title: 'Bug Fixes', body: '- Dates keep their precision.' },
        ],
      },
    ],
    migrations: [],
    checkNow: [],
    restore: null,
    releaseUrl: 'https://github.com/officialJCReyes/kinship/releases/tag/v0.6.0',
    ...change,
  };
}

describe('Admin > Updates, for the SuperAdmin', () => {
  const results: Array<[string, Partial<UpdatesResponse>, string, string | null]> = [
    [
      'never checked',
      { check: { ...updates().check, status: 'never', lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: null } },
      'Not checked yet',
      null,
    ],
    ['up to date', {}, 'Up to date', null],
    ['an update', { range: range([release('0.6.0')]) }, '0.6.0 available', null],
    [
      'checking off',
      { settings: { check: false, preReleases: false, safetyCopy: true }, range: range([release('0.6.0')]) },
      'Checking is off',
      null,
    ],
    [
      'offline after a good check',
      { check: { ...updates().check, status: 'offline' } },
      'Up to date',
      'Could not reach GitHub. Last successful check: Nov 15, 2026',
    ],
    [
      'offline, never worked',
      { check: { ...updates().check, status: 'offline', lastSuccessAt: null } },
      'Not checked yet',
      'Could not reach GitHub, and no check has worked yet.',
    ],
    [
      'rate limited',
      { check: { ...updates().check, status: 'rate_limited' } },
      'Up to date',
      'GitHub asked KinShip to wait. It will try again later.',
    ],
    [
      'a bad answer',
      { check: { ...updates().check, status: 'bad_response' } },
      'Up to date',
      'GitHub answered with something KinShip could not read. It will try again later.',
    ],
  ];
  for (const [name, change, pill, sentence] of results) {
    it(`says what the result is: ${name}`, async () => {
      open('/admin/updates', { '/api/admin/updates': { status: 200, body: updates(change) } });
      const card = await screen.findByRole('region', { name: 'Version' });
      expect(within(card).getByText(pill)).toBeTruthy();
      if (sentence) expect(within(card).getByRole('status').textContent).toContain(sentence);
      else expect(within(card).queryByRole('status')).toBeNull();
    });
  }

  it('shows the running version for the web and the api, the schema, when it last looked, and that KinShip never updates itself', async () => {
    open('/admin/updates', {
      '/api/admin/updates': { status: 200, body: updates({ check: { ...updates().check, viaProxy: true } }) },
    });
    const card = await screen.findByRole('region', { name: 'Version' });
    expect(within(card).getByText('0.5.0 (web 0.5.0, api 0.5.0)')).toBeTruthy();
    expect(within(card).getByText('41')).toBeTruthy();
    expect(within(card).getByText(/Nov 15, 2026/, { selector: 'dd' })).toBeTruthy();
    expect(within(card).getByText(/KinShip never updates itself/)).toBeTruthy();
    expect(within(card).getByText(/HTTPS_PROXY/)).toBeTruthy();
  });

  it('Check now asks the api, shows the answer, and turns into a clear message when it is too soon', async () => {
    const fetchMock = open('/admin/updates', {
      '/api/admin/updates': { status: 200, body: updates() },
      'POST /api/admin/updates/check': { status: 200, body: updates({ range: range([release('0.6.0')]) }) },
    });
    const card = await screen.findByRole('region', { name: 'Version' });
    fireEvent.click(within(card).getByRole('button', { name: 'Check now' }));
    expect(await within(card).findByText('0.6.0 available')).toBeTruthy();
    expect(calls(fetchMock)).toContain('POST /api/admin/updates/check');
    cleanup();
    vi.unstubAllGlobals();

    open('/admin/updates', {
      '/api/admin/updates': { status: 200, body: updates() },
      'POST /api/admin/updates/check': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 42 } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Checked a moment ago. Try again in 42 seconds.');
  });

  it('with checking off, Check now is disabled and says why', async () => {
    open('/admin/updates', {
      '/api/admin/updates': {
        status: 200,
        body: updates({ settings: { check: false, preReleases: false, safetyCopy: true } }),
      },
    });
    const button = (await screen.findByRole('button', { name: 'Check now' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Turn on “Check for new versions” to check.')).toBeTruthy();
  });

  it('has the three switches, each saved on its own, with the defaults on, off, on', async () => {
    const fetchMock = open('/admin/updates', {
      '/api/admin/updates': { status: 200, body: updates() },
      'PATCH /api/admin/updates/settings': { status: 200, body: { check: true, preReleases: true, safetyCopy: true } },
    });
    const card = await screen.findByRole('region', { name: 'Settings' });
    const box = (name: RegExp) => within(card).getByRole('checkbox', { name }) as HTMLInputElement;
    expect(box(/Check for new versions/).checked).toBe(true);
    expect(box(/Include pre-releases/).checked).toBe(false);
    expect(box(/Safety copy before a database change/).checked).toBe(true);
    expect(within(card).getByText(/sends nothing about your install/)).toBeTruthy();
    fireEvent.click(box(/Include pre-releases/));
    expect(await within(card).findByText('Saved.')).toBeTruthy();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ preReleases: true });
  });

  it('says so when a switch could not be saved', async () => {
    open('/admin/updates', {
      '/api/admin/updates': { status: 200, body: updates() },
      'PATCH /api/admin/updates/settings': { status: 400, body: { error: 'invalid_update_setting', field: 'check' } },
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Safety copy/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('That setting must be on or off.');
  });
});

describe('Admin > Updates, for a Family Admin', () => {
  it('shows the tab with a note, and asks the api for nothing about updates', async () => {
    const fetchMock = open('/admin/updates', {}, FAMILY_ADMIN);
    expect(await screen.findByText(/Only a SuperAdmin manages update checks/)).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(within(tabs).getByRole('link', { name: 'Updates' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Update notice' })).toBeNull();
    expect(calls(fetchMock).filter((c) => c.includes('/api/admin/updates'))).toEqual([]);
  });
});

describe('the update banner', () => {
  const banner = () => screen.findByRole('region', { name: 'Update notice' });

  it('heads every Admin page for the SuperAdmin, with the version, the warning, and the security label', async () => {
    open('/admin/users', {
      '/api/admin/updates': {
        status: 200,
        body: updates({
          range: range([release('0.6.1', { security: true }), release('0.6.0', { migration: true, breaking: true })]),
        }),
      },
    });
    const region = await banner();
    expect(within(region).getByText('KinShip 0.6.1 is available. You are on 0.5.0.')).toBeTruthy();
    expect(within(region).getByText('Security update')).toBeTruthy();
    expect(within(region).getByText('Includes breaking changes and a database change. Back up first.')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();

    open('/admin/backups', {
      '/api/admin/backups': { status: 200, body: backups(null) },
      '/api/admin/updates': { status: 200, body: updates({ range: range([release('0.5.1')]) }) },
    });
    const small = await banner();
    expect(within(small).getByText('KinShip 0.5.1 is available. You are on 0.5.0.')).toBeTruthy();
    expect(within(small).queryByText(/Back up first/)).toBeNull();
    expect(within(small).queryByText('Security update')).toBeNull();
  });

  it('says the right line for a database change alone, breaking alone, and a release it could not read', async () => {
    for (const [r, line] of [
      [release('0.6.0', { migration: true }), 'Includes a database change. Back up first.'],
      [release('0.6.0', { breaking: true }), 'Includes breaking changes. Back up first.'],
      [release('0.6.0', { details: false }), 'Details of this version could not be read. Back up first.'],
    ] as const) {
      open('/admin/users', { '/api/admin/updates': { status: 200, body: updates({ range: range([r]) }) } });
      expect(within(await banner()).getByText(line)).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('Dismiss hides it for that version and a newer version brings it back', async () => {
    let dismissed: string | null = null;
    const fetchMock = open('/admin/users', {
      '/api/admin/updates': () => ({
        status: 200,
        body: updates({ range: range([release('0.6.0')]), dismissedVersion: dismissed }),
      }),
      'POST /api/admin/updates/dismiss': (init) => {
        dismissed = (JSON.parse(String(init.body)) as { version: string }).version;
        return { status: 204 };
      },
    });
    fireEvent.click(within(await banner()).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Update notice' })).toBeNull());
    expect(dismissed).toBe('0.6.0');
    expect(calls(fetchMock)).toContain('POST /api/admin/updates/dismiss');
    cleanup();
    vi.unstubAllGlobals();

    open('/admin/users', {
      '/api/admin/updates': {
        status: 200,
        body: updates({ range: range([release('0.6.1'), release('0.6.0')]), dismissedVersion: '0.6.0' }),
      },
    });
    expect(await banner()).toBeTruthy();
  });

  it('is not shown to a Family Admin, and a failing check never makes an error on the page', async () => {
    const fetchMock = open('/admin/users', {}, FAMILY_ADMIN);
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Update notice' })).toBeNull();
    expect(calls(fetchMock).filter((c) => c.includes('/api/admin/updates'))).toEqual([]);
    cleanup();
    vi.unstubAllGlobals();

    open('/admin/users', { '/api/admin/updates': { status: 500, body: { error: 'internal_error' } } });
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Update notice' })).toBeNull();
  });
});

describe('What’s changing', () => {
  const NOW = new Date('2026-12-10T12:00:00Z');
  const openPopup = async (
    body: UpdatesResponse,
    backupsBody: BackupsResponse,
    extra: Record<string, MockRoute> = {},
  ) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const fetchMock = open('/admin/users', {
      '/api/admin/updates': { status: 200, body },
      '/api/admin/backups': { status: 200, body: backupsBody },
      ...extra,
    });
    fireEvent.click(
      within(await screen.findByRole('region', { name: 'Update notice' })).getByRole('button', {
        name: 'What’s changing',
      }),
    );
    return { fetchMock, dialog: await screen.findByRole('dialog', { name: 'What’s changing' }) };
  };
  const hard = updates({
    range: range(
      [
        release('0.6.1', {
          security: true,
          notes: 'A <script>alert(1)</script> and [a link](https://example.com/x) and [bad](javascript:alert(1)).',
        }),
        release('0.6.0', { migration: true, breaking: true, upgradeNotes: 'Rename BACKUP_KEEP in your .env.' }),
      ],
      '0.5.0',
    ),
  });

  it('shows the range, one block per release newest first, the labels, and the upgrade notes', async () => {
    const { dialog } = await openPopup(hard, backups('2026-12-09T20:00:00Z'));
    expect(within(dialog).getByText(/KinShip 0\.5\.0 to 0\.6\.1 · 2 releases/)).toBeTruthy();
    const blocks = within(dialog)
      .getAllByRole('region')
      .filter((b) => b.getAttribute('aria-label')?.startsWith('KinShip '));
    expect(blocks.map((b) => b.getAttribute('aria-label'))).toEqual(['KinShip 0.6.1', 'KinShip 0.6.0']);
    expect(within(blocks[0] as HTMLElement).getByText('Security update')).toBeTruthy();
    expect(within(blocks[1] as HTMLElement).getByText('Breaking change')).toBeTruthy();
    expect(within(blocks[1] as HTMLElement).getByText('Database change')).toBeTruthy();
    expect(within(blocks[1] as HTMLElement).getByText('Upgrade notes')).toBeTruthy();
    expect(within(blocks[1] as HTMLElement).getByText('Rename BACKUP_KEEP in your .env.')).toBeTruthy();
    expect(within(blocks[0] as HTMLElement).getByText('Dec 3, 2026'.replace('Dec 3, 2026', '2026-12-03'))).toBeTruthy();
  });

  it('renders the notes from the internet as inert text', async () => {
    const { dialog } = await openPopup(hard, backups('2026-12-09T20:00:00Z'));
    expect(dialog.querySelector('script')).toBeNull();
    expect(within(dialog).getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    const links = [...dialog.querySelectorAll('.markdown a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://example.com/x']);
  });

  it('with a database change and an old backup: red age, Back up now as the main button, and the steps hidden until ticked', async () => {
    const { fetchMock, dialog } = await openPopup(hard, backups('2026-12-04T12:00:00Z'), {
      'POST /api/admin/backups': { status: 202, body: { started: true } },
      'POST /api/admin/updates/backup-ack': { status: 204 },
    });
    const box = within(dialog).getByRole('group', { name: 'Back up before you update.' });
    expect(within(box).getByText('This update changes the database structure.')).toBeTruthy();
    expect(within(box).getByText('This update has breaking changes. Read the upgrade notes below.')).toBeTruthy();
    const age = await within(box).findByText('6 days ago');
    expect(age.className).toContain('crit');
    const now = within(box).getByRole('button', { name: 'Back up now' });
    expect(now.className).toContain('primary');
    expect(within(box).getByText(/KinShip will also save a safety copy/)).toBeTruthy();

    expect(within(dialog).queryByText(/docker compose pull/)).toBeNull();
    expect(
      within(dialog).getByText(/The update steps appear once you have a backup from the last 24 hours/),
    ).toBeTruthy();
    fireEvent.click(now);
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/admin/backups'));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I have a backup I can restore' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/admin/updates/backup-ack'));
    const ack = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/backup-ack'));
    expect(JSON.parse(String(ack?.[1]?.body))).toEqual({ version: '0.6.1', ack: true });
  });

  it('shows the steps once this version is ticked, or a backup from the last 24 hours exists', async () => {
    const { dialog } = await openPopup({ ...hard, backupAckVersion: '0.6.1' }, backups('2026-12-04T12:00:00Z'));
    expect(within(dialog).getByText(/docker compose pull && docker compose up -d/)).toBeTruthy();
    expect(within(dialog).getByText(/kinship-web:0\.6\.1/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Back up now' }) as HTMLButtonElement).className).toContain(
      'primary',
    );
    cleanup();
    vi.unstubAllGlobals();
    // A tick for an older version does not count.
    const stale = await openPopup({ ...hard, backupAckVersion: '0.6.0' }, backups('2026-12-04T12:00:00Z'));
    expect(within(stale.dialog).queryByText(/docker compose pull/)).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    const fresh = await openPopup(hard, backups('2026-12-10T07:00:00Z'));
    expect((await within(fresh.dialog).findByText('5 hours ago')).className).toContain('ok');
    expect(within(fresh.dialog).getByText(/docker compose pull/)).toBeTruthy();
    expect(within(fresh.dialog).queryByRole('checkbox', { name: 'I have a backup I can restore' })).toBeNull();
  });

  it('copies the steps', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { dialog } = await openPopup({ ...hard, backupAckVersion: '0.6.1' }, backups(null));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('docker compose pull && docker compose up -d'));
  });

  it('with no database or breaking change there is no warning box, a plain line, and the steps at once', async () => {
    const { dialog } = await openPopup(updates({ range: range([release('0.5.1')]) }), backups(null));
    expect(within(dialog).queryByRole('group', { name: 'Back up before you update.' })).toBeNull();
    expect(within(dialog).getByText(/No database change and no breaking change/)).toBeTruthy();
    expect(within(dialog).getByText(/docker compose pull/)).toBeTruthy();
  });

  it('a release it could not read counts as a warning, and says so', async () => {
    const { dialog } = await openPopup(
      updates({ range: range([release('0.6.0', { details: false, notes: 'GitHub text' })]) }),
      backups(null),
    );
    expect(
      within(dialog).getByText('The details of an update could not be read, so assume it changes the database.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('Details unavailable')).toBeTruthy();
    expect(within(dialog).queryByText(/docker compose pull/)).toBeNull();
  });

  it('says the safety copy is off, and that backups are not set up, instead of offering a button that cannot work', async () => {
    const off = updates({ ...hard, settings: { check: true, preReleases: false, safetyCopy: false } });
    const { dialog } = await openPopup(off, backups(null, { passphrase: 'missing', problems: ['passphrase_missing'] }));
    expect(within(dialog).getByText('The automatic safety copy is turned off.')).toBeTruthy();
    expect(within(dialog).getByText('There is no backup yet.')).toBeTruthy();
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: 'Back up now' }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(within(dialog).getByText('Backups are not set up (see Admin → Backups).')).toBeTruthy();
  });

  it('Remind me later and Close both close it, and so does Escape; the banner stays', async () => {
    for (const how of ['later', 'close', 'escape'] as const) {
      const { dialog } = await openPopup(hard, backups('2026-12-10T07:00:00Z'));
      if (how === 'later') fireEvent.click(within(dialog).getByRole('button', { name: 'Remind me later' }));
      else if (how === 'close')
        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
      else fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('region', { name: 'Update notice' })).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('What’s new', () => {
  it('opens by itself for an admin who has not seen this version, lists what changed, and Got it records it', async () => {
    let seen = false;
    const fetchMock = open(
      '/',
      {
        '/api/updates/whats-new': () => ({
          status: 200,
          body: seen ? whatsNew({ show: false, kind: 'none', sections: [] }) : whatsNew(),
        }),
        'POST /api/updates/whats-new/seen': () => {
          seen = true;
          return { status: 204 };
        },
      },
      FAMILY_ADMIN,
    );
    const dialog = await screen.findByRole('dialog', { name: 'KinShip was updated to 0.6.0' });
    expect(within(dialog).getByText(/From 0\.5\.0\./)).toBeTruthy();
    expect(within(dialog).getByText(/works without internet/)).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'New' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Fixed' })).toBeTruthy();
    expect(within(dialog).getByText('Medical history.')).toBeTruthy();
    expect(dialog.querySelector('script')).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'View full release notes' }).getAttribute('href')).toBe(
      'https://github.com/officialJCReyes/kinship/releases/tag/v0.6.0',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock)).toContain('POST /api/updates/whats-new/seen');
  });

  it('closing it without Got it records nothing', async () => {
    const fetchMock = open('/', { '/api/updates/whats-new': { status: 200, body: whatsNew() } });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock)).not.toContain('POST /api/updates/whats-new/seen');
  });

  it('tells about a database change with the safety copy, or why there is none, and shows the breaking-change box', async () => {
    const migrated = (change: Record<string, unknown>) => ({
      fromSchema: 41,
      toSchema: 50,
      safetyCopy: null,
      safetyNote: null,
      at: '2026-12-03T10:00:00.000Z',
      ...change,
    });
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [
        { safetyCopy: 'pre-upgrade-0041-to-0050.tar.enc' },
        /A safety copy was saved first: pre-upgrade-0041-to-0050\.tar\.enc\./,
      ],
      [{ safetyNote: 'off' }, /The safety copy was turned off\./],
      [{ safetyNote: 'skipped_no_bypassrls' }, /No safety copy was made: the database account cannot read every row/],
      [{ safetyNote: 'break_glass' }, /No safety copy was made: it was skipped on purpose/],
    ];
    for (const [change, text] of cases) {
      open('/', {
        '/api/updates/whats-new': {
          status: 200,
          body: whatsNew({
            migrations: [migrated(change)],
            checkNow: [{ version: '0.6.0', markdown: 'Rename **BACKUP_KEEP** in your .env.' }],
          }),
        },
      });
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('The database was updated (schema 41 to 50).')).toBeTruthy();
      expect(within(dialog).getByText(text)).toBeTruthy();
      const box = within(dialog).getByText('Check this now').closest('.callout') as HTMLElement;
      expect(box.className).toContain('warn');
      expect(within(box).getByText('BACKUP_KEEP').tagName).toBe('STRONG');
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('an account that predates tracking sees "from an earlier version"; a step down is a small notice', async () => {
    open('/', {
      '/api/updates/whats-new': {
        status: 200,
        body: whatsNew({
          from: null,
          migrations: [
            { fromSchema: null, toSchema: 14, safetyCopy: null, safetyNote: null, at: '2026-12-03T10:00:00.000Z' },
          ],
        }),
      },
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Updated from an earlier version\./)).toBeTruthy();
    expect(within(dialog).getByText('The database was updated (to schema 14).')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();

    open('/', {
      '/api/updates/whats-new': {
        status: 200,
        body: whatsNew({ kind: 'down', from: '0.7.0', to: '0.6.0', sections: [] }),
      },
    });
    const down = await screen.findByRole('dialog', { name: 'KinShip went back to an earlier version' });
    expect(within(down).getByText(/KinShip is now version 0\.6\.0; before it was 0\.7\.0/)).toBeTruthy();
    expect(within(down).queryByRole('heading', { name: 'New' })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    open('/', {
      '/api/updates/whats-new': {
        status: 200,
        body: whatsNew({
          kind: 'down',
          sections: [],
          restore: { fromVersion: '0.7.0', toVersion: '0.6.0', at: '2026-12-04T00:00:00.000Z' },
        }),
      },
    });
    expect(await screen.findByText(/An older backup was restored \(KinShip 0\.7\.0 to 0\.6\.0\)\./)).toBeTruthy();
  });

  it('shows nothing when there is nothing new, and a Member or User never asks', async () => {
    open('/', { '/api/updates/whats-new': { status: 200, body: whatsNew({ show: false, kind: 'none' }) } });
    expect(await screen.findByRole('link', { name: /^KinShip/ })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    const fetchMock = open('/', {}, MEMBER);
    await screen.findByRole('link', { name: /^KinShip/ });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls(fetchMock).filter((c) => c.includes('whats-new'))).toEqual([]);
  });

  it('can be opened again from About KinShip by an admin, for the latest update, and is not offered to a Member', async () => {
    const fetchMock = open('/about', {
      '/api/updates/whats-new?latest=1': { status: 200, body: whatsNew() },
      '/api/version': { status: 200, body: { ...VERSION, webVersion: null } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'What’s new' }));
    const dialog = await screen.findByRole('dialog', { name: 'KinShip was updated to 0.6.0' });
    expect(within(dialog).queryByRole('button', { name: 'Got it' })).toBeNull();
    expect(calls(fetchMock)).toContain('GET /api/updates/whats-new?latest=1');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    cleanup();
    vi.unstubAllGlobals();

    open('/about', {}, MEMBER);
    await screen.findByRole('heading', { name: 'About KinShip' });
    expect(screen.queryByRole('button', { name: 'What’s new' })).toBeNull();
  });

  it('About KinShip warns when the web and the api are not the same version', async () => {
    open(
      '/about',
      { '/api/version': { status: 200, body: { ...VERSION, version: '9.9.9', webVersion: null } } },
      MEMBER,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /The web \(.*\) and the api \(9\.9\.9\) are on different versions\./,
    );
  });
});

describe('when the web and the api are on different versions', () => {
  it('replaces the whole app with a page that says so, naming both versions and what to do', async () => {
    open('/people', {
      '/api/auth/me': { status: 503, body: { error: 'version_mismatch', web: '0.5.0', api: '0.6.0' } },
    });
    const page = await screen.findByRole('alert');
    expect(within(page).getByRole('heading', { name: 'KinShip’s web and api are on different versions' })).toBeTruthy();
    expect(
      within(page).getByText(
        'The web container is 0.5.0 and the api is 0.6.0. KinShip stops answering until they match, so nothing is saved by a half-updated install.',
      ),
    ).toBeTruthy();
    expect(within(page).getByText(/set both images to the same version/)).toBeTruthy();
    expect(within(page).getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
