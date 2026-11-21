// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Admin → Users: link an account to a person, change the link, unlink (ADR 0020). Fictional Hale family only.
import type { AccountSummary, LinkPreview } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, PEOPLE, haleRoutes } from './family.js';
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
const visiting = account({ id: 'u3', email: 'visiting@hale.example', displayName: 'Visiting User', role: 'user' });
const eleanor = account({
  id: 'u2',
  email: 'eleanor@hale.example',
  displayName: 'Eleanor Hale',
  role: 'member',
  person: { id: 'daniel', name: 'Daniel Hale' },
});

const advice = (partial: Partial<LinkPreview> = {}): { status: number; body: LinkPreview } => ({
  status: 200,
  body: {
    role: 'user',
    person: { id: 'sofia', name: 'Sofia Hale' },
    current: null,
    descendantsInLine: 0,
    createdByAccountInLine: 0,
    losesEdit: 0,
    ...partial,
  },
});

function routes(accounts: AccountSummary[], extra: Record<string, MockRoute> = {}) {
  return haleRoutes(ADMIN, {
    'GET /api/admin/accounts': { status: 200, body: { accounts } },
    '/api/people?q=sofia&limit=8': { status: 200, body: { items: PEOPLE, nextCursor: null } },
    ...extra,
  });
}

const choosePerson = async (dialog: HTMLElement, text = 'sofia') => {
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Person' }), { target: { value: text } });
  const list = await within(dialog).findByRole('listbox', { name: 'Person' });
  fireEvent.click(await within(list).findByRole('option', { name: /Sofia Hale/ }));
};

describe('Link to a person', () => {
  it('shows the button for an account with no person, the advice in a polite live region, and saves on confirm', async () => {
    let accounts = [marcus, visiting];
    const fetchMock = mockApi(
      routes(accounts, {
        'GET /api/admin/accounts': () => ({ status: 200, body: { accounts } }),
        'GET /api/admin/accounts/u3/link-preview?personId=sofia': advice(),
        'PUT /api/admin/accounts/u3/person': () => {
          accounts = [marcus, { ...visiting, person: { id: 'sofia', name: 'Sofia Hale' } }];
          return { status: 200, body: { accountId: 'u3', person: { id: 'sofia', name: 'Sofia Hale' } } };
        },
      }),
    );
    renderApp('/admin/users');
    const button = await screen.findByRole('button', { name: 'Link Visiting User to a person' });
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog', { name: 'Link Visiting User to a person' });
    const confirm = within(dialog).getByRole('button', { name: 'Link account' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    await choosePerson(dialog);
    const note = await within(dialog).findByRole('note');
    expect(note.textContent).toMatch(/does not change what they may edit/);
    expect(note.closest('[aria-live="polite"]')).toBeTruthy();
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    expect(calls(fetchMock)).not.toContain('PUT /api/admin/accounts/u3/person'); // nothing saved before the confirm
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Visiting User is now linked to Sofia Hale.')).toBeTruthy();
    const put = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === '/api/admin/accounts/u3/person' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ personId: 'sofia', currentPersonId: null });
    // The list was refreshed and focus is back on the row's button, now "Change".
    const row = await screen.findByRole('button', { name: 'Change the person linked to Visiting User' });
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it('says what a Member can edit afterwards, and what they lose', async () => {
    mockApi(
      routes([marcus, eleanor], {
        'GET /api/admin/accounts/u2/link-preview?personId=sofia': advice({
          role: 'member',
          current: { id: 'daniel', name: 'Daniel Hale' },
          createdByAccountInLine: 3,
          losesEdit: 2,
        }),
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Change the person linked to Eleanor Hale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the person linked to Eleanor Hale' });
    await choosePerson(dialog);
    const note = await within(dialog).findByRole('note');
    expect(note.textContent).toContain('Eleanor Hale will be able to edit Sofia Hale.');
    expect(note.textContent).toContain('Also the 3 people Eleanor Hale added below Sofia Hale.');
    expect(note.textContent).toContain('could edit 2 other people, and will no longer be able to');
    expect(within(dialog).getByRole('button', { name: 'Change link' })).toBeTruthy();
  });

  it('shows a refusal from the server as an alert and keeps the dialog open', async () => {
    mockApi(
      routes([marcus, visiting], {
        'GET /api/admin/accounts/u3/link-preview?personId=sofia': advice(),
        'PUT /api/admin/accounts/u3/person': { status: 409, body: { error: 'person_has_open_invitation' } },
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Link Visiting User to a person' }));
    const dialog = await screen.findByRole('dialog');
    await choosePerson(dialog);
    const confirm = within(dialog).getByRole('button', { name: 'Link account' });
    await waitFor(() => expect(confirm.hasAttribute('disabled')).toBe(false));
    fireEvent.click(confirm);
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(
      'That person has an open invitation. Revoke the invitation first, then link the account.',
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a failed preview as an alert and does not let the admin save', async () => {
    mockApi(
      routes([marcus, visiting], {
        'GET /api/admin/accounts/u3/link-preview?personId=sofia': {
          status: 409,
          body: { error: 'person_already_linked' },
        },
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Link Visiting User to a person' }));
    const dialog = await screen.findByRole('dialog');
    await choosePerson(dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toBe('That person already has an account.');
    expect(within(dialog).getByRole('button', { name: 'Link account' }).hasAttribute('disabled')).toBe(true);
  });

  it('closes on Cancel and puts focus back on the row button', async () => {
    mockApi(routes([marcus, visiting]));
    renderApp('/admin/users');
    const button = await screen.findByRole('button', { name: 'Link Visiting User to a person' });
    button.focus();
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('is disabled with the reason when the hierarchy forbids it, and does nothing', async () => {
    mockApi(routes([marcus, { ...visiting, canLinkPerson: false }]));
    renderApp('/admin/users');
    const button = await screen.findByRole('button', { name: 'Link Visiting User to a person' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('Your role cannot change this one.');
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers no person buttons on an invitation', async () => {
    const invitation = account({
      id: 'link-1',
      kind: 'invitation',
      email: 'jordan@hale.example',
      displayName: null,
      role: 'user',
      status: 'invited',
      canLinkPerson: false,
      invitation: { id: 'link-1', expiresAt: '2026-11-23T10:00:00Z', expired: false, canManage: true, note: null },
    });
    mockApi(routes([marcus, invitation]));
    renderApp('/admin/users');
    await screen.findByText('jordan@hale.example');
    expect(screen.queryByRole('button', { name: /jordan@hale.example to a person/ })).toBeNull();
  });
});

describe('Unlink', () => {
  it('asks first, says what is lost, then unlinks and refreshes', async () => {
    let accounts = [marcus, eleanor];
    const fetchMock = mockApi(
      routes(accounts, {
        'GET /api/admin/accounts': () => ({ status: 200, body: { accounts } }),
        'DELETE /api/admin/accounts/u2/person?currentPersonId=daniel': () => {
          accounts = [marcus, { ...eleanor, person: null }];
          return { status: 204 };
        },
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink Eleanor Hale from Daniel Hale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unlink Eleanor Hale?' });
    expect(dialog.textContent).toMatch(/will no longer be linked to Daniel Hale/);
    expect(calls(fetchMock).some((c) => c.startsWith('DELETE'))).toBe(false); // nothing before the confirm
    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlink account' }));
    expect(await screen.findByText('Eleanor Hale is no longer linked to a person.')).toBeTruthy();
    const link = await screen.findByRole('button', { name: 'Link Eleanor Hale to a person' });
    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it('can be cancelled without a call', async () => {
    const fetchMock = mockApi(routes([marcus, eleanor]));
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink Eleanor Hale from Daniel Hale' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock).some((c) => c.startsWith('DELETE'))).toBe(false);
  });

  it('shows a stale-page refusal as an alert', async () => {
    mockApi(
      routes([marcus, eleanor], {
        'DELETE /api/admin/accounts/u2/person?currentPersonId=daniel': {
          status: 409,
          body: { error: 'account_already_linked' },
        },
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink Eleanor Hale from Daniel Hale' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unlink account' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/linked to someone else in the meantime/);
  });
});
