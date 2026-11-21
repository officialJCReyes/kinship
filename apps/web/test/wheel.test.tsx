// SPDX-License-Identifier: AGPL-3.0-or-later
// The mouse wheel over a chart, in every view: it zooms by default, moves the chart in scroll mode, and Ctrl always zooms.
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ADMIN, haleRoutes } from './family.js';
import { mockApi, renderApp } from './helpers.js';

afterEach(cleanup);

const transform = () => {
  const text = document.querySelector('.tree-canvas > svg > g')!.getAttribute('transform')!;
  const [x, y, k] = text.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)!.map(Number);
  return { x: x!, y: y!, k: k! };
};

async function open(path: string, wheel: 'zoom' | 'scroll') {
  mockApi(haleRoutes({ ...ADMIN, treeWheel: wheel }));
  renderApp(path);
  await screen.findByRole('button', { name: /^Chart view:/ });
  await screen.findAllByRole('button', { name: /Marcus/ });
}

describe.each([
  ['the Family tree', '/tree/marcus'],
  ['the Pedigree', '/tree/marcus?view=pedigree'],
  ['Descendants', '/tree/daniel?view=descendants'],
  ['the Fan', '/tree/marcus?view=fan'],
])('the wheel in %s', (_name, path) => {
  const svg = () => document.querySelector('.tree-canvas > svg')!;

  it('zooms in zoom mode, which is the default', async () => {
    await open(path, 'zoom');
    const before = transform();
    expect(fireEvent.wheel(svg(), { deltaY: -120, clientX: 100, clientY: 100 })).toBe(false); // the page does not scroll
    const after = transform();
    expect(after.k).toBeGreaterThan(before.k);
  });

  it('moves the chart in scroll mode and keeps the zoom; Ctrl still zooms; Shift moves sideways', async () => {
    await open(path, 'scroll');
    const before = transform();
    fireEvent.wheel(svg(), { deltaX: 20, deltaY: 60 });
    const moved = transform();
    expect(moved.k).toBe(before.k);
    expect(moved.x).toBeCloseTo(before.x - 20, 6);
    expect(moved.y).toBeCloseTo(before.y - 60, 6);
    fireEvent.wheel(svg(), { deltaY: 40, shiftKey: true });
    const sideways = transform();
    expect(sideways.x).toBeCloseTo(moved.x - 40, 6);
    expect(sideways.y).toBeCloseTo(moved.y, 6);
    fireEvent.wheel(svg(), { deltaY: -120, ctrlKey: true, clientX: 100, clientY: 100 });
    expect(transform().k).toBeGreaterThan(before.k);
  });
});
