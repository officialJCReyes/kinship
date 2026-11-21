// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin → Users: disable, enable and delete an account, and the disabled row (ADR 0029). Fictional Hale family only.
import type { AccountSummary } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function account(partial: Partial<AccountSummary> & Pick<AccountSummary, 'id' | 'email' | 'role'>): AccountSummary {
  return {
    kind: 'account',
    displayName: partial.email,
    person: null,
    status: 'active',
    lastSignInAt: null,
    invitedBy: null,
    passwordChangedAt: null,
    passwordChangedVia: null,
    invitation: null,
    setPasswordLink: null,
    canSetPasswordLink: false,
    canLinkPerson: true,
    allowedRoles: [],
    disabledAt: null,
    canDisable: false,
    canDelete: false,
    lastSuperAdmin: false,
    ...partial,
  };
}
const marcus = account({
  id: ADMIN.id,
  email: ADMIN.email,
  displayName: 'Marcus Hale',
  role: 'superadmin',
  lastSuperAdmin: true,
});
const eleanor = account({
  id: 'u2',
  email: 'eleanor@hale.example',
  displayName: 'Eleanor Hale',
  role: 'member',
  canDisable: true,
});
const disabledEleanor = {
  ...eleanor,
  status: 'disabled' as const,
  disabledAt: '2026-11-20T10:00:00Z',
  canDelete: true,
  canSetPasswordLink: false,
};

function routes(accounts: AccountSummary[], extra: Record<string, MockRoute> = {}) {
  return haleRoutes(ADMIN, { 'GET /api/admin/accounts': { status: 200, body: { accounts } }, ...extra });
}
const openMenu = async (name: string) => {
  const button = await screen.findByRole('button', { name: `Actions for ${name}` });
  fireEvent.click(button);
  return { button, menu: await screen.findByRole('menu', { name: `Actions for ${name}` }) };
};

describe('Disable', () => {
  it('asks first, says what happens, disables, refreshes the row to Disabled and returns focus to the menu button', async () => {
    let accounts = [marcus, eleanor];
    const fetchMock = mockApi(
      routes(accounts, {
        'GET /api/admin/accounts': () => ({ status: 200, body: { accounts } }),
        'POST /api/admin/accounts/u2/disable': () => {
          accounts = [marcus, disabledEleanor];
          return { status: 200, body: { accountId: 'u2', status: 'disabled', disabledAt: '2026-11-20T10:00:00Z' } };
        },
      }),
    );
    renderApp('/admin/users');
    const { button, menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Disable account…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disable Eleanor Hale?' });
    expect(dialog.textContent).toMatch(/signed out now and cannot sign in until you enable the account again/);
    expect(dialog.textContent).toMatch(/person, history and shares stay/);
    expect(calls(fetchMock)).not.toContain('POST /api/admin/accounts/u2/disable'); // nothing before the confirm
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable account' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Eleanor Hale is disabled and signed out.')).toBeTruthy();
    const row = (await screen.findByText('eleanor@hale.example')).closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Disabled')).toBeTruthy());
    expect(row.textContent).toMatch(/Disabled Nov 20|Disabled .*2026/);
    await waitFor(() => expect(document.activeElement).toBe(button));
    // the menu now offers Enable instead of Disable
    fireEvent.click(button);
    const again = await screen.findByRole('menu');
    expect(within(again).queryByRole('menuitem', { name: 'Disable account…' })).toBeNull();
    expect(within(again).getByRole('menuitem', { name: 'Enable account' })).toBeTruthy();
  });

  it('cancelling changes nothing', async () => {
    const fetchMock = mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    const { button, menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Disable account…' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock).filter((c) => c.startsWith('POST'))).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('keeps Disable in the menu but unavailable, with the reason, for yourself and for the last SuperAdmin', async () => {
    mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    const { menu } = await openMenu('Marcus Hale');
    for (const label of ['Disable account…', 'Delete account…']) {
      const item = within(menu).getByRole('menuitem', { name: new RegExp(label) });
      expect(item.getAttribute('aria-disabled')).toBe('true');
    }
    expect(within(menu).getByRole('menuitem', { name: /Disable account/ }).textContent).toContain(
      'You cannot do this to your own account.',
    );
  });

  it('says why when the only active SuperAdmin is reached by someone else (a second SuperAdmin of the future)', async () => {
    const other = account({
      id: 'u9',
      email: 'sa2@hale.example',
      displayName: 'Sam Hale',
      role: 'superadmin',
      lastSuperAdmin: true,
    });
    mockApi(routes([other]));
    renderApp('/admin/users');
    const { menu } = await openMenu('Sam Hale');
    expect(within(menu).getByRole('menuitem', { name: /Disable account/ }).textContent).toContain(
      'This is the only active SuperAdmin. At least one must stay.',
    );
  });

  it('shows a refusal from the server as an alert', async () => {
    mockApi(
      routes([marcus, eleanor], {
        'POST /api/admin/accounts/u2/disable': { status: 403, body: { error: 'role_not_allowed' } },
      }),
    );
    renderApp('/admin/users');
    const { menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Disable account…' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Disable account' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Your role cannot do that/);
  });
});

describe('Enable', () => {
  it('enables at once and the message says the old password works again', async () => {
    let accounts = [marcus, disabledEleanor];
    mockApi(
      routes(accounts, {
        'GET /api/admin/accounts': () => ({ status: 200, body: { accounts } }),
        'POST /api/admin/accounts/u2/enable': () => {
          accounts = [marcus, { ...eleanor }];
          return { status: 200, body: { accountId: 'u2', status: 'active', disabledAt: null } };
        },
      }),
    );
    renderApp('/admin/users');
    const { menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Enable account' }));
    expect(
      await screen.findByText(
        'Eleanor Hale is enabled. Their old password works again. Make a set-password link if you want them to choose a new one.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Disabled')).toBeNull());
  });
});

describe('Delete', () => {
  it('is unavailable for an active account, with the reason', async () => {
    mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    const { menu } = await openMenu('Eleanor Hale');
    const item = within(menu).getByRole('menuitem', { name: /Delete account/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Disable the account first.');
    fireEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('needs the typed email, says what stays and how many people were added, then deletes and moves focus to the heading', async () => {
    let accounts = [marcus, disabledEleanor];
    const fetchMock = mockApi(
      routes(accounts, {
        'GET /api/admin/accounts': () => ({ status: 200, body: { accounts } }),
        'GET /api/admin/accounts/u2/delete-preview': {
          status: 200,
          body: { accountId: 'u2', role: 'member', disabled: true, peopleAdded: 3 },
        },
        'POST /api/admin/accounts/u2/delete': () => {
          accounts = [marcus];
          return { status: 204, body: undefined };
        },
      }),
    );
    renderApp('/admin/users');
    const { menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete account…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the account of Eleanor Hale?' });
    expect(dialog.textContent).toMatch(/The person it was linked to, and everything on the tree, stays/);
    expect((await within(dialog).findByRole('note')).textContent).toMatch(/People this account added: 3/);
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    const field = within(dialog).getByLabelText('Type eleanor@hale.example to confirm');
    fireEvent.change(field, { target: { value: 'eleanor@hale' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(field, { target: { value: '  ELEANOR@hale.example ' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('The account of Eleanor Hale was deleted.')).toBeTruthy();
    const post = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/admin/accounts/u2/delete' && init?.method === 'POST',
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ confirmEmail: 'ELEANOR@hale.example' });
    // the typed email is in the body only, never in a URL
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('hale.example'))).toBe(true);
    await waitFor(() => expect(screen.queryByText('eleanor@hale.example')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Users' })));
  });

  it('shows a refusal as an alert and keeps the dialog open', async () => {
    mockApi(
      routes([marcus, disabledEleanor], {
        'GET /api/admin/accounts/u2/delete-preview': {
          status: 200,
          body: { accountId: 'u2', role: 'member', disabled: true, peopleAdded: 0 },
        },
        'POST /api/admin/accounts/u2/delete': { status: 400, body: { error: 'confirmation_mismatch' } },
      }),
    );
    renderApp('/admin/users');
    const { menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete account…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('note')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Type eleanor/), { target: { value: 'eleanor@hale.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/does not match this account/);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('the disabled row', () => {
  it('shows a Disabled pill in text and the date, and no set-password button', async () => {
    mockApi(routes([marcus, disabledEleanor]));
    renderApp('/admin/users');
    const row = (await screen.findByText('eleanor@hale.example')).closest('tr')!;
    expect(within(row).getByText('Disabled')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /set-password link/i })).toBeNull();
  });
});
