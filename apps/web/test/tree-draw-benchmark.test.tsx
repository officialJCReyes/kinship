// SPDX-License-Identifier: AGPL-3.0-or-later
//
// How long the Family tree chart takes to draw the 2,000-person fixture (backlog 15 asked for the draw time before and after
// the "+" nub). jsdom, so the numbers compare builds on one machine; they are not a browser's paint time. The ceilings are
// generous: the test fails only on a large regression. The times are printed for the step report.
import type { Person } from '@kinship/shared';
import { cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { layoutTree } from '../src/tree/layout.js';
import { TreeCanvas } from '../src/tree/TreeCanvas.js';
import { bigFamily } from './layout-fixtures.js';

afterEach(cleanup);

const input = bigFamily(2000);
const layout = layoutTree(input);
const people = new Map<string, Person>(
  input.people.map((p) => [
    p.id,
    {
      id: p.id,
      givenName: p.givenName,
      surname: p.surname,
      secondSurname: p.secondSurname ?? null,
      marriedSurname: p.marriedSurname ?? null,
      namePrefix: null,
      nameSuffix: null,
      nickname: null,
      gender: null,
      birth: p.birth,
      deceased: false,
      death: null,
      isPlaceholder: false,
      photoMediaId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]),
);
const none = new Map();
/** An admin's chart: every card has the "+" (backlog 15). */
const everyone = new Set(layout.nodes.map((n) => n.id));
/** BENCH_NO_NUB=1 draws the cards without it, to compare on the same machine. */
const withNub = !process.env['BENCH_NO_NUB'];

/** Each React commit's render time. Profiler works in the development build the tests run. */
let commits: number[] = [];
function draw(view: 'family') {
  commits = [];
  return render(
    <MemoryRouter>
      <Profiler id="chart" onRender={(_id, _phase, actual) => void commits.push(actual)}>
        <TreeCanvas
          layout={layout}
          people={people}
          focalId={input.focalId}
          selectedId={input.focalId}
          leaves={none}
          otherLeaves={none}
          parents={none}
          children={none}
          canEditUnion={() => false}
          onSelect={() => undefined}
          onLeaf={() => undefined}
          onCouple={() => undefined}
          addable={withNub ? everyone : undefined}
          onAdd={withNub ? () => undefined : undefined}
          view={view}
        />
      </Profiler>
    </MemoryRouter>,
  );
}

/** The chart's box, as a browser window of this size would give it (jsdom has no layout). */
function windowOf(width: number, height: number) {
  for (const [key, value] of [
    ['clientWidth', width],
    ['clientHeight', height],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('tree-canvas') ? value : 0;
      },
    });
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Draws the chart five times and gives the median render time and how many cards were drawn, with and without text. */
function measure(view: 'family', width: number, height: number) {
  windowOf(width, height);
  const times: number[] = [];
  let cards = 0;
  let full = 0;
  for (let i = 0; i < 5; i += 1) {
    draw(view);
    times.push(sum(commits));
    cards = document.querySelectorAll('.tnode').length;
    full = document.querySelectorAll('.tnode .name').length;
    expect(document.querySelectorAll('[data-add]')).toHaveLength(withNub ? full : 0);
    cleanup();
  }
  return { ms: median(times), cards, full };
}

describe('drawing the 2,000-person fixture', () => {
  afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it('opens in a laptop window and in a very large window in reasonable time (times printed)', () => {
    // The Family tree opening at 0.7 in a laptop window, and in a window big enough for hundreds of cards with text (only the
    // cards near the window are drawn, so this is the most a real screen draws at once with text). Below 0.3 a card is a
    // plain box with no text and no "+".
    const normal = measure('family', 1280, 800);
    const large = measure('family', 7000, 4500);
    console.log(
      `draw 2,000 people${withNub ? ' with the +' : ' without the +'}: window ${normal.ms.toFixed(1)} ms (${normal.full} cards), large window ${large.ms.toFixed(1)} ms (${large.full} cards)`,
    );
    expect(large.full).toBeGreaterThan(normal.full);
    expect(normal.ms).toBeLessThan(1500);
    expect(large.ms).toBeLessThan(4000);
  }, 120_000);
});
