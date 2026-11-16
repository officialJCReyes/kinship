// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALICE, ME, calls, chooseFromAccountMenu, mockApi, renderApp, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const meWith = (patch: object): MockRoute => ({ status: 200, body: { ...ME, user: { ...ALICE, ...patch } } });

async function openForm() {
  renderApp('/settings');
  return await screen.findByRole('form', { name: 'Change password' });
}
const fill = (current: string, next: string, again: string) => {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Type the new password again'), { target: { value: again } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

describe('the Account card', () => {
  it('says how the password last changed, in words, for each way it can', async () => {
    const cases: [object, RegExp][] = [
      [
        { passwordChangedAt: '2026-11-14T12:00:00Z', passwordChangedVia: 'admin_link' },
        /Password last changed .*, using a link from an admin/,
      ],
      [
        { passwordChangedAt: '2026-11-14T12:00:00Z', passwordChangedVia: 'self' },
        /Password last changed .*, by the account owner/,
      ],
      [
        { passwordChangedAt: '2026-11-14T12:00:00Z', passwordChangedVia: 'cli' },
        /Password last changed .*, by the person who runs the server/,
      ],
      [
        { passwordChangedAt: '2026-11-14T12:00:00Z', passwordChangedVia: 'invitation' },
        /Password last changed .*, when the invitation was accepted/,
      ],
      [
        { passwordChangedAt: '2026-11-14T12:00:00Z', passwordChangedVia: 'setup' },
        /Password last changed .*, when the tree was set up/,
      ],
      [{ passwordChangedAt: null, passwordChangedVia: null }, /^Password change not recorded$/],
    ];
    for (const [patch, text] of cases) {
      mockApi({ ...signedIn, '/api/auth/me': meWith(patch) });
      renderApp('/settings');
      expect((await screen.findByText(text)).closest('dd')).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('Change password', () => {
  it('checks the new password and the confirmation before sending anything', async () => {
    const fetchMock = mockApi(signedIn);
    await openForm();
    submit();
    expect(screen.getAllByText('At least 12 characters.').length).toBeGreaterThan(1);
    fill('old password here', 'a long new passphrase', 'something else entirely');
    submit();
    expect(screen.getByText('The two passwords are not the same.')).toBeTruthy();
    expect(calls(fetchMock)).not.toContain('POST /api/auth/password');
  });

  it('changes it, says the other devices were signed out, empties the form and reads the trace again', async () => {
    let changed = false;
    const fetchMock = mockApi({
      ...signedIn,
      '/api/auth/me': () =>
        meWith(changed ? { passwordChangedAt: '2026-11-16T12:00:00Z', passwordChangedVia: 'self' } : {}) as {
          status: number;
        },
      'POST /api/auth/password': () => {
        changed = true;
        return { status: 204 };
      },
    });
    await openForm();
    expect(screen.getByText('Password change not recorded')).toBeTruthy();
    fill('old password here', 'a long new passphrase', 'a long new passphrase');
    submit();
    expect(await screen.findByText('Your password was changed. Every other device was signed out.')).toBeTruthy();
    const call = fetchMock.mock.calls.find(([input]) => String(input) === '/api/auth/password');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      currentPassword: 'old password here',
      newPassword: 'a long new passphrase',
    });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText(/Password last changed .*, by the account owner/)).toBeTruthy();
  });

  it('shows a wrong current password on that field, and keeps what was typed for the others', async () => {
    mockApi({ ...signedIn, 'POST /api/auth/password': { status: 400, body: { error: 'invalid_current_password' } } });
    await openForm();
    fill('not my password', 'a long new passphrase', 'a long new passphrase');
    submit();
    expect(await screen.findByText('The current password is not right.')).toBeTruthy();
    expect(screen.getByLabelText('Current password').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('a long new passphrase');
    expect(screen.queryByText(/Your password was changed/)).toBeNull();
  });

  it('shows the wait when there were too many tries', async () => {
    mockApi({
      ...signedIn,
      'POST /api/auth/password': { status: 429, body: { error: 'rate_limited', retryAfterSeconds: 90 } },
    });
    await openForm();
    fill('not my password', 'a long new passphrase', 'a long new passphrase');
    submit();
    expect((await screen.findByRole('alert')).textContent).toContain('90 seconds');
  });

  it('is on the page reached from the account menu', async () => {
    mockApi(signedIn);
    renderApp('/');
    await chooseFromAccountMenu('My settings');
    await waitFor(() => expect(screen.getByRole('form', { name: 'Change password' })).toBeTruthy());
  });
});
