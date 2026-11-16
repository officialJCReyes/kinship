// SPDX-License-Identifier: AGPL-3.0-or-later
import { focusManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, MEMBER, haleRoutes, READER } from './family.js';
import { ALICE, chooseFromAccountMenu, mockApi, renderApp, signedIn } from './helpers.js';

const root = document.documentElement;
const attrs = () => [root.getAttribute('data-scheme'), root.getAttribute('data-theme')];
const mirror = () => JSON.parse(window.localStorage.getItem('kinship.display') ?? 'null');

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.kinshipTheme?.apply({ colorScheme: 'forest', theme: 'light' }, false);
});

function bodyOf(fetchMock: ReturnType<typeof mockApi>, key: string): unknown {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([input, init]) => `${(init?.method ?? 'GET').toUpperCase()} ${String(input)}` === key);
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}
const meWith = (user: object) => ({ status: 200, body: { user, treeName: 'Hale Family' } });

describe('the account menu', () => {
  it('has My settings, About KinShip and Sign out, and My profile only for an account linked to a person', async () => {
    mockApi(signedIn);
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['My settings', 'About KinShip', 'Sign out']);
    cleanup();
    vi.unstubAllGlobals();
    mockApi(haleRoutes(MEMBER));
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    const linked = screen.getByRole('menu', { name: 'Account menu' });
    expect(
      within(linked)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['My profile', 'My settings', 'About KinShip', 'Sign out']);
    expect(within(linked).getByRole('menuitem', { name: 'My profile' }).getAttribute('href')).toBe('/people/marcus');
  });

  it('is gone from the top navigation: My profile and About are only in the menu', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/');
    await screen.findByRole('button', { name: 'Account menu' });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'My profile' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'About' })).toBeNull();
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Home', 'Family tree', 'People']);
  });

  it('moves with the arrow keys, closes with Escape and gives the focus back, and closes on a click outside', async () => {
    mockApi(signedIn);
    renderApp('/');
    const button = await screen.findByRole('button', { name: 'Account menu' });
    fireEvent.click(button);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens My settings from the menu', async () => {
    mockApi(signedIn);
    renderApp('/');
    await chooseFromAccountMenu('My settings');
    expect(await screen.findByRole('heading', { name: 'My settings' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('My settings', () => {
  it('shows the account’s choices, the example of each, and the read-only Account card', async () => {
    mockApi(
      haleRoutes({
        ...MEMBER,
        colorScheme: 'slate',
        theme: 'dark',
        dateFormat: 'iso',
        surnameChoice: 'birth',
        lineageView: 'birth',
      }),
    );
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'My settings' });
    const swatches = screen.getByRole('radiogroup', { name: 'Color scheme' });
    expect(
      within(swatches)
        .getAllByRole('radio')
        .map((r) => `${r.textContent}:${r.getAttribute('aria-checked')}`),
    ).toEqual(['Forest:false', 'Warm sand:false', 'Slate blue:true', 'Graphite:false']);
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark');
    expect((screen.getByLabelText('Date format') as HTMLSelectElement).value).toBe('iso');
    expect(screen.getByText(/Example: 2026-03-09\./)).toBeTruthy();
    expect((screen.getByLabelText('Which surname shows') as HTMLSelectElement).value).toBe('birth');
    expect(screen.getByText(/Example: Rosa Mendez\./)).toBeTruthy();
    expect((screen.getByLabelText('When someone was adopted, show') as HTMLSelectElement).value).toBe('birth');
    const account = screen.getByRole('heading', { name: 'Account' }).closest('section')!;
    expect(within(account).getByText('Marcus Hale')).toBeTruthy();
    expect(within(account).getByText('m@example.com')).toBeTruthy();
    expect(within(account).getByText('Member')).toBeTruthy();
    expect(await within(account).findByRole('link', { name: 'Marcus Hale' })).toBeTruthy();
  });

  it('lists the seven date formats with the mockup’s wording, and a live example that changes with the choice', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/settings');
    const select = (await screen.findByLabelText('Date format')) as HTMLSelectElement;
    expect([...select.options].map((o) => `${o.value}=${o.textContent}`)).toEqual([
      'mdy=Jan 1, 2026',
      'dmy=1 Jan, 2026',
      'dmy2=1 Jan 2026',
      'long=January 1, 2026',
      'iso=2026-01-01',
      'us=01/01/2026 (month first)',
      'eu=01/01/2026 (day first)',
    ]);
    expect(screen.getByText(/Example: Mar 9, 2026\./)).toBeTruthy();
  });

  it('applies a change at once, sends only that setting, and rewrites the mirror', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/auth/me': meWith({
          ...ADMIN,
          colorScheme: 'sand',
          theme: 'device',
          dateFormat: 'mdy',
          surnameChoice: 'married',
        }),
      }),
    );
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'My settings' });
    fireEvent.click(screen.getByRole('radio', { name: /Warm sand/ }));
    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH /api/auth/me')).toEqual({ colorScheme: 'sand' }));
    await waitFor(() => expect(attrs()[0]).toBe('sand'));
    expect(mirror()).toEqual({ colorScheme: 'sand', theme: 'device' });
    expect(screen.getByRole('radio', { name: /Warm sand/ }).getAttribute('aria-checked')).toBe('true');
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('applies the theme at once, before the server has answered', async () => {
    mockApi(haleRoutes(ADMIN, { 'PATCH /api/auth/me': 'never' }));
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'My settings' });
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    await waitFor(() => expect(attrs()[1]).toBe('dark'));
    expect(mirror()).toEqual({ colorScheme: 'forest', theme: 'dark' });
  });

  it('puts the earlier value back and says so when the save fails', async () => {
    mockApi(haleRoutes(ADMIN, { 'PATCH /api/auth/me': { status: 500, body: { error: 'internal_error' } } }));
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'My settings' });
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/That change was not saved, so it was undone\./);
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('device');
    await waitFor(() => expect(attrs()[1]).toBe('light'));
    expect(mirror()).toEqual({ colorScheme: 'forest', theme: 'device' });
  });

  it('does not remount the page for a change made on it: the focus stays on the control', async () => {
    mockApi(haleRoutes(ADMIN, { 'PATCH /api/auth/me': meWith({ ...ADMIN, dateFormat: 'iso' }) }));
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'My settings' });
    const select = screen.getByLabelText('Date format') as HTMLSelectElement;
    select.focus();
    fireEvent.change(select, { target: { value: 'iso' } });
    await screen.findByText(/Example: 2026-03-09\./);
    expect(document.activeElement).toBe(select);
    expect(screen.getByLabelText('Date format')).toBe(select);
  });

  it('sends the family choice, and the profile banner and the page agree', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN, { 'PATCH /api/auth/me': meWith({ ...ADMIN, lineageView: 'birth' }) }));
    renderApp('/settings');
    await screen.findByRole('heading', { name: 'My settings' });
    fireEvent.change(screen.getByLabelText('When someone was adopted, show'), { target: { value: 'birth' } });
    await waitFor(() => expect(bodyOf(fetchMock, 'PATCH /api/auth/me')).toEqual({ lineageView: 'birth' }));
    await waitFor(() =>
      expect((screen.getByLabelText('When someone was adopted, show') as HTMLSelectElement).value).toBe('birth'),
    );
  });

  it('is open to a Member and a User, for their own account', async () => {
    for (const who of [MEMBER, READER]) {
      mockApi(haleRoutes(who));
      renderApp('/settings');
      await screen.findByRole('heading', { name: 'My settings' });
      expect(screen.getByLabelText('Theme')).toBeTruthy();
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it('shows a signed-out visitor the sign-in page, not the settings', async () => {
    mockApi({ ...signedIn, '/api/auth/me': { status: 401, body: { error: 'unauthenticated' } } });
    renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('a change made elsewhere', () => {
  it('is picked up when the window is looked at again', async () => {
    let user = { ...ALICE, colorScheme: 'forest', theme: 'light' };
    mockApi({ ...signedIn, '/api/auth/me': () => meWith(user) });
    renderApp('/about');
    await waitFor(() => expect(attrs()).toEqual(['forest', 'light']));
    user = { ...user, colorScheme: 'graphite', theme: 'dark' }; // changed in another browser
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(attrs()).toEqual(['graphite', 'dark']));
    expect(mirror()).toEqual({ colorScheme: 'graphite', theme: 'dark' });
  });
});
