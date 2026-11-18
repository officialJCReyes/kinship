// SPDX-License-Identifier: AGPL-3.0-or-later
import { ROLES_INVITABLE_BY } from '@kinship/shared';
import type { AccountSummary } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, MEMBER, PEOPLE, haleRoutes } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const FAMILY_ADMIN = { ...ADMIN, id: 'u9', role: 'familyadmin' } as const;
const TOKEN = 'T0KEN-should-be-shown-once-AbCdEfGhIjKlMnOpQrStUvWxYz012345';

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
    ...partial,
  };
}

const marcus = account({
  id: ADMIN.id,
  email: ADMIN.email,
  displayName: 'Marcus Hale',
  role: 'superadmin',
  person: { id: 'marcus', name: 'Marcus Hale' },
  lastSignInAt: '2026-11-15T10:00:00Z',
  passwordChangedAt: '2026-11-01T10:00:00Z',
  passwordChangedVia: 'setup',
});
const daniel = account({
  id: 'u2',
  email: 'daniel@hale.example',
  displayName: 'Daniel Hale',
  role: 'member',
  person: { id: 'daniel', name: 'Daniel Hale' },
  passwordChangedAt: '2026-11-14T10:00:00Z',
  passwordChangedVia: 'admin_link',
  canSetPasswordLink: true,
});
const jordan = account({
  id: 'link-1',
  kind: 'invitation',
  email: 'jordan@hale.example',
  displayName: null,
  role: 'user',
  status: 'invited',
  invitedBy: 'Marcus Hale',
  invitation: { id: 'link-1', expiresAt: '2026-11-23T10:00:00Z', expired: false, canManage: true, note: 'Welcome!' },
});
const old = account({
  id: 'link-2',
  kind: 'invitation',
  email: 'late@hale.example',
  displayName: null,
  role: 'member',
  status: 'expired',
  invitation: { id: 'link-2', expiresAt: '2026-11-01T10:00:00Z', expired: true, canManage: false, note: null },
});

function routes(
  me: typeof ADMIN | typeof MEMBER | typeof FAMILY_ADMIN,
  accounts: AccountSummary[],
  extra: Record<string, MockRoute> = {},
) {
  return haleRoutes(me, { 'GET /api/admin/accounts': { status: 200, body: { accounts } }, ...extra });
}

const created = (kind: 'invite' | 'reset', linkId = 'new-link') => ({
  status: kind === 'invite' ? 201 : 201,
  body: { linkId, kind, token: TOKEN, expiresAt: '2026-11-23T10:00:00Z' },
});

describe('the Admin entry and its page', () => {
  it('is in the account menu for admins only, and /admin goes to Users', async () => {
    mockApi(routes(ADMIN, [marcus]));
    renderApp('/admin');
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeTruthy();
    const tabs = screen.getByRole('navigation', { name: 'Admin sections' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Users', 'Backups', 'Updates']); // Backups is the SuperAdmin's alone; Updates shows a Family Admin a note
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
  });

  it('gives a Member the not-found page on every /admin address, and no menu entry, without asking the API for accounts', async () => {
    for (const path of ['/admin', '/admin/users', '/admin/anything']) {
      const fetchMock = mockApi(routes(MEMBER, []));
      renderApp(path);
      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
      expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull();
      expect(calls(fetchMock)).not.toContain('GET /api/admin/accounts');
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('the Users list', () => {
  it('shows name, email, person, role, status, last sign-in and the password trace', async () => {
    mockApi(routes(ADMIN, [marcus, daniel, jordan, old]));
    renderApp('/admin/users');
    const table = await screen.findByRole('table', { name: 'Accounts and invitations' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    const danielRow = within(rows[1]!);
    expect(danielRow.getByText('daniel@hale.example')).toBeTruthy();
    expect(danielRow.getByRole('link', { name: 'Daniel Hale' }).getAttribute('href')).toBe('/people/daniel');
    expect(danielRow.getByText('Member')).toBeTruthy();
    expect(danielRow.getByText('Active')).toBeTruthy();
    expect(danielRow.getByText('Never')).toBeTruthy();
    expect(danielRow.getByText(/Password last changed .*using a link from an admin/)).toBeTruthy();
    expect(within(rows[0]!).getByText(/Password last changed .*when the tree was set up/)).toBeTruthy();
    const jordanRow = within(rows[2]!);
    expect(jordanRow.getByText('Invited')).toBeTruthy();
    expect(jordanRow.getByText('Invited by Marcus Hale')).toBeTruthy();
    expect(jordanRow.getByText('Note: Welcome!')).toBeTruthy();
    expect(jordanRow.getByText('Not linked to a person')).toBeTruthy();
    expect(within(rows[3]!).getByText('Expired')).toBeTruthy();
  });

  it('says an unrecorded password change is not recorded', async () => {
    mockApi(routes(ADMIN, [marcus, { ...daniel, passwordChangedAt: null, passwordChangedVia: null }]));
    renderApp('/admin/users');
    expect(await screen.findByText('Password change not recorded')).toBeTruthy();
  });

  it('says so when nobody else has an account, and when the list cannot be loaded', async () => {
    mockApi(routes(ADMIN, [marcus]));
    renderApp('/admin/users');
    expect(await screen.findByText(/Nobody else has an account yet/)).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(routes(ADMIN, [], { 'GET /api/admin/accounts': { status: 500, body: { error: 'internal_error' } } }));
    renderApp('/admin/users');
    expect((await screen.findByRole('alert')).textContent).toMatch(/server had a problem/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Invite user', () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    return await screen.findByRole('dialog', { name: 'Invite a user' });
  };
  const rolesIn = (dialog: HTMLElement) =>
    within(within(dialog).getByRole('combobox', { name: 'Role' }))
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('offers a SuperAdmin Family Admin, Member and User, and a Family Admin Member and User only', async () => {
    mockApi(routes(ADMIN, [marcus]));
    renderApp('/admin/users');
    expect(rolesIn(await open())).toEqual(['Family Admin', 'Member', 'User']);
    expect(ROLES_INVITABLE_BY.superadmin).toEqual(['familyadmin', 'member', 'user']);
    cleanup();
    vi.unstubAllGlobals();
    mockApi(routes(FAMILY_ADMIN, [marcus]));
    renderApp('/admin/users');
    expect(rolesIn(await open())).toEqual(['Member', 'User']);
  });

  it('warns that a Member with no person can only read, and drops the warning for other roles', async () => {
    mockApi(routes(ADMIN, [marcus]));
    renderApp('/admin/users');
    const dialog = await open();
    expect(within(dialog).queryByRole('note')).toBeNull();
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Role' }), { target: { value: 'member' } });
    expect(within(dialog).getByRole('note').textContent).toMatch(/Member who is not linked to a person can only read/);
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Role' }), { target: { value: 'user' } });
    expect(within(dialog).queryByRole('note')).toBeNull();
  });

  it('checks the email before sending, then shows the link once and keeps the token out of every cache', async () => {
    const fetchMock = mockApi(routes(ADMIN, [marcus], { 'POST /api/admin/invitations': created('invite') }));
    const { client } = renderApp('/admin/users');
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create invitation link' }));
    expect(within(dialog).getByText('Enter a valid email address.')).toBeTruthy();
    expect(calls(fetchMock)).not.toContain('POST /api/admin/invitations');

    fireEvent.change(within(dialog).getByLabelText('Email address'), { target: { value: ' Jordan@Hale.example ' } });
    fireEvent.change(within(dialog).getByLabelText('Personal note (optional)'), { target: { value: 'Welcome!' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create invitation link' }));

    const linkDialog = await screen.findByRole('dialog', { name: 'Invitation link for jordan@hale.example' });
    const body = JSON.parse(String(fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')?.[1]?.body));
    expect(body).toEqual({ email: 'Jordan@Hale.example', role: 'user', personId: null, note: 'Welcome!' });
    expect((within(linkDialog).getByLabelText('Link') as HTMLInputElement).value).toBe(
      `${window.location.origin}/invite#${TOKEN}`,
    );
    expect(linkDialog.textContent).toMatch(/shown only now.*cannot see it again/);
    expect(linkDialog.textContent).toMatch(/does not send it for you/);

    // The token is in the dialog and nowhere else: not in the query cache, not in storage, not in any request URL.
    const cached = JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    expect(cached).not.toContain(TOKEN);
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.data ?? null),
      ),
    ).not.toContain(TOKEN);
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain(TOKEN);
    expect(calls(fetchMock).join('\n')).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);

    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('copies the link', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    mockApi(routes(ADMIN, [marcus], { 'POST /api/admin/invitations': created('invite') }));
    renderApp('/admin/users');
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText('Email address'), { target: { value: 'jordan@hale.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create invitation link' }));
    const linkDialog = await screen.findByRole('dialog', { name: /Invitation link for/ });
    fireEvent.click(within(linkDialog).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite#${TOKEN}`));
    expect(await within(linkDialog).findByText('Copied.')).toBeTruthy();
  });

  it('shows the API’s reason, for example an email that already has an account, and sends nothing twice', async () => {
    mockApi(
      routes(ADMIN, [marcus], { 'POST /api/admin/invitations': { status: 409, body: { error: 'email_taken' } } }),
    );
    renderApp('/admin/users');
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText('Email address'), { target: { value: 'daniel@hale.example' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create invitation link' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'An account with that email address already exists.',
    );
    expect(screen.queryByRole('dialog', { name: /Invitation link/ })).toBeNull();
  });

  it('lists only people with no account and no open invitation in the picker', async () => {
    const fetchMock = mockApi(
      routes(ADMIN, [marcus, daniel, { ...jordan, person: { id: 'priya', name: 'Priya Nair' } }], {
        '/api/people?q=a&limit=8': { status: 200, body: { items: PEOPLE, nextCursor: null } },
      }),
    );
    renderApp('/admin/users');
    const dialog = await open();
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Link to a person on the tree (optional)' }), {
      target: { value: 'a' },
    });
    await waitFor(() => expect(calls(fetchMock).some((c) => c.startsWith('GET /api/people'))).toBe(true));
    const list = await within(dialog).findByRole('listbox', { name: 'Link to a person on the tree (optional)' });
    const options = await within(list).findAllByRole('option');
    const names = options.map((o) => o.textContent ?? '');
    expect(names.some((n) => n.startsWith('Marcus Hale'))).toBe(false);
    expect(names.some((n) => n.startsWith('Daniel Hale'))).toBe(false);
    expect(names.some((n) => n.startsWith('Priya Nair'))).toBe(false);
    expect(names.some((n) => n.startsWith('Sofia Hale'))).toBe(true);
  });
});

describe('links on a row', () => {
  it('makes a new link for an invitation, saying the old one no longer works, and refreshes the list', async () => {
    const fetchMock = mockApi(
      routes(ADMIN, [marcus, jordan], {
        'POST /api/admin/links/link-1/regenerate': { ...created('invite', 'link-1'), status: 200 },
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Make a new link for jordan@hale.example' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invitation link for jordan@hale.example' });
    expect(dialog.textContent).toMatch(/earlier link no longer works/);
    expect((within(dialog).getByLabelText('Link') as HTMLInputElement).value).toContain(`/invite#${TOKEN}`);
    expect(calls(fetchMock)).toContain('POST /api/admin/links/link-1/regenerate');
    await waitFor(() =>
      expect(calls(fetchMock).filter((c) => c === 'GET /api/admin/accounts').length).toBeGreaterThan(1),
    );
  });

  it('revokes after a confirmation, and can be cancelled', async () => {
    const fetchMock = mockApi(
      routes(ADMIN, [marcus, jordan], { 'POST /api/admin/links/link-1/revoke': { status: 204 } }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke the link for jordan@hale.example' }));
    let dialog = await screen.findByRole('dialog', { name: 'Revoke this link?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(calls(fetchMock)).not.toContain('POST /api/admin/links/link-1/revoke');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the link for jordan@hale.example' }));
    dialog = await screen.findByRole('dialog', { name: 'Revoke this link?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/admin/links/link-1/revoke'));
    expect(await screen.findByText('The link was revoked.')).toBeTruthy();
  });

  it('disables the buttons, with the reason, for an invitation this role cannot change', async () => {
    mockApi(routes(FAMILY_ADMIN, [marcus, old]));
    renderApp('/admin/users');
    const button = await screen.findByRole('button', { name: 'Make a new link for late@hale.example' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('Your role cannot change this one.');
  });

  it('makes a set-password link only where the rules allow it, and warns what it does', async () => {
    const fetchMock = mockApi(
      routes(ADMIN, [marcus, daniel], { 'POST /api/admin/accounts/u2/set-password-link': created('reset') }),
    );
    renderApp('/admin/users');
    expect(await screen.findAllByRole('button', { name: /Make a set-password link for/ })).toHaveLength(1); // not for yourself
    fireEvent.click(screen.getByRole('button', { name: 'Make a set-password link for Daniel Hale' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set-password link for Daniel Hale' });
    expect((within(dialog).getByLabelText('Link') as HTMLInputElement).value).toBe(
      `${window.location.origin}/reset#${TOKEN}`,
    );
    expect(dialog.textContent).toMatch(
      /signed out everywhere, and the account will show that an admin set the password/,
    );
    expect(calls(fetchMock)).toContain('POST /api/admin/accounts/u2/set-password-link');
  });

  it('offers a new link and a revoke where a set-password link is already open, and shows when it ends', async () => {
    mockApi(
      routes(ADMIN, [
        marcus,
        {
          ...daniel,
          setPasswordLink: { id: 'r1', expiresAt: '2026-11-17T10:00:00Z', expired: false, canManage: true },
        },
      ]),
    );
    renderApp('/admin/users');
    expect(await screen.findByText(/Set-password link open until/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make a new link for Daniel Hale' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke the link for Daniel Hale' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Make a set-password link/ })).toBeNull();
  });

  it('shows the API’s reason when a link action fails', async () => {
    mockApi(
      routes(ADMIN, [marcus, daniel], {
        'POST /api/admin/accounts/u2/set-password-link': { status: 409, body: { error: 'link_exists' } },
      }),
    );
    renderApp('/admin/users');
    fireEvent.click(await screen.findByRole('button', { name: 'Make a set-password link for Daniel Hale' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a set-password link/);
  });
});
