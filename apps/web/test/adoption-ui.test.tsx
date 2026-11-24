// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AuthUser, LineageView } from '@kinship/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, MEMBER, PEOPLE, READER, treeFor } from './family.js';
import { calls, mockApi, ME, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';
import { layoutTree } from '../src/tree/layout.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** Routes where changing the viewer's setting really changes what /api/auth/me and the tree answer. */
function withSwitch(me: AuthUser): Record<string, MockRoute> {
  let view: LineageView = me.lineageView;
  const current = () => ({ ...me, lineageView: view });
  const base = haleRoutes(me);
  const tree = base['GET /api/tree/*'] as (init: RequestInit, path: string) => { status: number; body: unknown };
  return {
    ...base,
    '/api/auth/me': () => ({ status: 200, body: { ...ME, user: current() } }),
    'PATCH /api/auth/me': (init) => {
      view = (JSON.parse(String(init.body)) as { lineageView: LineageView }).lineageView;
      return { status: 200, body: { ...ME, user: current() } };
    },
    'GET /api/tree/*': (init, path) => {
      const url = new URL(path, 'http://x');
      if (!url.searchParams.has('lineage')) url.searchParams.set('lineage', view);
      return tree(init, `${url.pathname}${url.search}`);
    },
  };
}

describe('the profile of an adopted person', () => {
  it('lists both families with their labels, the year of the adoption, and the banner', async () => {
    mockApi(haleRoutes(READER));
    renderApp('/people/samuel');
    await screen.findByRole('heading', { name: 'Samuel Hale', level: 1 });
    const parents = screen.getByRole('heading', { name: 'Parents', level: 2 }).closest('section')!;
    expect(await within(parents).findByRole('heading', { name: 'Adoptive family' })).toBeTruthy();
    expect(within(parents).getByRole('heading', { name: 'Birth family' })).toBeTruthy();
    expect(within(parents).getByRole('link', { name: /Joseph Hale.*Adoptive father/ })).toBeTruthy();
    expect(within(parents).getByRole('link', { name: /Anna Hale.*Adoptive mother/ })).toBeTruthy();
    expect(within(parents).getByRole('link', { name: /Frank Doyle.*Birth father/ })).toBeTruthy();
    expect(within(parents).getByRole('link', { name: /Ruth Doyle.*Birth mother/ })).toBeTruthy();
    expect(within(parents).getByText(/1938/)).toBeTruthy();
    expect(screen.getByText(/The charts follow Samuel’s adoptive family/)).toBeTruthy();
    expect(screen.getByText(/does not change what anyone else sees/)).toBeTruthy();
    // A reader cannot add or remove anything here.
    expect(screen.queryByRole('button', { name: /Remove Frank/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit link date' })).toBeNull();
  });

  it('shows no banner for a person with only a birth set', async () => {
    mockApi(haleRoutes(READER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale', level: 1 });
    expect(screen.queryByText(/The charts follow/)).toBeNull();
  });

  it('switches the viewer’s own family with the button on the banner', async () => {
    const fetchMock = mockApi(withSwitch(READER));
    renderApp('/people/samuel');
    expect(await screen.findByText(/The charts follow Samuel’s adoptive family/)).toBeTruthy();
    click('Show birth families');
    expect(await screen.findByText(/The charts follow Samuel’s birth family/)).toBeTruthy();
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[0])).toBe('/api/auth/me');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ lineageView: 'birth' });
    expect(screen.getByRole('button', { name: 'Show adoptive families' })).toBeTruthy();
  });

  it('labels the children on a parent’s profile: adopted, and birth children who were adopted away', async () => {
    mockApi(haleRoutes(READER));
    const first = renderApp('/people/joseph');
    expect(await screen.findByRole('link', { name: /Samuel Hale.*Adopted son, 1938/ })).toBeTruthy();
    first.unmount();
    renderApp('/people/frank');
    expect(await screen.findByRole('link', { name: /Samuel Hale.*Birth son/ })).toBeTruthy();
  });

  it('lets an admin remove a parent from one family and change the date of the link', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'PATCH /api/people/samuel/parents/adoptive': {
          status: 200,
          body: { parentage: { unionId: 'u5', parentId: null, kind: 'adoptive', link: null }, warnings: [] },
        },
      }),
    );
    renderApp('/people/samuel');
    expect(await screen.findByRole('button', { name: 'Remove Frank Doyle as parent' })).toBeTruthy();
    click('Edit link date');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Date of the adoption (the year is enough)'), {
      target: { value: '1939' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('PATCH /api/people/samuel/parents/adoptive'));
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ link: { value: '1939', precision: 'exactly' } });
  });
});

describe('Add relative and the type of link', () => {
  it('gives an admin a Birth or Adoptive choice and a date for an adoption, and sends the kind', async () => {
    const fetchMock = mockApi(
      haleRoutes(ADMIN, {
        'POST /api/people/ben/parents': {
          status: 201,
          body: {
            parentage: { unionId: null, parentId: 'x', kind: 'adoptive', link: null },
            warnings: [],
            person: { ...PEOPLE[3]!, id: 'newmom' },
          },
        },
      }),
    );
    renderApp('/people/ben');
    await screen.findByRole('heading', { name: 'Ben Hale', level: 1 });
    click('Add relative');
    click('Add mother');
    const dialog = await screen.findByRole('dialog');
    const group = within(dialog).getByRole('group', { name: 'Type of parent-child link' });
    expect((within(group).getByRole('radio', { name: 'Birth' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'Adoptive' }));
    fireEvent.change(within(dialog).getByLabelText('Given (and middle) name'), { target: { value: 'Mina' } });
    fireEvent.change(within(dialog).getByLabelText('Surname'), { target: { value: 'Hale' } });
    fireEvent.change(within(dialog).getByLabelText('Date of the adoption (the year is enough)'), {
      target: { value: '2001' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/people/ben/parents'));
    const call = fetchMock.mock.calls.find(([input]) => String(input) === '/api/people/ben/parents');
    // The new parent goes in the same call (ADR 0039).
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      parent: { givenName: 'Mina', surname: 'Hale' },
      kind: 'adoptive',
      link: { value: '2001', precision: 'exactly' },
    });
  });

  it('disables a kind that cannot take another parent', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/samuel');
    await screen.findByRole('heading', { name: 'Samuel Hale', level: 1 });
    click('Add relative');
    click('Add brother');
    const dialog = await screen.findByRole('dialog');
    const group = within(dialog).getByRole('group', { name: 'Type of parent-child link' });
    // Samuel has both sets, so both are available; a brother follows the birth set unless only the adoptive one exists.
    expect((within(group).getByRole('radio', { name: 'Birth' }) as HTMLInputElement).checked).toBe(true);
    expect((within(group).getByRole('radio', { name: 'Adoptive' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('shows a Member no choice of link type', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/people/marcus');
    await screen.findByRole('heading', { name: 'Marcus Hale', level: 1 });
    click('Add relative');
    click('Add son');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Type of parent-child link')).toBeNull();
  });
});

describe('the chart for an adopted person', () => {
  it('follows the adoptive family, with a leaf on the left that opens the birth family', async () => {
    const fetchMock = mockApi(haleRoutes(READER));
    renderApp('/tree/samuel');
    await screen.findByRole('button', { name: /^Samuel Hale/ });
    expect(screen.getByRole('button', { name: /^Joseph Hale/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Frank Doyle/ })).toBeNull();
    const leaf = document.querySelector('[data-leaf-other="samuel"]')!;
    expect(leaf.getAttribute('aria-label')).toBe('Show Samuel’s birth family (2 people)');
    fireEvent.click(leaf);
    expect(await screen.findByRole('button', { name: /^Frank Doyle/ })).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/tree/samuel?up=3&down=1&collateral=true&lineage=birth');
    expect(await screen.findByText('Samuel’s birth family')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Joseph Hale/ })).toBeNull();
    // The whole flip follows birth: the leaf on Samuel now opens the adoptive family, which is the main chart.
    fireEvent.click(document.querySelector('[data-leaf-other="samuel"]')!);
    await waitFor(() => expect(screen.queryByText('Samuel’s birth family')).toBeNull());
    expect(await screen.findByRole('button', { name: /^Joseph Hale/ })).toBeTruthy();
  });

  it('follows the birth family when the viewer chose it, and the leaf then opens the adoptive family', async () => {
    mockApi(haleRoutes({ ...READER, lineageView: 'birth' }));
    renderApp('/tree/samuel');
    await screen.findByRole('button', { name: /^Samuel Hale/ });
    expect(screen.getByRole('button', { name: /^Frank Doyle/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Joseph Hale/ })).toBeNull();
    expect(document.querySelector('[data-leaf-other="samuel"]')?.getAttribute('aria-label')).toBe(
      'Show Samuel’s adoptive family (2 people)',
    );
  });

  it('has a button in the person panel, with the count in its name, as the keyboard path', async () => {
    const fetchMock = mockApi(haleRoutes(READER));
    renderApp('/tree/samuel');
    const panel = await screen.findByRole('complementary', { name: 'Selected person' });
    const button = await within(panel).findByRole('button', { name: 'Show Samuel’s birth family (2 people)' });
    expect(button.textContent).toBe('Show birth family');
    fireEvent.click(button);
    expect(await screen.findByText('Samuel’s birth family')).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/tree/samuel?up=3&down=1&collateral=true&lineage=birth');
    // No panel button for a person with one family.
    fireEvent.click(await screen.findByRole('button', { name: /^Frank Doyle/ }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('complementary', { name: 'Selected person' })).queryByRole('button', {
          name: /family \(/,
        }),
      ).toBeNull(),
    );
  });

  it('makes the second leaf focusable by keyboard: up from a person with no drawn parents’ other family', async () => {
    mockApi(haleRoutes(READER));
    renderApp('/tree/samuel?sel=samuel');
    const node = await screen.findByRole('button', { name: /^Samuel Hale/ });
    node.focus();
    // Samuel's adoptive parents are drawn, so Up goes to a parent, not a leaf.
    fireEvent.keyDown(node, { key: 'ArrowUp' });
    expect(['joseph', 'anna']).toContain(document.activeElement?.getAttribute('data-node'));
    // The leaf is a button in the page and Enter on it opens the family.
    const leaf = document.querySelector<SVGElement>('[data-leaf-other="samuel"]')!;
    leaf.focus();
    fireEvent.keyDown(leaf, { key: 'Enter' });
    expect(await screen.findByText('Samuel’s birth family')).toBeTruthy();
  });

  it('explains the second leaf in the legend', async () => {
    mockApi(haleRoutes(READER));
    renderApp('/tree/samuel');
    expect(await screen.findByText(/Second leaf, on the left/)).toBeTruthy();
  });

  it('keeps an adopted person’s parents where they are drawn: centred under the adoptive couple', async () => {
    for (const lineage of ['adoptive', 'birth'] as const) {
      const tree = treeFor('samuel', { up: 3, down: 2, collateral: true, lineage });
      const layout = layoutTree({ ...tree, people: tree.people });
      const parents = lineage === 'adoptive' ? ['joseph', 'anna'] : ['frank', 'ruth'];
      const samuel = layout.byId.get('samuel')!;
      const [a, b] = parents.map((id) => layout.byId.get(id)!);
      expect(samuel.row).toBe(a!.row + 1);
      expect(Math.abs(samuel.x - (a!.x + b!.x) / 2)).toBeLessThan(1);
      // The other family is not drawn at all.
      const others = lineage === 'adoptive' ? ['frank', 'ruth'] : ['joseph', 'anna'];
      for (const id of others) expect(layout.byId.has(id)).toBe(false);
    }
  });
});
