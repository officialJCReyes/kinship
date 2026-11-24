// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A double-click (or double-tap) on a person opens the side panel even when it is collapsed, and Shift+Enter does the same
// from the keyboard (backlog 14). A single click keeps today's behaviour, and the remembered collapse choice is never
// changed. In the views that re-root on a click, the second click opens the panel for the FIRST click's person.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_MS, DOUBLE_SLOP, isSecondClick } from '../src/tree/doubleActivate.js';
import { ADMIN, haleRoutes } from './family.js';
import { mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const card = (name: RegExp) => screen.getByRole('button', { name });
/** A click from a real pointer: `detail` 1 and a position (a script's or a screen reader's click has `detail` 0). */
const at = (x: number, y: number) => ({ clientX: x, clientY: y, detail: 1 });
const panelOpen = () => screen.queryByRole('link', { name: 'Open profile' }) !== null;
const panelHeading = () =>
  within(screen.getByRole('complementary', { name: 'Selected person' })).queryByRole('heading', { level: 2 })
    ?.textContent;

/** The panel starts collapsed, as a viewer who collapsed it before would have it. */
function collapsed() {
  window.localStorage.setItem('kinship.tree.panelCollapsed', '1');
}

describe('telling a double-click from two clicks', () => {
  it('needs the second click within 400 ms and 10 px of the first, from the pointer (never the keyboard)', () => {
    const first = { id: 'a', at: 1000, x: 100, y: 100 };
    expect(DOUBLE_MS).toBe(400);
    expect(DOUBLE_SLOP).toBe(10);
    expect(isSecondClick(first, 1400, { x: 106, y: 108 })).toBe(true);
    expect(isSecondClick(first, 1401, { x: 100, y: 100 })).toBe(false);
    expect(isSecondClick(first, 1100, { x: 111, y: 100 })).toBe(false);
    expect(isSecondClick(first, 1100, undefined)).toBe(false);
    expect(isSecondClick(null, 1100, { x: 100, y: 100 })).toBe(false);
  });
});

describe('the Family tree', () => {
  it('a double-click opens the collapsed panel on that person, and leaves the remembered choice collapsed', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const daniel = await screen.findByRole('button', { name: /^Daniel Hale/ });
    expect(panelOpen()).toBe(false);
    fireEvent.click(daniel, at(200, 150));
    // A single click selects, as today, and the panel stays as it was.
    expect(daniel.getAttribute('aria-pressed')).toBe('true');
    expect(panelOpen()).toBe(false);
    fireEvent.click(card(/^Daniel Hale/), at(202, 151));
    await waitFor(() => expect(panelOpen()).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Daniel Hale', level: 2 })).toBeTruthy();
    expect(window.localStorage.getItem('kinship.tree.panelCollapsed')).toBe('1');
  });

  it('two clicks far apart, or slowly, are two single clicks', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const daniel = await screen.findByRole('button', { name: /^Daniel Hale/ });
    fireEvent.click(daniel, at(200, 150));
    fireEvent.click(card(/^Daniel Hale/), at(230, 150));
    expect(panelOpen()).toBe(false);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(10_000);
    fireEvent.click(card(/^Daniel Hale/), at(200, 150));
    now.mockReturnValue(10_000 + DOUBLE_MS + 1);
    fireEvent.click(card(/^Daniel Hale/), at(200, 150));
    expect(panelOpen()).toBe(false);
  });

  it('a click from assistive technology or a script (detail 0) is never half of a double-click', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const daniel = await screen.findByRole('button', { name: /^Daniel Hale/ });
    fireEvent.click(daniel, { clientX: 0, clientY: 0, detail: 0 });
    fireEvent.click(card(/^Daniel Hale/), { clientX: 0, clientY: 0, detail: 0 });
    expect(panelOpen()).toBe(false);
  });

  it('two quick clicks on two people are two selections, even at the same spot', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }), at(200, 150));
    fireEvent.click(card(/^Walter Hale/), at(200, 150));
    expect(card(/^Walter Hale/).getAttribute('aria-pressed')).toBe('true');
    expect(panelOpen()).toBe(false);
  });

  it('Shift+Enter selects the focused person and opens the panel; Enter alone only selects', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const daniel = await screen.findByRole('button', { name: /^Daniel Hale/ });
    daniel.focus();
    fireEvent.keyDown(daniel, { key: 'Enter' });
    expect(daniel.getAttribute('aria-pressed')).toBe('true');
    expect(panelOpen()).toBe(false);
    const walter = card(/^Walter Hale/);
    walter.focus();
    fireEvent.keyDown(walter, { key: 'Enter', shiftKey: true });
    await waitFor(() => expect(panelOpen()).toBe(true));
    expect(await screen.findByRole('heading', { name: /^Walter Hale/, level: 2 })).toBeTruthy();
    expect(window.localStorage.getItem('kinship.tree.panelCollapsed')).toBe('1');
  });

  it('an open panel stays open, and a double-click does not close it', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus');
    const daniel = await screen.findByRole('button', { name: /^Daniel Hale/ });
    fireEvent.click(daniel, at(200, 150));
    fireEvent.click(card(/^Daniel Hale/), at(200, 150));
    expect(await screen.findByRole('heading', { name: 'Daniel Hale', level: 2 })).toBeTruthy();
    expect(window.localStorage.getItem('kinship.tree.panelCollapsed')).toBeNull();
  });
});

describe('the views that re-root on a click (Pedigree, Descendants, Fan)', () => {
  it('a double-click re-roots on the person and opens the panel for them', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }), at(300, 200));
    fireEvent.click(card(/^Daniel Hale/), at(300, 200));
    await waitFor(() => expect(panelOpen()).toBe(true));
    await waitFor(() => expect(panelHeading()).toBe('Daniel Hale'));
  });

  it('after a re-root, a second quick click on the same spot opens the FIRST person, not the card that moved under it', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }), at(300, 200));
    // The chart is now about Daniel: his father Walter is drawn, perhaps under the pointer.
    const walter = await screen.findByRole('button', { name: /^Walter Hale/ });
    fireEvent.click(walter, at(303, 204));
    await waitFor(() => expect(panelOpen()).toBe(true));
    await waitFor(() => expect(panelHeading()).toBe('Daniel Hale'));
    expect(card(/^Walter Hale/).getAttribute('aria-pressed')).toBe('false');
  });

  it('after a re-root, a quick click elsewhere on another card is a single click: it re-roots there and opens nothing', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=pedigree');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }), at(300, 200));
    const walter = await screen.findByRole('button', { name: /^Walter Hale/ });
    fireEvent.click(walter, at(520, 90));
    await waitFor(() => expect(card(/^Walter Hale/).getAttribute('aria-pressed')).toBe('true'));
    expect(panelOpen()).toBe(false);
  });

  it('the Fan: a double-click on a wedge opens the panel too', async () => {
    collapsed();
    mockApi(haleRoutes(ADMIN));
    renderApp('/tree/marcus?view=fan');
    fireEvent.click(await screen.findByRole('button', { name: /^Daniel Hale/ }), at(400, 300));
    fireEvent.click(card(/^Daniel Hale/), at(401, 300));
    await waitFor(() => expect(panelOpen()).toBe(true));
    await waitFor(() => expect(panelHeading()).toBe('Daniel Hale'));
  });
});
