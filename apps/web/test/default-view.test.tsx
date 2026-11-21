// SPDX-License-Identifier: AGPL-3.0-or-later
// The chart that opens first (ADR 0027): used where a chart opens fresh (the Tree tab), never to reinterpret an address.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AuthUser } from '@kinship/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN, haleRoutes } from './family.js';
import { mockApi, renderApp } from './helpers.js';
import { entryAddress } from '../src/tree/treeView.js';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const linked = (treeDefaultView: AuthUser['treeDefaultView']): AuthUser => ({
  ...ADMIN,
  personId: 'marcus',
  treeDefaultView,
});
const switcher = (name: string) => screen.findByRole('button', { name: `Chart view: ${name}` });

describe('entryAddress', () => {
  it('is the Family tree address for the Family tree, and names the view (with the default generations left out) otherwise', () => {
    expect(entryAddress('p1', 'family')).toBe('/tree/p1');
    expect(entryAddress('p1', undefined)).toBe('/tree/p1');
    expect(entryAddress('p1', 'pedigree')).toBe('/tree/p1?view=pedigree');
    expect(entryAddress('p1', 'fan')).toBe('/tree/p1?view=fan');
    expect(entryAddress('p1', 'descendants')).toBe('/tree/p1?view=descendants');
  });
});

describe('the Tree tab opens the chart the account chose', () => {
  it.each([
    ['family', 'Family tree'],
    ['pedigree', 'Pedigree'],
    ['fan', 'Fan'],
    ['descendants', 'Descendants'],
  ] as const)('%s', async (choice, name) => {
    mockApi(haleRoutes(linked(choice)));
    renderApp('/tree');
    expect(await switcher(name)).toBeTruthy();
  });

  it('uses the last person for an account linked to nobody, in the chosen view', async () => {
    window.localStorage.setItem('kinship.tree.root', 'daniel');
    mockApi(haleRoutes({ ...ADMIN, treeDefaultView: 'fan' }));
    renderApp('/tree');
    expect(await switcher('Fan')).toBeTruthy();
  });
});

describe('an address is never reinterpreted', () => {
  it('a bare /tree/:id is the Family tree, whatever the account chose', async () => {
    mockApi(haleRoutes(linked('pedigree')));
    renderApp('/tree/marcus');
    expect(await switcher('Family tree')).toBeTruthy();
  });

  it('an address that names a view keeps it', async () => {
    mockApi(haleRoutes(linked('pedigree')));
    renderApp('/tree/marcus?view=fan');
    expect(await switcher('Fan')).toBeTruthy();
  });

  it('a family view (of) and a selection (sel) stay in the Family tree', async () => {
    mockApi(haleRoutes(linked('descendants')));
    renderApp('/tree/marcus?of=priya');
    expect(await switcher('Family tree')).toBeTruthy();
    cleanup();
    mockApi(haleRoutes(linked('descendants')));
    renderApp('/tree/marcus?sel=sofia');
    expect(await switcher('Family tree')).toBeTruthy();
  });

  it('Center on me keeps the view the chart is in', async () => {
    mockApi(haleRoutes(linked('fan')));
    renderApp('/tree/daniel?view=pedigree');
    expect(await switcher('Pedigree')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Center on me' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Marcus Hale/ }).length).toBeGreaterThan(0));
    expect(await switcher('Pedigree')).toBeTruthy();
  });
});

describe('the gear', () => {
  it('has "Chart that opens first" in Navigation, with its helper, and sends only that setting', async () => {
    let user = linked('family');
    const patches: unknown[] = [];
    mockApi(
      haleRoutes(user, {
        'GET /api/auth/me': () => ({ status: 200, body: { user, treeName: 'Hale Family' } }),
        'PATCH /api/auth/me': (init) => {
          const patch = JSON.parse(String(init.body)) as Partial<AuthUser>;
          patches.push(patch);
          user = { ...user, ...patch };
          return { status: 200, body: { user, treeName: 'Hale Family' } };
        },
      }),
    );
    renderApp('/tree/marcus');
    fireEvent.click(await screen.findByRole('button', { name: 'Chart settings' }));
    const panel = screen.getByRole('group', { name: 'Chart settings' });
    const select = within(panel).getByLabelText('Chart that opens first') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Family tree', 'Pedigree', 'Fan', 'Descendants']);
    expect(select.value).toBe('family');
    expect(
      within(panel).getByText(
        'Used when you open the tree from the menu or after signing in. A link that names a view always wins.',
      ),
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: 'fan' } });
    await waitFor(() => expect(patches).toEqual([{ treeDefaultView: 'fan' }]));
    // The chart on screen does not change: only where the Tree tab goes next time.
    expect(screen.getByRole('button', { name: 'Chart view: Family tree' })).toBeTruthy();
  });
});
