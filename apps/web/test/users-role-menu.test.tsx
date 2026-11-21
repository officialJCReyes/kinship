// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin → Users: the row actions menu (keyboard, unavailable items) and the Change role dialog (ADR 0029).
// Fictional Hale family only.
import type { AccountSummary } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes } from './family.js';
import { mockApi, renderApp } from './helpers.js';
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
  person: { id: 'marcus', name: 'Marcus Hale' },
});
const eleanor = account({
  id: 'u2',
  email: 'eleanor@hale.example',
  displayName: 'Eleanor Hale',
  role: 'member',
  person: { id: 'daniel', name: 'Daniel Hale' },
  allowedRoles: ['familyadmin', 'member', 'user'],
});
const visiting = account({
  id: 'u3',
  email: 'visiting@hale.example',
  displayName: 'Visiting User',
  role: 'user',
  allowedRoles: ['familyadmin', 'member', 'user'],
});
const otherAdmin = account({
  id: 'u4',
  email: 'rosa@hale.example',
  displayName: 'Rosa Hale',
  role: 'familyadmin',
});

function routes(accounts: AccountSummary[], extra: Record<string, MockRoute> = {}) {
  return haleRoutes(ADMIN, { 'GET /api/admin/accounts': { status: 200, body: { accounts } }, ...extra });
}
const openMenu = async (name: string) => {
  const button = await screen.findByRole('button', { name: `Actions for ${name}` });
  fireEvent.click(button);
  return { button, menu: await screen.findByRole('menu', { name: `Actions for ${name}` }) };
};

describe('the row actions menu', () => {
  it('is a menu button: it opens with focus on the first item, closes with Escape and gives focus back', async () => {
    mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    const button = await screen.findByRole('button', { name: 'Actions for Eleanor Hale' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const menu = await screen.findByRole('menu', { name: 'Actions for Eleanor Hale' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const item = within(menu).getByRole('menuitem', { name: 'Change role…' });
    await waitFor(() => expect(document.activeElement).toBe(item));
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it('opens from the keyboard with the Down arrow, and a click outside closes it', async () => {
    mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    const button = await screen.findByRole('button', { name: 'Actions for Eleanor Hale' });
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    expect(await screen.findByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('keeps an unavailable item in the menu, says why in text, and does nothing when it is chosen', async () => {
    mockApi(routes([marcus, otherAdmin, eleanor]));
    renderApp('/admin/users');
    // your own account
    let { menu } = await openMenu('Marcus Hale');
    let item = within(menu).getByRole('menuitem', { name: /Change role/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('You cannot do this to your own account.');
    expect(item.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.click(item);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });
    // an account the admin may not change (here: allowedRoles is empty)
    ({ menu } = await openMenu('Rosa Hale'));
    item = within(menu).getByRole('menuitem', { name: /Change role/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Your role cannot change this one.');
  });
});

describe('Change role', () => {
  it('offers only the roles this admin may set, marks the current one, and saves only a different choice', async () => {
    let accounts = [marcus, eleanor];
    const fetchMock = mockApi(
      routes(accounts, {
        'GET /api/admin/accounts': () => ({ status: 200, body: { accounts } }),
        'PATCH /api/admin/accounts/u2/role': () => {
          accounts = [marcus, { ...eleanor, role: 'user' }];
          return { status: 200, body: { accountId: 'u2', role: 'user', previous: 'member' } };
        },
      }),
    );
    renderApp('/admin/users');
    const { button, menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Change role…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the role of Eleanor Hale' });
    const group = within(dialog).getByRole('group', { name: 'Role' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['familyadmin', 'member', 'user']);
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    expect(group.textContent).toContain('(current)');
    expect(
      within(dialog)
        .getByRole('radio', { name: /^Member/ })
        .getAttribute('aria-describedby'),
    ).toBeTruthy();
    const save = within(dialog).getByRole('button', { name: 'Change role' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /^User/ }));
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Eleanor Hale’s role is now User.')).toBeTruthy();
    const patch = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/admin/accounts/u2/role' && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ role: 'user', currentRole: 'member' });
    // the list is refreshed, and focus is back on the row's menu button
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('warns that a Member with no linked person can only read, and shows a refusal from the server as an alert', async () => {
    mockApi(
      routes([marcus, visiting], {
        'PATCH /api/admin/accounts/u3/role': { status: 409, body: { error: 'account_role_changed' } },
      }),
    );
    renderApp('/admin/users');
    const { menu } = await openMenu('Visiting User');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Change role…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the role of Visiting User' });
    expect(within(dialog).queryByRole('note')).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: /^Member/ }));
    expect(within(dialog).getByRole('note').textContent).toMatch(/can only read the tree/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toMatch(/role was changed in the meantime/);
  });

  it('closing the dialog gives focus back to the row’s menu button', async () => {
    mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    const { button, menu } = await openMenu('Eleanor Hale');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Change role…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
