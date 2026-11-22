// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "Check for new versions" switch on the Review step: on by default, applied only after the account exists.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calls } from './helpers.js';
import { create, toReview } from './setup-helpers.js';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const box = () => screen.getByRole('checkbox', { name: 'Check for new versions' }) as HTMLInputElement;
const SETTINGS = 'PATCH /api/admin/updates/settings';
const found = (fetchMock: Parameters<typeof calls>[0], key: string) => calls(fetchMock).filter((c) => c === key);

describe('Review: Check for new versions', () => {
  it('is a switch that starts on, with its explanation behind an info button and no paragraph', async () => {
    await toReview();
    expect(box().checked).toBe(true);
    expect(document.body.textContent).not.toMatch(/Update notices/);
    const tip = screen.getByRole('button', { name: 'More about Check for new versions' });
    expect(tip).toBeTruthy();
    // The same explanation Admin → Updates uses, reachable by keyboard focus and read as the switch's description.
    expect(box().getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.focus(tip);
    expect(
      (await screen.findAllByText(/Once a day KinShip reads the public release list on GitHub \(api\.github\.com\)/))
        .length,
    ).toBeGreaterThan(0);
  });

  it('sends nothing about updates when it is left on', async () => {
    const fetchMock = await toReview();
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
    await waitFor(() => expect(document.body.textContent).not.toMatch(/Check your tree/));
    expect(found(fetchMock, SETTINGS)).toEqual([]);
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/setup');
    expect(JSON.parse(String(call?.[1]?.body))).not.toHaveProperty('checkUpdates');
  });

  it('turns the check off with the existing settings call, only after the account is created', async () => {
    const fetchMock = await toReview({ [SETTINGS]: { status: 200, body: { check: false } } });
    fireEvent.click(box());
    expect(box().checked).toBe(false);
    create();
    await waitFor(() => expect(found(fetchMock, SETTINGS)).toHaveLength(1));
    const all = calls(fetchMock);
    expect(all.indexOf('POST /api/setup')).toBeLessThan(all.indexOf(SETTINGS));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ check: false });
  });

  it('keeps the choice when going back to another step and returning', async () => {
    await toReview();
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Add your children' });
    fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
    await screen.findByRole('heading', { name: 'Check your tree' });
    expect(box().checked).toBe(false);
  });

  it('shows the error on the finish screen and says the check is still on, when the call fails', async () => {
    const fetchMock = await toReview({ [SETTINGS]: { status: 500, body: { error: 'internal_error' } } });
    fireEvent.click(box());
    create();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Your tree was created, but the update check setting could not be saved/);
    expect(alert.textContent).toMatch(/The check is still on/);
    expect(found(fetchMock, SETTINGS)).toHaveLength(1);
    // Not hidden: the person carries on from here.
    fireEvent.click(screen.getByRole('button', { name: 'Continue to my tree' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue to my tree' })).toBeNull());
  });
});
