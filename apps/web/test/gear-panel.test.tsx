// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '@kinship/shared';
import { ADMIN, haleRoutes } from './family.js';
import { mockApi, renderApp } from './helpers.js';
import type { MockRoute } from './helpers.js';

afterEach(cleanup);

/** An account whose settings really change: a PATCH merges into what GET /api/auth/me answers next. */
function account(extra: Record<string, MockRoute> = {}, failPatch = false) {
  let user: AuthUser = { ...ADMIN };
  const body: unknown[] = [];
  const routes = haleRoutes(ADMIN, {
    'GET /api/auth/me': () => ({ status: 200, body: { user, treeName: 'Hale Family' } }),
    'PATCH /api/auth/me': (init) => {
      const patch = JSON.parse(String(init.body)) as Partial<AuthUser>;
      body.push(patch);
      if (failPatch) return { status: 500, body: { error: 'internal_error' } };
      user = { ...user, ...patch };
      return { status: 200, body: { user, treeName: 'Hale Family' } };
    },
    ...extra,
  });
  return { routes, patches: body };
}

async function openGear() {
  const gear = await screen.findByRole('button', { name: 'Chart settings' });
  fireEvent.click(gear);
  return { gear, panel: screen.getByRole('group', { name: 'Chart settings' }) };
}

describe('the chart settings (gear)', () => {
  it('is one button named "Chart settings", closed at first, next to the view switcher', async () => {
    mockApi(account().routes);
    renderApp('/tree/marcus');
    const gear = await screen.findByRole('button', { name: 'Chart settings' });
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Chart settings' })).toBeNull();
    expect(gear.parentElement?.parentElement?.contains(screen.getByRole('button', { name: /^Chart view:/ }))).toBe(
      true,
    );
    fireEvent.click(gear);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    // Focus goes into the panel, on the first group.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Cards/ }));
  });

  it('has the groups Cards and Names as disclosure buttons, collapsed at first', async () => {
    mockApi(account().routes);
    renderApp('/tree/marcus');
    const { panel } = await openGear();
    for (const name of ['Cards', 'Names']) {
      const toggle = within(panel).getByRole('button', { name: new RegExp(name) });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    }
    fireEvent.click(within(panel).getByRole('button', { name: /Cards/ }));
    expect(within(panel).getByRole('button', { name: /Cards/ }).getAttribute('aria-expanded')).toBe('true');
    expect(within(panel).getByRole('switch', { name: 'Show † on people who have died' })).toBeTruthy();
  });

  it('turns the † off and on: one PATCH with only that setting, drawn at once, with a polite status', async () => {
    const { routes, patches } = account();
    mockApi(routes);
    renderApp('/tree/marcus');
    const { panel } = await openGear();
    // Walter Hale (1930 to 2005) is on Marcus's chart.
    await screen.findByRole('button', { name: /^Walter Hale/ });
    const card = () => document.querySelector('[data-node="walter"] .name')?.textContent ?? '';
    expect(card()).toContain('†');
    fireEvent.click(within(panel).getByRole('button', { name: /Cards/ }));
    const mark = within(panel).getByRole('switch', { name: 'Show † on people who have died' }) as HTMLInputElement;
    expect(mark.checked).toBe(true);
    fireEvent.click(mark);
    await waitFor(() => expect(patches).toEqual([{ showDeceasedMark: false }]));
    await waitFor(() => expect(card()).not.toContain('†'));
    await waitFor(() => expect(within(panel).getByRole('status').textContent).toBe('Saved.'));
    // The legend does not explain a mark that is not drawn.
    expect(screen.queryByText('Deceased')).toBeNull();
    fireEvent.click(mark);
    await waitFor(() => expect(card()).toContain('†'));
    expect(screen.getByText('Deceased')).toBeTruthy();
  });

  it('changes a name setting without remounting the chart: the panel stays open, the focus stays, the view stays', async () => {
    const { routes, patches } = account();
    mockApi(routes);
    renderApp('/tree/marcus');
    const { gear, panel } = await openGear();
    await screen.findByRole('button', { name: /^Marcus Hale/ });
    fireEvent.click(within(panel).getByRole('button', { name: /Names/ }));
    const svg = document.querySelector('.tree-canvas > svg')!;
    const group = svg.firstElementChild!;
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(group.getAttribute('transform')).not.toBe(''));
    const transform = group.getAttribute('transform');
    const radio = within(panel).getByRole('radio', { name: 'Maiden name' }) as HTMLInputElement;
    radio.focus();
    fireEvent.click(radio);
    await waitFor(() => expect(patches).toEqual([{ nameForm: 'maiden' }]));
    await waitFor(() =>
      expect((within(panel).getByRole('radio', { name: 'Maiden name' }) as HTMLInputElement).checked).toBe(true),
    );
    // The same elements, not new ones: nothing was remounted.
    expect(document.querySelector('.tree-canvas > svg')).toBe(svg);
    expect(screen.getByRole('group', { name: 'Chart settings' })).toBe(panel);
    expect(screen.getByRole('button', { name: 'Chart settings' })).toBe(gear);
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(radio);
    expect(group.getAttribute('transform')).toBe(transform);
    // And prefixes and suffixes are switches that send one setting each.
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show prefixes (Dr., Sir)' }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ showPrefix: false }));
    expect(document.querySelector('.tree-canvas > svg')).toBe(svg);
  });

  it('has the same four name forms as My settings', async () => {
    mockApi(account().routes);
    renderApp('/tree/marcus');
    const { panel } = await openGear();
    fireEvent.click(within(panel).getByRole('button', { name: /Names/ }));
    expect(
      within(panel)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual(['Maiden name (Married name)', 'Married name (born Maiden name)', 'Married name', 'Maiden name']);
  });

  it('undoes a change that was not saved and says so in the panel', async () => {
    const { routes } = account({}, true);
    mockApi(routes);
    renderApp('/tree/marcus');
    const { panel } = await openGear();
    fireEvent.click(within(panel).getByRole('button', { name: /Cards/ }));
    const mark = within(panel).getByRole('switch', { name: 'Show † on people who have died' }) as HTMLInputElement;
    fireEvent.click(mark);
    const alert = await within(panel).findByRole('alert');
    expect(alert.textContent).toContain('That change was not saved, so it was undone.');
    await waitFor(() => expect(mark.checked).toBe(true));
  });

  it('restores the chart-only settings in one request, never Names, and says so', async () => {
    const { routes, patches } = account();
    mockApi(routes);
    renderApp('/tree/marcus');
    const { panel } = await openGear();
    fireEvent.click(within(panel).getByRole('button', { name: /Cards/ }));
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show † on people who have died' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    fireEvent.click(within(panel).getByRole('button', { name: 'Restore defaults' }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({
      showDeceasedMark: true,
      showExtendedRelatives: false,
      treeWheel: 'zoom',
      treeDefaultView: 'family',
    });
    await waitFor(() => expect(within(panel).getByRole('status').textContent).toBe('Defaults restored.'));
    expect(within(panel).getByText('Names are shared with My settings and are not reset here.')).toBeTruthy();
    // Restore defaults is last in the tab order.
    const focusable = within(panel).getAllByRole('button');
    expect(focusable.at(-1)?.textContent).toBe('Restore defaults');
  });

  it('closes with Esc and gives the focus back, and opening the view switcher closes it', async () => {
    mockApi(account().routes);
    renderApp('/tree/marcus');
    const { gear } = await openGear();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Chart settings' })).toBeNull();
    expect(document.activeElement).toBe(gear);
    fireEvent.click(gear);
    expect(screen.getByRole('group', { name: 'Chart settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Chart view:/ }));
    expect(screen.queryByRole('group', { name: 'Chart settings' })).toBeNull();
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
    // And the other way round.
    fireEvent.click(gear);
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });
});
