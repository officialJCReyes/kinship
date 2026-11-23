// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "+" on a person's card opens the Add relative wizard for them (backlog 15): who gets one (the side panel's rule), that
// it is a real button with one tab stop per chart, that it neither selects, opens the panel nor starts a pan, and that it
// never sits on a line.
import type { AuthUser, TreeResponse } from '@kinship/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addableOnChart } from '../src/people/permissions.js';
import { layoutTree, NODE_H, NODE_W } from '../src/tree/layout.js';
import { layoutDescendants } from '../src/tree/descendantsLayout.js';
import { layoutPedigree } from '../src/tree/pedigreeLayout.js';
import { ADMIN, haleRoutes, MEMBER, READER, treeFor } from './family.js';
import { mockApi, renderApp } from './helpers.js';
import { bigFamily } from './layout-fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const nubs = () => Array.from(document.querySelectorAll<SVGGElement>('[data-add]'));
const nubOf = (id: string) => document.querySelector<SVGGElement>(`[data-add="${id}"]`);

describe('who gets the "+" (the side panel’s Add relative rule)', () => {
  const shown = treeFor('marcus', { up: 2, down: 2, collateral: true }) as TreeResponse;
  const withPlaceholder: TreeResponse = {
    ...shown,
    people: [...shown.people, { ...shown.people[0]!, id: 'unknown-father', isPlaceholder: true }],
  };

  it('admins: everyone on the chart but an unknown parent', () => {
    for (const role of ['superadmin', 'familyadmin'] as const) {
      const addable = addableOnChart({ ...ADMIN, role }, withPlaceholder);
      expect(addable.size).toBe(shown.people.length);
      expect(addable.has('unknown-father')).toBe(false);
    }
  });

  it('a Member: their own person and their descendants on the chart, nobody else', () => {
    // Daniel's children with Elena (Marcus, Sofia) and with Priya (Carla) are in his line; his parents, his partners and his
    // children's partners are not.
    const addable = addableOnChart({ ...MEMBER, personId: 'daniel' }, shown);
    for (const id of ['daniel', 'marcus', 'sofia', 'carla']) expect(addable.has(id), id).toBe(true);
    for (const id of ['walter', 'rosa', 'elena', 'priya', 'lena']) expect(addable.has(id), id).toBe(false);
    expect([...addableOnChart(MEMBER, shown)]).toEqual(['marcus']);
  });

  it('a Member linked to nobody, a User, and nobody signed in: none', () => {
    expect(addableOnChart({ ...MEMBER, personId: null } as AuthUser, shown).size).toBe(0);
    expect(addableOnChart(READER, shown).size).toBe(0);
    expect(addableOnChart(undefined, shown).size).toBe(0);
  });
});

describe('the "+" on the chart', () => {
  it('is a button named for the person, on every card for an admin, and opens Add relative for them', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(nubs().length).toBe(document.querySelectorAll('[data-node]').length);
    const plus = screen.getByRole('button', { name: 'Add a relative to Daniel Hale' });
    expect(plus.getAttribute('data-nopan')).not.toBeNull();
    const daniel = screen.getByRole('button', { name: /^Daniel Hale/ });
    const pressed = daniel.getAttribute('aria-pressed');
    fireEvent.click(plus, { clientX: 10, clientY: 10, detail: 1 });
    expect(await screen.findByRole('dialog', { name: 'Add relative to Daniel Hale' })).toBeTruthy();
    // It does not select, and a quick second press is not a double-click on the card.
    expect(daniel.getAttribute('aria-pressed')).toBe(pressed);
  });

  it('has one tab stop per chart: only the focused card’s "+" is focusable', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const marcus = await screen.findByRole('button', { name: /^Marcus Hale/ });
    const focusable = () => nubs().filter((n) => n.getAttribute('tabindex') === '0');
    expect(focusable().map((n) => n.getAttribute('data-add'))).toEqual(['marcus']);
    // Moving to another person moves it with the card.
    marcus.focus();
    fireEvent.keyDown(marcus, { key: 'ArrowUp' });
    await waitFor(() => expect(focusable()).toHaveLength(1));
    expect(focusable()[0]!.getAttribute('data-add')).not.toBe('marcus');
    const svg = document.querySelector('.tree-canvas svg')!;
    expect(svg.querySelectorAll('[tabindex="0"]')).toHaveLength(2);
  });

  it('works from the keyboard: Enter or Space on it opens the wizard', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    const plus = nubOf('marcus')!;
    plus.focus();
    fireEvent.keyDown(plus, { key: ' ' });
    expect(await screen.findByRole('dialog', { name: 'Add relative to Marcus Hale' })).toBeTruthy();
  });

  it('opens the wizard while the side panel is collapsed, and leaves it collapsed', async () => {
    window.localStorage.setItem('kinship.tree.panelCollapsed', '1');
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    fireEvent.click(nubOf('marcus')!);
    expect(await screen.findByRole('dialog', { name: 'Add relative to Marcus Hale' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open profile' })).toBeNull();
  });

  it('a Member gets it on their own card and their children’s, a User on none', async () => {
    mockApi(haleRoutes(MEMBER));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(
      nubs()
        .map((n) => n.getAttribute('data-add'))
        .sort(),
    ).toEqual(['leo', 'marcus', 'mia'].filter((id) => document.querySelector(`[data-node="${id}"]`)));
    expect(nubOf('daniel')).toBeNull();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    mockApi(haleRoutes(READER));
    renderApp('/tree/marcus');
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    expect(nubs()).toHaveLength(0);
  });

  it('is in Pedigree and Descendants, and not in the Fan (no room on a wedge)', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree');
    await screen.findByRole('button', { name: /^Daniel Hale/ });
    expect(nubOf('daniel')).not.toBeNull();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=fan');
    await screen.findByRole('button', { name: /^Daniel Hale/ });
    expect(nubs()).toHaveLength(0);
    expect(within(document.body).queryByRole('button', { name: /^Add a relative to/ })).toBeNull();
  });
});

describe('it never sits on a line', () => {
  /** Every straight piece of every line the Family tree draws, from its SVG path data (M, H and V only). */
  function segments(d: string): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    let x = 0;
    let y = 0;
    for (const [, cmd, rest] of d.matchAll(/([MHV])([^MHV]*)/g)) {
      const nums = rest!
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (cmd === 'M') [x, y] = [nums[0]!, nums[1]!];
      else if (cmd === 'H') out.push([x, y, (x = nums[0]!), y]);
      else out.push([x, y, x, (y = nums[0]!)]);
    }
    return out;
  }
  const distance = ([x0, y0, x1, y1]: [number, number, number, number], px: number, py: number) => {
    const cx = Math.max(Math.min(x0, x1), Math.min(px, Math.max(x0, x1)));
    const cy = Math.max(Math.min(y0, y1), Math.min(py, Math.max(y0, y1)));
    return Math.hypot(px - cx, py - cy);
  };

  it('keeps its touch area clear of every line, single parents’ drops and bracket couples included', () => {
    // The test family has single parents (Tomas under Priya alone); the big ones have wide sibling sets and bus lanes.
    const family = treeFor('marcus', { up: 2, down: 2, collateral: true });
    for (const input of [family, bigFamily(161), bigFamily(600)]) {
      const layout = layoutTree(input);
      const lines = [...layout.links.map((l) => l.d), ...layout.couples.map((c) => c.d)].flatMap(segments);
      // A drop from the middle of a card's bottom edge, as a single parent's and a bracket's are, is there to be avoided.
      if (input === family) {
        expect(lines.some(([x0, y0]) => layout.nodes.some((n) => x0 === n.x && y0 === n.y + NODE_H))).toBe(true);
      }
      for (const node of layout.nodes) {
        // The nub's centre: 28 px in from the right edge, on the bottom edge; its touch area is a 17 px radius.
        const nx = node.x - NODE_W / 2 + NODE_W - 28;
        const ny = node.y + NODE_H;
        for (const segment of lines) expect(distance(segment, nx, ny), node.id).toBeGreaterThan(17);
      }
    }
  });

  it('in Pedigree and Descendants too, whose lines meet the cards at their sides', () => {
    const up = treeFor('marcus', { up: 4, down: 0, collateral: false }) as TreeResponse;
    const down = treeFor('walter', { up: 0, down: 5, collateral: true }) as TreeResponse;
    for (const layout of [layoutPedigree(up, 'marcus', 4).layout, layoutDescendants(down, 'walter', 4).layout]) {
      const height = layout.nodeHeight ?? NODE_H;
      const lines = layout.links.map((l) => l.d).flatMap(segments);
      expect(lines.length).toBeGreaterThan(0);
      for (const node of layout.nodes) {
        const nx = node.x - NODE_W / 2 + NODE_W - 28;
        const ny = node.y + height;
        for (const segment of lines) expect(distance(segment, nx, ny), node.id).toBeGreaterThan(17);
      }
    }
  });
});
