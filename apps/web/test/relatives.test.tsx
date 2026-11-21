// SPDX-License-Identifier: AGPL-3.0-or-later
// "Show aunts, uncles and cousins" (ADR 0027): the chart asks the API for the brothers and sisters and their families only,
// until the account turns the setting on in the chart's gear.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AuthUser } from '@kinship/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, PARENTAGE, PEOPLE, treeFor } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

// Greta Hale: Walter and Rosa's daughter, so Daniel's sister and Marcus's aunt. Not drawn until the setting is on.
const GRETA = { ...PEOPLE.find((p) => p.id === 'daniel')!, id: 'greta', givenName: 'Greta', birth: null };

beforeEach(() => {
  PEOPLE.push(GRETA);
  PARENTAGE['greta'] = { unionId: 'u0' };
});
afterEach(() => {
  PEOPLE.splice(PEOPLE.indexOf(GRETA), 1);
  delete PARENTAGE['greta'];
  cleanup();
  vi.unstubAllGlobals();
});

/** An account whose settings really change, over the Hale family with Greta. */
function account(settings: Partial<AuthUser> = {}, extra: Record<string, MockRoute> = {}) {
  let user: AuthUser = { ...ADMIN, personId: 'marcus', ...settings };
  const patches: unknown[] = [];
  const routes = haleRoutes(user, {
    'GET /api/auth/me': () => ({ status: 200, body: { user, treeName: 'Hale Family' } }),
    'PATCH /api/auth/me': (init) => {
      const patch = JSON.parse(String(init.body)) as Partial<AuthUser>;
      patches.push(patch);
      user = { ...user, ...patch };
      return { status: 200, body: { user, treeName: 'Hale Family' } };
    },
    ...extra,
  });
  return { routes, patches };
}
const drawnCount = () => document.querySelectorAll('[data-node]').length;
const countText = (shown: number) => `${shown} of ${PEOPLE.length} people`;

describe('aunts, uncles and cousins in the Family tree', () => {
  it('are not asked for by default: the chart asks for the siblings and their families only', async () => {
    const fetchMock = mockApi(account().routes);
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(calls(fetchMock)).toContain('GET /api/tree/marcus?up=3&down=2&collateral=siblings');
    expect(calls(fetchMock)).not.toContain('GET /api/tree/marcus?up=3&down=2&collateral=true');
    expect(screen.queryByRole('button', { name: /^Greta Hale/ })).toBeNull();
    const without = treeFor('marcus', { collateral: 'siblings' }).people.length;
    expect(screen.getByText(countText(without))).toBeTruthy();
  });

  it('are drawn when the account shows them, and the counter counts them', async () => {
    const fetchMock = mockApi(account({ showExtendedRelatives: true }).routes);
    renderApp('/tree/marcus');
    expect(await screen.findByRole('button', { name: /^Greta Hale/ })).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/tree/marcus?up=3&down=2&collateral=true');
    expect(screen.getByText(countText(treeFor('marcus', { collateral: true }).people.length))).toBeTruthy();
    expect(treeFor('marcus', { collateral: true }).people.length).toBe(
      treeFor('marcus', { collateral: 'siblings' }).people.length + 1,
    );
  });

  it('are turned on in the gear, under Relatives, which starts open, with its helper text', async () => {
    const { routes, patches } = account();
    mockApi(routes);
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }));
    const panel = screen.getByRole('group', { name: 'Chart settings' });
    expect(
      within(panel)
        .getByRole('button', { name: /Relatives/ })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(
      within(panel).getByText('Off by default. Siblings, their partners, nieces and nephews are always shown.'),
    ).toBeTruthy();
    const toggle = within(panel).getByRole('switch', { name: 'Show aunts, uncles and cousins' }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const before = drawnCount();
    toggle.focus();
    fireEvent.click(toggle);
    await waitFor(() => expect(patches).toEqual([{ showExtendedRelatives: true }]));
    expect(await screen.findByRole('button', { name: /^Greta Hale/ })).toBeTruthy();
    expect(drawnCount()).toBe(before + 1);
    // The panel stayed open, on the same switch, and the chart did not blink to "Loading".
    expect(screen.getByRole('group', { name: 'Chart settings' })).toBe(panel);
    expect(document.activeElement).toBe(toggle);
    await waitFor(() =>
      expect(screen.getByText(countText(treeFor('marcus', { collateral: true }).people.length))).toBeTruthy(),
    );
    // And off again.
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Greta Hale/ })).toBeNull());
    expect(patches.at(-1)).toEqual({ showExtendedRelatives: false });
  });

  it('can still be found by search: choosing one who is not drawn makes them the root, selected', async () => {
    const lookup = {
      '/api/people?q=greta&limit=8': { status: 200, body: { items: [GRETA], nextCursor: null } },
    };
    mockApi(account({}, lookup).routes);
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const box = screen.getByRole('combobox', { name: 'Find someone in the tree' });
    fireEvent.change(box, { target: { value: 'greta' } });
    await screen.findByRole('option');
    fireEvent.keyDown(box, { key: 'Enter' });
    const panel = () => screen.getByRole('complementary', { name: 'Selected person' });
    await waitFor(() => expect(within(panel()).getByRole('heading', { level: 2 }).textContent).toBe('Greta Hale'));
  });

  it('are explained in the legend: one line, in the Family tree and in a family view, and not when they are shown', async () => {
    const line =
      'Aunts, uncles and cousins are hidden. Show them in the chart settings (gear), or search for them above.';
    mockApi(account().routes);
    const first = renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(screen.getByText(line)).toBeTruthy();
    // The new row's own words never point at the person panel.
    expect(screen.getByText(line).textContent).not.toMatch(/person panel/);
    first.unmount();
    // A family view never draws them, whatever the setting.
    mockApi(account({ showExtendedRelatives: true }).routes);
    const flipped = renderApp('/tree/marcus?of=priya');
    await screen.findByText('Priya’s family');
    expect(screen.getByText(line)).toBeTruthy();
    flipped.unmount();
    mockApi(account({ showExtendedRelatives: true }).routes);
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Greta Hale/ });
    expect(screen.queryByText(line)).toBeNull();
  });

  it('are not mentioned in the Pedigree, Fan and Descendants legends', async () => {
    for (const view of ['pedigree', 'fan', 'descendants']) {
      mockApi(account().routes);
      const r = renderApp(`/tree/marcus?view=${view}`);
      await screen.findByRole('button', { name: new RegExp(`Chart view`) });
      await waitFor(() => expect(screen.getAllByRole('group', { name: 'Legend' }).length).toBe(1));
      expect(screen.queryByText(/Aunts, uncles and cousins are hidden/)).toBeNull();
      r.unmount();
    }
  });
});
