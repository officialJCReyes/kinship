// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The maintenance page (ADR 0031): it replaces the whole app while the site is paused for a restore, polls the public maintenance
// status, keeps going while the api is restarting, and says how the restore ended.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS, MaintenancePage } from '../src/pages/MaintenancePage.js';
import { enterMaintenance, leaveMaintenance } from '../src/lib/maintenance.js';
import { expectCardHeader, mockApi, renderApp, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  leaveMaintenance();
  cleanup();
});

/** A scripted /api/maintenance: each poll takes the next answer (the last one repeats). */
function script(answers: Array<MockRoute>) {
  let i = 0;
  return mockApi({
    '/api/maintenance': (() => {
      const answer = answers[Math.min(i, answers.length - 1)] as MockRoute;
      i += 1;
      return answer;
    }) as MockRoute,
  });
}
const tick = async (ms = POLL_MS) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const busy = (phase: string) => ({ status: 200, body: { phase, since: '2026-11-22T10:00:00.000Z' } });

describe('the maintenance page', () => {
  it('shows the phase in words, asks every two seconds, and has no navigation', async () => {
    const left = vi.fn();
    const fetchMock = script([busy('safety_copy'), busy('replacing'), busy('migrating')]);
    render(<MaintenancePage onLeave={left} />);
    await tick(0);
    expect(screen.getByRole('heading', { name: 'KinShip is being restored from a backup' })).toBeTruthy();
    // role=status, so a screen reader hears each phase.
    expect(screen.getByRole('status').textContent).toBe('Making a safety copy of what is here now…');
    await tick();
    expect(screen.getByRole('status').textContent).toBe('Replacing everything with the backup…');
    await tick();
    expect(screen.getByRole('status').textContent).toBe('Applying newer database changes and checking the result…');
    expect(fetchMock.mock.calls.length).toBe(3);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    // No site header here: the card's own sailboat mark is the only logo, decorative.
    const marks = document.querySelectorAll('svg.logo');
    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute('aria-hidden')).toBe('true');
    expectCardHeader(screen.getByRole('heading', { name: 'KinShip is being restored from a backup' }));
  });

  it('keeps going through the seconds the api is gone (502, network errors), and then shows the result', async () => {
    const left = vi.fn();
    script([
      busy('finishing'),
      'network-error',
      { status: 502, text: '<html>Bad gateway</html>' },
      { status: 503, body: { error: 'maintenance' } },
      {
        status: 200,
        body: {
          phase: 'idle',
          since: null,
          lastRestore: {
            ok: true,
            kind: 'restored',
            finishedAt: '2026-11-22T10:00:09.000Z',
            safetyCopy: 'pre-restore-20261122-100001.tar.enc',
          },
        },
      },
    ]);
    render(<MaintenancePage onLeave={left} />);
    await tick(0);
    expect(screen.getByRole('status').textContent).toBe('Finished. KinShip is starting again…');
    await tick();
    expect(screen.getByRole('status').textContent).toBe('KinShip is starting again…');
    await tick();
    expect(screen.getByRole('status').textContent).toBe('KinShip is starting again…');
    await tick();
    await tick();
    expect(screen.getByRole('heading', { name: 'Restore finished' })).toBeTruthy();
    expect(screen.getByText(/Everyone was signed out, you too/)).toBeTruthy();
    expect(screen.getByText(/Accounts deleted or disabled since the backup are back and active/)).toBeTruthy();
    expect(screen.getByText(/pre-restore-20261122-100001\.tar\.enc/)).toBeTruthy();
    // It stops asking.
    const before = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await tick(POLL_MS * 3);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
  });

  it('Sign in leaves the page and loads the sign-in page afresh', async () => {
    const left = vi.fn();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    script([
      {
        status: 200,
        body: {
          phase: 'idle',
          since: null,
          lastRestore: { ok: true, kind: 'restored', finishedAt: '2026-11-22T10:00:09.000Z' },
        },
      },
    ]);
    render(<MaintenancePage onLeave={left} />);
    await tick(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(left).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it.each([
    [
      'unchanged',
      'The restore did not go ahead',
      'Nothing was changed: your data is exactly as it was.',
      '/admin/backups',
    ],
    ['did_not_finish', 'The restore did not finish', 'Your data is unchanged.', '/admin/backups'],
    ['restored_not_migrated', 'Restored, but a database change failed', 'KinShip may not start', '/login'],
  ] as const)('says how a restore that ended as %s ended', async (kind, title, text, where) => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    script([
      {
        status: 200,
        body: {
          phase: 'idle',
          since: null,
          lastRestore: {
            ok: false,
            kind,
            finishedAt: '2026-11-22T10:00:09.000Z',
            safetyCopy: 'pre-restore-20261122-100001.tar.enc',
          },
        },
      },
    ]);
    render(<MaintenancePage onLeave={() => undefined} />);
    await tick(0);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: where === '/login' ? 'Sign in' : 'Back to KinShip' }));
    expect(assign).toHaveBeenCalledWith(where);
  });

  it('says only that KinShip is back when nothing is known about how it ended', async () => {
    script([{ status: 200, body: { phase: 'idle', since: null } }]);
    render(<MaintenancePage onLeave={() => undefined} />);
    await tick(0);
    expect(screen.getByRole('heading', { name: 'KinShip is back' })).toBeTruthy();
  });
});

describe('the app while the site is paused', () => {
  it('replaces everything with the maintenance page on the first 503 maintenance', async () => {
    vi.useRealTimers();
    mockApi({
      ...signedIn,
      '/api/auth/me': { status: 503, body: { error: 'maintenance', phase: 'replacing' } },
      '/api/maintenance': busy('replacing'),
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'KinShip is being restored from a backup' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(typeof enterMaintenance).toBe('function');
  });
});
