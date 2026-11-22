// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BackupListItem, BackupsResponse, BackupStatus } from '@kinship/shared';
import { DEFAULT_BACKUP_SETTINGS } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALICE, ME, calls, mockApi, renderApp, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

const download = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/download.js', () => ({ startDownload: download }));

afterEach(() => {
  vi.unstubAllGlobals();
  download.mockReset();
  cleanup();
});

const status = (change: Partial<BackupStatus> = {}): BackupStatus => ({
  enabled: true,
  passphrase: 'ok',
  folderWritable: true,
  running: false,
  settings: { ...DEFAULT_BACKUP_SETTINGS, timeZone: 'Europe/Berlin' },
  nextRunAt: '2026-11-15T02:00:00.000Z',
  lastSuccessAt: '2026-11-14T02:00:05.000Z',
  lastRun: {
    id: 'r1',
    kind: 'scheduled',
    startedAt: '2026-11-14T02:00:00.000Z',
    finishedAt: '2026-11-14T02:00:05.000Z',
    ok: true,
    file: 'kinship-2026-11-14-0200.tar.enc',
    bytes: 33000,
  },
  lastTest: {
    at: '2026-11-14T02:00:30.000Z',
    file: 'kinship-2026-11-14-0200.tar.enc',
    ok: true,
    mode: 'restore',
    tables: 15,
    rows: 120,
  },
  healthy: true,
  problems: [],
  ...change,
});

const items: BackupListItem[] = [
  {
    name: 'kinship-2026-11-14-0200.tar.enc',
    kind: 'manual',
    encrypted: true,
    bytes: 33_000,
    modifiedAt: '2026-11-14T02:00:05.000Z',
    appVersion: '0.2.0',
    schema: 13,
    tested: 'ok',
  },
  {
    name: 'pre-upgrade-0012-to-0013.sql.gz',
    kind: 'pre-upgrade',
    encrypted: false,
    bytes: 5_000_000,
    modifiedAt: '2026-11-10T09:00:00.000Z',
    tested: null,
  },
];

const page = (change: Partial<BackupsResponse> = {}): BackupsResponse => ({
  status: status(),
  backups: items,
  ...change,
});

function open(routes: Record<string, MockRoute> = {}, me: unknown = ME) {
  const fetchMock = mockApi({
    ...signedIn,
    '/api/auth/me': { status: 200, body: me },
    '/api/admin/backups': { status: 200, body: page() },
    ...routes,
  });
  renderApp('/admin/backups');
  return fetchMock;
}

describe('Admin > Backups', () => {
  it('shows how backups are doing, in the family time zone, and what is on the server', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Backups', level: 1 })).toBeTruthy();
    const card = screen.getByRole('region', { name: 'Backups are working' });
    // 02:00:05 UTC is 03:00 in Berlin in November.
    expect(within(card).getByText('Nov 14, 2026, 3:00 AM')).toBeTruthy();
    expect(within(card).getByText('Nov 15, 2026, 3:00 AM')).toBeTruthy();
    expect(
      within(card).getByText(/Last test: passed \(15 tables, 120 rows, kinship-2026-11-14-0200\.tar\.enc\)/),
    ).toBeTruthy();

    const list = screen.getByRole('region', { name: 'Backups on this server' });
    const rows = within(list).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1] as HTMLElement).getByText('kinship-2026-11-14-0200.tar.enc')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Backup')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('32 KB')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Passed')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Before a database change')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('4.8 MB')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('not encrypted')).toBeTruthy();
    // A plain safety copy is not offered for download here.
    expect(within(rows[2] as HTMLElement).queryByRole('button', { name: /Download/ })).toBeNull();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Download kinship-2026-11-14-0200.tar.enc' }),
    ).toBeTruthy();
  });

  it('says what is wrong in words, and does not let you start a backup that cannot work', async () => {
    open({
      '/api/admin/backups': {
        status: 200,
        body: page({
          status: status({
            healthy: false,
            passphrase: 'missing',
            problems: ['passphrase_missing', 'never_backed_up'],
            lastSuccessAt: null,
            nextRunAt: null,
            lastRun: null,
            lastTest: null,
          }),
        }),
      },
    });
    expect(await screen.findByRole('region', { name: 'Backups need attention' })).toBeTruthy();
    expect(screen.getByText(/No backup passphrase is set\. Add BACKUP_PASSPHRASE to \.env/)).toBeTruthy();
    expect(screen.getByText(/There is no backup yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Back up now' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Test the latest backup' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Never')).toBeTruthy();
    expect(screen.getByText('Not scheduled')).toBeTruthy();
  });

  it('shows a failed backup and a failed test', async () => {
    open({
      '/api/admin/backups': {
        status: 200,
        body: page({
          status: status({
            healthy: false,
            problems: ['last_backup_failed', 'last_test_failed'],
            lastRun: {
              id: 'r2',
              kind: 'scheduled',
              startedAt: '2026-11-14T02:00:00.000Z',
              finishedAt: '2026-11-14T02:00:02.000Z',
              ok: false,
              error: 'Not enough free space in /var/lib/kinship/backups',
              errorKind: 'disk_space',
            },
            lastTest: {
              at: '2026-11-13T02:00:30.000Z',
              file: 'kinship-2026-11-13-0200.tar.enc',
              ok: false,
              mode: 'restore',
              tables: 15,
              rows: 120,
              failed: ['Every table has the same rows'],
            },
          }),
        }),
      },
    });
    expect(
      await screen.findByText('The last backup failed: Not enough free space in /var/lib/kinship/backups'),
    ).toBeTruthy();
    expect(
      screen.getByText(/Last test: FAILED for kinship-2026-11-13-0200\.tar\.enc: Every table has the same rows/),
    ).toBeTruthy();
  });

  it('starts a backup (and a test) with one request each, and says it started', async () => {
    const fetchMock = open({
      'POST /api/admin/backups': { status: 202, body: { started: true } },
      'POST /api/admin/backups/test': { status: 202, body: { started: true } },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect(await screen.findByText('Started. This page updates when it is done.')).toBeTruthy();
    expect(calls(fetchMock).filter((c) => c === 'POST /api/admin/backups')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Test the latest backup' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/admin/backups/test'));
  });

  it('shows "Working…" and disables both buttons while one is running', async () => {
    open({ '/api/admin/backups': { status: 200, body: page({ status: status({ running: true }) }) } });
    const button = await screen.findByRole('button', { name: 'Working…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Test the latest backup' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when another backup is already running', async () => {
    open({ 'POST /api/admin/backups': { status: 409, body: { error: 'backup_busy' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A backup or test is already running. Wait for it to finish.',
    );
  });
});

describe('downloading a backup', () => {
  const openDialog = async (routes: Record<string, MockRoute>) => {
    const fetchMock = open(routes);
    fireEvent.click(await screen.findByRole('button', { name: 'Download kinship-2026-11-14-0200.tar.enc' }));
    const dialog = await screen.findByRole('dialog');
    return { fetchMock, dialog };
  };

  it('asks for the password again, then starts the download with the one-time ticket', async () => {
    const { fetchMock, dialog } = await openDialog({
      'POST /api/admin/backups/download-ticket': {
        status: 200,
        body: { ticket: 'T1CKET-abc_123', expiresAt: '2026-11-14T02:00:30.000Z' },
      },
    });
    expect(within(dialog).getByText('kinship-2026-11-14-0200.tar.enc')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Your password'), {
      target: { value: 'correct horse battery staple' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('/api/admin/backups/download?ticket=T1CKET-abc_123'));
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/admin/backups/download-ticket');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: 'kinship-2026-11-14-0200.tar.enc',
      password: 'correct horse battery staple',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dialog open and downloads nothing when the password is wrong', async () => {
    const { dialog } = await openDialog({
      'POST /api/admin/backups/download-ticket': { status: 400, body: { error: 'invalid_current_password' } },
    });
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(await within(dialog).findByText('That password is not right.')).toBeTruthy();
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('says how long to wait when the password has been wrong too often', async () => {
    const { dialog } = await openDialog({
      'POST /api/admin/backups/download-ticket': {
        status: 429,
        body: { error: 'rate_limited', retryAfterSeconds: 120 },
      },
    });
    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'x' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    expect(await within(dialog).findByText(/Too many requests/)).toBeTruthy();
  });
});

describe('the schedule and what to keep', () => {
  it('shows the saved settings, and a weekday only for a weekly schedule', async () => {
    open();
    const form = await screen.findByRole('region', { name: 'Schedule and what to keep' });
    expect((within(form).getByLabelText('Schedule') as HTMLSelectElement).value).toBe('daily');
    expect((within(form).getByLabelText('Time of day') as HTMLInputElement).value).toBe('03:00');
    expect((within(form).getByLabelText('Time zone') as HTMLInputElement).value).toBe('Europe/Berlin');
    expect((within(form).getByLabelText('Daily backups to keep') as HTMLInputElement).value).toBe('7');
    expect((within(form).getByLabelText('Test each backup after it is made') as HTMLInputElement).checked).toBe(true);
    expect(within(form).queryByLabelText('Day of the week')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Schedule'), { target: { value: 'weekly' } });
    expect(within(form).getByLabelText('Day of the week')).toBeTruthy();
  });

  it('saves what was changed, and says so', async () => {
    const saved = {
      ...DEFAULT_BACKUP_SETTINGS,
      schedule: 'weekly',
      weekday: 3,
      keepDaily: 2,
      timeZone: 'Europe/Berlin',
    };
    const fetchMock = open({ 'PATCH /api/admin/backups/settings': { status: 200, body: saved } });
    const form = await screen.findByRole('region', { name: 'Schedule and what to keep' });
    fireEvent.change(within(form).getByLabelText('Schedule'), { target: { value: 'weekly' } });
    fireEvent.change(within(form).getByLabelText('Day of the week'), { target: { value: '3' } });
    fireEvent.change(within(form).getByLabelText('Daily backups to keep'), { target: { value: '2' } });
    fireEvent.click(within(form).getByLabelText('Include uploaded files'));
    fireEvent.click(within(form).getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Settings saved.')).toBeTruthy();
    const patch = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/admin/backups/settings' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      schedule: 'weekly',
      time: '03:00',
      weekday: 3,
      keepDaily: 2,
      keepWeekly: 4,
      keepMonthly: 6,
      includeFiles: false,
      testAfterBackup: true,
      timeZone: 'Europe/Berlin',
    });
  });

  it("shows the server's refusal", async () => {
    open({
      'PATCH /api/admin/backups/settings': {
        status: 400,
        body: { error: 'invalid_backup_setting', field: 'timeZone' },
      },
    });
    const form = await screen.findByRole('region', { name: 'Schedule and what to keep' });
    fireEvent.change(within(form).getByLabelText('Time zone'), { target: { value: 'Mars/Olympus' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save settings' }));
    expect((await screen.findByRole('alert')).textContent).toContain('That backup setting is not allowed');
  });
});

describe('restoring, and the two things to keep outside', () => {
  it('has a Restore button for each encrypted backup, and the command-line steps for a new server', async () => {
    open();
    const card = await screen.findByRole('region', { name: 'Restoring a backup' });
    expect(within(card).getByText('docker compose stop web api')).toBeTruthy();
    expect(
      within(card).getByText('docker compose run --rm api kinship restore kinship-YYYY-MM-DD-HHMM.tar.enc'),
    ).toBeTruthy();
    expect(within(card).getByText('docker compose up -d')).toBeTruthy();
    // One per encrypted archive; the plain safety copy has none.
    const restores = screen.getAllByRole('button', { name: /^Restore / });
    expect(restores.map((b) => b.getAttribute('aria-label'))).toEqual(['Restore kinship-2026-11-14-0200.tar.enc']);
    const keep = screen.getByRole('region', { name: 'Keep the passphrase outside the backup' }).textContent ?? '';
    expect(keep).toContain('backup passphrase');
    expect(keep).not.toContain('FILE_ENCRYPTION_KEY'); // there are no uploaded files in 0.2, so no file key
  });

  it('turns the Restore buttons off without a usable passphrase and while a backup is running, and says why', async () => {
    open({
      '/api/admin/backups': {
        status: 200,
        body: page({ status: status({ passphrase: 'missing', problems: ['passphrase_missing'], healthy: false }) }),
      },
    });
    const button = (await screen.findByRole('button', {
      name: 'Restore kinship-2026-11-14-0200.tar.enc',
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Restoring needs a usable backup passphrase on this server/)).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    open({ '/api/admin/backups': { status: 200, body: page({ status: status({ running: true }) }) } });
    const busy = (await screen.findByRole('button', {
      name: 'Restore kinship-2026-11-14-0200.tar.enc',
    })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(screen.getByText(/A backup or test is running/)).toBeTruthy();
  });
});

const check = (change: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    ticket: 'ticket-1',
    expiresAt: '2026-11-22T10:01:00.000Z',
    name: 'kinship-2026-11-14-0200.tar.enc',
    createdAt: '2026-11-14T02:00:00.000Z',
    appVersion: '0.2.1',
    schema: 18,
    pendingMigrations: 2,
    newerApp: false,
    accounts: 5,
    ownAccountMissing: false,
    ...change,
  },
});

describe('the Restore dialog', () => {
  const openDialog = async (routes: Record<string, MockRoute> = {}) => {
    const fetchMock = open({ 'POST /api/admin/backups/restore-check': check(), ...routes });
    const opener = await screen.findByRole('button', { name: 'Restore kinship-2026-11-14-0200.tar.enc' });
    opener.focus(); // a click focuses the button in a browser; the dialog gives the focus back to it
    fireEvent.click(opener);
    return fetchMock;
  };
  const dialog = () => screen.getByRole('dialog');

  it('checks the backup first, says what it will do, and changes nothing until the password and the word are typed', async () => {
    const fetchMock = await openDialog();
    expect(within(dialog()).getByText('Checking the backup: decrypting it and checking every block…')).toBeTruthy();
    await within(dialog()).findByText(/Made Nov 14, 2026, 3:00 AM by KinShip 0\.2\.1 \(database schema 18\)\./);
    expect(calls(fetchMock)).toContain('POST /api/admin/backups/restore-check');
    expect(calls(fetchMock)).not.toContain('POST /api/admin/backups/restore');
    const d = within(dialog());
    expect(d.getByRole('heading', { name: 'Restore Nov 14, 2026, 3:00 AM' })).toBeTruthy();
    expect(d.getByText(/Anything added since Nov 14, 2026, 3:00 AM is lost\./)).toBeTruthy();
    expect(
      d.getByText('Newer database changes that will be applied after the restore: 2.', { exact: false }),
    ).toBeTruthy();
    expect(
      d
        .getAllByRole('listitem')
        .slice(0, 4)
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining('safety copy'),
      expect.stringContaining('maintenance mode'),
      expect.stringContaining('replaced in one step'),
      expect.stringContaining('starts again'),
    ]);
    // Accounts come back as they were, said plainly.
    expect(d.getByText(/deleted or disabled since then comes back active, with the password it had then/)).toBeTruthy();
    expect(d.queryByText(/not in it/)).toBeNull();
    // Not yet: nothing typed, a wrong word, then right.
    const go = d.getByRole('button', { name: 'Restore now' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(d.getByLabelText('Your password'), { target: { value: 'a password' } });
    fireEvent.change(d.getByLabelText('Type RESTORE to confirm'), { target: { value: 'restore' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(d.getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } });
    expect(go.disabled).toBe(false);
  });

  it('warns when your own account is not in the backup, when the backup is from a newer KinShip, and when it has no accounts', async () => {
    await openDialog({
      'POST /api/admin/backups/restore-check': check({ ownAccountMissing: true, newerApp: true, accounts: 0 }),
    });
    const d = within(dialog());
    await d.findByText(/Your own account was created after this backup was made/);
    expect(d.getByText(/made by a newer KinShip \(0\.2\.1\)/)).toBeTruthy();
    expect(d.getByText(/This backup has no accounts\. KinShip will go back to first-run setup/)).toBeTruthy();
  });

  it('sends the ticket, the word and the password, and then shows the maintenance page', async () => {
    const fetchMock = await openDialog({
      'POST /api/admin/backups/restore': { status: 202, body: { started: true } },
      '/api/maintenance': { status: 200, body: { phase: 'replacing', since: '2026-11-22T10:00:00.000Z' } },
    });
    const d = within(dialog());
    await d.findByLabelText('Your password');
    fireEvent.change(d.getByLabelText('Your password'), { target: { value: 'a password' } });
    fireEvent.change(d.getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } });
    fireEvent.click(d.getByRole('button', { name: 'Restore now' }));
    expect(await screen.findByRole('heading', { name: 'KinShip is being restored from a backup' })).toBeTruthy();
    const call = fetchMock.mock.calls.find(([input]) => String(input) === '/api/admin/backups/restore');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      ticket: 'ticket-1',
      word: 'RESTORE',
      password: 'a password',
    });
    // The ticket goes in the body, never in a URL.
    expect(calls(fetchMock).join('\n')).not.toContain('ticket-1');
    expect(await screen.findByText('Replacing everything with the backup…')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('says so when the password is wrong, and keeps the dialog', async () => {
    await openDialog({
      'POST /api/admin/backups/restore': { status: 400, body: { error: 'invalid_current_password' } },
    });
    const d = within(dialog());
    await d.findByLabelText('Your password');
    fireEvent.change(d.getByLabelText('Your password'), { target: { value: 'nope' } });
    fireEvent.change(d.getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } });
    fireEvent.click(d.getByRole('button', { name: 'Restore now' }));
    expect(await d.findByText('That password is not right.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'KinShip is being restored from a backup' })).toBeNull();
  });

  it('an expired ticket sends you back to the check', async () => {
    await openDialog({
      'POST /api/admin/backups/restore': { status: 400, body: { error: 'restore_ticket_invalid' } },
    });
    const d = within(dialog());
    await d.findByLabelText('Your password');
    fireEvent.change(d.getByLabelText('Your password'), { target: { value: 'a password' } });
    fireEvent.change(d.getByLabelText('Type RESTORE to confirm'), { target: { value: 'RESTORE' } });
    fireEvent.click(d.getByRole('button', { name: 'Restore now' }));
    expect(await d.findByText(/The check of this backup has expired/)).toBeTruthy();
    expect(d.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('says why a backup cannot be restored, from a code or from a sentence that holds no path', async () => {
    await openDialog({
      'POST /api/admin/backups/restore-check': {
        status: 400,
        body: { error: 'restore_failed', errorKind: 'wrong_passphrase' },
      },
    });
    expect(await within(dialog()).findByText(/does not open this backup/)).toBeTruthy();
    expect(within(dialog()).queryByLabelText('Your password')).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    await openDialog({
      'POST /api/admin/backups/restore-check': {
        status: 400,
        body: { error: 'restore_failed', errorKind: 'refused', detail: 'This backup carries uploaded files.' },
      },
    });
    expect(await within(dialog()).findByText('This backup carries uploaded files.')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    await openDialog({
      'POST /api/admin/backups/restore-check': { status: 409, body: { error: 'backup_busy' } },
    });
    expect(await within(dialog()).findByText(/already running/)).toBeTruthy();
  });

  it('closes with Escape and gives the focus back to the button that opened it', async () => {
    await openDialog();
    await within(dialog()).findByLabelText('Your password');
    const opener = screen.getByRole('button', { name: 'Restore kinship-2026-11-14-0200.tar.enc' });
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('who sees it', () => {
  const familyAdmin = { ...ME, user: { ...ALICE, role: 'familyadmin' } };

  it('the SuperAdmin has the Backups tab', async () => {
    mockApi({ ...signedIn, '/api/admin/accounts': { status: 200, body: { accounts: [] } } });
    renderApp('/admin/users');
    expect(await screen.findByRole('link', { name: 'Backups' })).toBeTruthy();
  });

  it('a Family Admin has no Backups tab, and the address is the not-found page', async () => {
    const fetchMock = mockApi({
      ...signedIn,
      '/api/auth/me': { status: 200, body: familyAdmin },
      '/api/admin/accounts': { status: 200, body: { accounts: [] } },
      '/api/admin/backups': { status: 403, body: { error: 'forbidden' } },
    });
    renderApp('/admin/users');
    await screen.findByRole('navigation', { name: 'Admin sections' });
    expect(screen.queryByRole('link', { name: 'Backups' })).toBeNull();
    cleanup();
    renderApp('/admin/backups');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(calls(fetchMock).filter((c) => c === 'GET /api/admin/backups')).toHaveLength(0);
  });

  it('a Member gets the not-found page too', async () => {
    mockApi({ ...signedIn, '/api/auth/me': { status: 200, body: { ...ME, user: { ...ALICE, role: 'member' } } } });
    renderApp('/admin/backups');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
  });
});

describe('Admin > Backups > Photos and files', () => {
  const files = (state: string, keyId: string | null = '0123456789abcdef') => ({
    '/api/admin/files': { status: 200, body: { state, keyId } },
  });

  it('says photos are on and shows the key id, with the warning about losing the key', async () => {
    open(files('ready'));
    const card = await screen.findByRole('region', { name: 'Photos and files' });
    expect(within(card).getByText(/Photos are on/)).toBeTruthy();
    expect(within(card).getByText('0123456789abcdef')).toBeTruthy();
    expect(within(card).getByText(/can never be opened again/)).toBeTruthy();
  });

  it.each([
    ['key_missing', null, /no file encryption key is set\. Add FILE_ENCRYPTION_KEY/],
    ['files_unavailable', '0123456789abcdef', /files folder cannot be used/],
    ['key_mismatch', '0123456789abcdef', /does not match your files/],
  ])('says why photos are not available: %s', async (state, keyId, text) => {
    open(files(state, keyId));
    const card = await screen.findByRole('region', { name: 'Photos and files' });
    expect(within(card).getByRole('alert').textContent).toMatch(text);
  });

  it('is left out when the status cannot be read, and the rest of the page works', async () => {
    open();
    await screen.findByRole('heading', { name: 'Backups', level: 1 });
    expect(screen.queryByRole('region', { name: 'Photos and files' })).toBeNull();
  });
});
