// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Legend } from '../src/tree/Legend.js';
import type { TreeViewName } from '../src/tree/treeView.js';

afterEach(cleanup);

const text = (view?: TreeViewName) => {
  render(<Legend {...(view ? { view } : {})} />);
  return screen.getByRole('group', { name: 'Legend' }).textContent ?? '';
};

describe('the legend', () => {
  it('says the same for the Family tree as it always did', () => {
    const family = text();
    expect(family).toContain('Solid line');
    expect(family).toContain('Dotted line');
    expect(family).toContain('Leaf: opens that person’s own family');
    expect(family).toContain('Second leaf');
    expect(family).not.toMatch(/Father above|Left half|partners are listed/);
  });

  it('has the line about finding someone who is not drawn in every view', () => {
    for (const view of ['family', 'pedigree', 'fan', 'descendants'] as const) {
      expect(text(view), view).toContain('Someone not on the chart? Search for them above');
      cleanup();
    }
  });

  it('has one row about the view for each of the other views, and no leaves', () => {
    expect(text('pedigree')).toContain('Father above, mother below');
    expect(document.querySelector('.legend-leaf')).toBeNull();
    cleanup();
    expect(text('fan')).toContain('Left half is the father’s side');
    expect(screen.queryByText('Dotted line', { exact: false })).toBeNull();
    cleanup();
    expect(text('descendants')).toContain('Stepchildren are not shown');
  });
});
