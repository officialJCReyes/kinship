// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes, MEMBER, READER, treeFor } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const node = (name: RegExp | string) => screen.getByRole('button', { name });

describe('the fixture follows the API rules', () => {
  it('stops at the generation limits and gives a leaf only to a cut-off person', () => {
    const tree = treeFor('marcus', { up: 1, down: 0, collateral: false });
    const ids = tree.people.map((p) => p.id).sort();
    // Priya is Daniel's ex-partner, drawn as a partner; her own son Tomas comes with her (one hop)
    expect(ids).toEqual(['daniel', 'elena', 'marcus', 'priya', 'tomas']);
    expect(tree.parentage['tomas']).toMatchObject({ unionId: null, parentId: 'priya' });
    // Daniel's parents are beyond the limit: no parentage, hasParents, and a count.
    const daniel = tree.people.find((p) => p.id === 'daniel')!;
    expect(daniel.hasParents).toBe(true);
    expect(tree.parentage['daniel']).toBeUndefined();
    expect(daniel.ancestorCount).toBe(2);
    // Only unions with both partners drawn.
    expect(tree.unions.map((u) => u.id)).toEqual(['u1', 'u2']);
  });
});

describe('the chart', () => {
  it("draws a partner's own child hanging from the partner alone (Tomas under Priya)", async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    expect(await screen.findByRole('button', { name: /^Tomas Nair/ })).toBeTruthy();
  });

  it('draws everyone with an accessible name, solid and dotted lines, and one leaf for the in-law', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    expect(await screen.findByRole('button', { name: 'Marcus Hale, born 1988, male' })).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/tree/marcus?up=3&down=2&collateral=true');
    expect(node('Walter Hale, born 1930, died 2005, male')).toBeTruthy();
    expect(node('Lena Okafor, born 1989, other')).toBeTruthy();

    const lines = Array.from(document.querySelectorAll('.couple')).map((c) => [
      c.getAttribute('data-union'),
      c.querySelector('.line')!.getAttribute('data-line'),
    ]);
    expect(Object.fromEntries(lines)).toMatchObject({ u0: 'solid', u1: 'solid', u2: 'dotted', u4: 'solid' });
    // the leaf: only Lena (parents not drawn); Marcus and Daniel have theirs drawn
    const leaves = screen.getAllByRole('button', { name: /^Show .* family/ });
    expect(leaves.map((l) => l.getAttribute('aria-label'))).toEqual(['Show Lena’s family (3 people)']);
  });

  it('selects a person by click and shows them in the panel with their partners', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }));
    const panel = screen.getByRole('complementary', { name: 'Selected person' });
    expect(await within(panel).findByRole('heading', { name: 'Daniel Hale' })).toBeTruthy();
    expect(within(panel).getByText('Living')).toBeTruthy();
    expect(await within(panel).findByText(/Elena Ruiz/)).toBeTruthy();
    expect(within(panel).getAllByRole('button', { name: 'Edit relationship' })).toHaveLength(2);
    expect(within(panel).getByRole('link', { name: 'Open profile' })).toBeTruthy();
    expect(node(/^Daniel Hale/).getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the relationship dialog from a couple line for an admin, and does nothing for a reader', async () => {
    mockApi(haleRoutes(ADMIN));
    const first = renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    fireEvent.click(document.querySelector('[data-union="u1"] .hit')!);
    expect(await screen.findByRole('dialog', { name: 'Relationship: Daniel Hale and Elena Ruiz' })).toBeTruthy();
    first.unmount();

    mockApi(haleRoutes(READER));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(document.querySelector('[data-union="u1"] .hit')!.classList.contains('editable')).toBe(false);
    fireEvent.click(document.querySelector('[data-union="u1"] .hit')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    // the tooltip carries the status and both names
    expect(document.querySelector('[data-union="u1"] title')!.textContent).toBe('Married: Elena Ruiz and Daniel Hale');
  });

  it('flips to an in-law’s family with the leaf, and back with the leaf on the partner', async () => {
    const fetchMock = mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    fireEvent.click(await screen.findByRole('button', { name: 'Show Lena’s family (3 people)' }));
    expect(await screen.findByRole('button', { name: /^Femi Okafor/ })).toBeTruthy();
    expect(await screen.findByText('Lena’s family')).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/tree/lena?up=3&down=1&collateral=true');
    // Lena's ancestors, her partner Sofia, but not Marcus (Sofia's brother) or the other Hales
    expect(screen.getByRole('button', { name: /^Femi Okafor/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ade Okafor/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Sofia Hale/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Marcus Hale/ })).toBeNull();
    // Sofia's parents are on the main chart, so her leaf goes back.
    fireEvent.click(screen.getByRole('button', { name: /^Show Sofia’s family/ }));
    await waitFor(() => expect(screen.queryByText('Lena’s family')).toBeNull());
    expect(await screen.findByRole('button', { name: /^Marcus Hale/ })).toBeTruthy();
  });

  it('drops half-siblings in a family view', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?of=marcus');
    expect(await screen.findByRole('button', { name: /^Sofia Hale/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Carla Nair/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Ben Hale/ })).toBeNull();
    // but the main chart draws them
  });

  it('draws half-siblings on the main chart', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    expect(await screen.findByRole('button', { name: /^Carla Nair/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ben Hale/ })).toBeTruthy();
  });

  it('moves with the keyboard: one tab stop, arrows along the row, up to a parent, down to a child', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const stops = Array.from(document.querySelectorAll('[data-node]')).filter(
      (e) => e.getAttribute('tabindex') === '0',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]!.getAttribute('data-node')).toBe('marcus');

    const marcus = node(/^Marcus Hale/);
    marcus.focus();
    fireEvent.keyDown(marcus, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-node')).toBeTruthy();
    expect(document.activeElement).not.toBe(marcus);
    marcus.focus();
    fireEvent.keyDown(marcus, { key: 'ArrowUp' });
    expect(['daniel', 'elena']).toContain(document.activeElement?.getAttribute('data-node'));
    const parent = document.activeElement!;
    fireEvent.keyDown(parent, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-node')).toBeTruthy();
    // Enter selects, and a live region says so
    const lena = node(/^Lena Okafor/);
    lena.focus();
    fireEvent.keyDown(lena, { key: 'Enter' });
    await waitFor(() => expect(lena.getAttribute('aria-pressed')).toBe('true'));
    // The chart's own live region (the page's message region is a second status, and is empty here).
    expect(document.querySelector('.tree-canvas [role="status"]')?.textContent).toContain('Selected: Lena Okafor');
    // up from a person with a leaf goes to the leaf, and Enter on it flips
    fireEvent.keyDown(lena, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('data-leaf')).toBe('lena');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(await screen.findByText('Lena’s family')).toBeTruthy();
  });

  it('has zoom, zoom out and fit buttons that are not part of the pan', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const group = document.querySelector('.nodes')!.parentElement!;
    const before = group.getAttribute('transform');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(group.getAttribute('transform')).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Fit the whole chart' }));
    expect(group.getAttribute('transform')).toBe(before);
  });

  it('pans by moving one transform only, and a click after a drag is not a selection', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const svg = document.querySelector('.tree-canvas > svg')!;
    const group = svg.firstElementChild!;
    const before = group.getAttribute('transform')!;
    const rendered = document.querySelectorAll('[data-node]').length;
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: 60, clientY: 40 });
    expect(group.getAttribute('transform')).not.toBe(before);
    expect(document.querySelectorAll('[data-node]')).toHaveLength(rendered);
  });

  it('does not start a pan from a leaf press', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const leaf = await screen.findByRole('button', { name: /^Show Lena/ });
    const group = document.querySelector('.tree-canvas > svg')!.firstElementChild!;
    const before = group.getAttribute('transform');
    fireEvent.pointerDown(leaf, { pointerId: 2, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(leaf, { pointerId: 2, clientX: 90, clientY: 90 });
    expect(group.getAttribute('transform')).toBe(before);
  });

  it('collapses the panel to a rail and remembers it', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the person panel' }));
    expect(screen.queryByRole('link', { name: 'Open profile' })).toBeNull();
    expect(document.querySelector('.rail-initials')!.textContent).toBe('MH');
    expect(window.localStorage.getItem('kinship.tree.panelCollapsed')).toBe('1');
  });

  it('shows a legend', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const legend = await screen.findByRole('group', { name: 'Legend' });
    expect(legend.textContent).toContain('Someone not on the chart? Search for them above');
    expect(legend.textContent).not.toMatch(/not drawn/i);
  });
});

describe('where the chart starts', () => {
  it('sends a linked account to their own person, and offers Center on me from another root', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/tree');
    expect(await screen.findByRole('button', { name: /^Marcus Hale/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Center on me' })).toBeNull();
  });

  it('shows Center on me when the root is somebody else, and goes back to my person', async () => {
    const fetchMock = mockApi(haleRoutes(MEMBER));
    renderApp('/tree/daniel');
    fireEvent.click(await screen.findByRole('button', { name: 'Center on me' }));
    await waitFor(() => expect(calls(fetchMock)).toContain('GET /api/tree/marcus?up=3&down=2&collateral=true'));
  });

  it('asks an unlinked account who to start from, with the person picker', async () => {
    mockApi(
      haleRoutes(READER, { '/api/people?q=daniel&limit=8': { status: 200, body: { items: [], nextCursor: null } } }),
    );
    renderApp('/tree');
    expect(await screen.findByRole('heading', { name: 'Choose who to start from' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the tree' }).hasAttribute('disabled')).toBe(true);
  });

  it('remembers the last root for an unlinked account', async () => {
    mockApi(haleRoutes(READER));
    const first = renderApp('/tree/daniel');
    await screen.findByRole('button', { name: /^Daniel Hale/ });
    expect(window.localStorage.getItem('kinship.tree.root')).toBe('daniel');
    first.unmount();
    renderApp('/tree');
    expect(await screen.findByRole('button', { name: /^Daniel Hale/ })).toBeTruthy();
  });

  it('works when storage is blocked', async () => {
    mockApi(haleRoutes(READER));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderApp('/tree/daniel');
    expect(await screen.findByRole('button', { name: /^Daniel Hale/ })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('says so when the person is not found', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/nobody');
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('adds a Family tree link to the navigation', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/about');
    expect(await screen.findByRole('link', { name: 'Family tree' })).toBeTruthy();
  });
});
