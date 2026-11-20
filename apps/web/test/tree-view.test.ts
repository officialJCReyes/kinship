// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  AVAILABLE_VIEWS,
  FAMILY_VIEW,
  generationOptions,
  GENERATIONS,
  parseTreeView,
  treeViewQuery,
  viewState,
} from '../src/tree/treeView.js';
import type { TreeViewName } from '../src/tree/treeView.js';

const ALL: TreeViewName[] = ['family', 'pedigree', 'fan', 'descendants'];
const parse = (query: string) => parseTreeView(new URLSearchParams(query), ALL);

describe('the view in the address', () => {
  it('has no view for the Family tree, so its addresses do not change', () => {
    expect(parse('')).toEqual(FAMILY_VIEW);
    expect(parse('of=abc&lineage=birth&sel=abc')).toEqual(FAMILY_VIEW);
    expect(treeViewQuery(FAMILY_VIEW)).toBe('');
  });

  it('reads a view and its generations, with the defaults 4, 4 and 5', () => {
    expect(parse('view=pedigree')).toEqual({ view: 'pedigree', gen: 4 });
    expect(parse('view=fan')).toEqual({ view: 'fan', gen: 4 });
    expect(parse('view=descendants')).toEqual({ view: 'descendants', gen: 5 });
    expect(parse('view=descendants&gen=2')).toEqual({ view: 'descendants', gen: 2 });
  });

  it('clamps the generations (3 to 5, or 2 to 5 for Descendants) and falls back for nonsense', () => {
    expect(parse('view=pedigree&gen=2').gen).toBe(3);
    expect(parse('view=pedigree&gen=9').gen).toBe(5);
    expect(parse('view=descendants&gen=1').gen).toBe(2);
    expect(parse('view=descendants&gen=7').gen).toBe(5);
    expect(parse('view=fan&gen=abc').gen).toBe(4);
    expect(parse('view=fan&gen=3.5').gen).toBe(4);
    expect(parse('view=fan&gen=-3').gen).toBe(4);
    expect(parse('view=hourglass')).toEqual(FAMILY_VIEW);
  });

  it('writes the address back, leaving out the default generations', () => {
    expect(treeViewQuery({ view: 'pedigree', gen: 4 })).toBe('view=pedigree');
    expect(treeViewQuery({ view: 'pedigree', gen: 5 })).toBe('view=pedigree&gen=5');
    expect(treeViewQuery({ view: 'descendants', gen: 5 })).toBe('view=descendants');
    expect(treeViewQuery({ view: 'descendants', gen: 3 })).toBe('view=descendants&gen=3');
    for (const view of ALL) {
      const state = viewState(view);
      expect(parse(treeViewQuery(state))).toEqual(state);
    }
  });

  it('offers 3, 4 or 5 generations, 2 to 5 for Descendants, and none for the Family tree', () => {
    expect(generationOptions('family')).toEqual([]);
    expect(generationOptions('pedigree')).toEqual([3, 4, 5]);
    expect(generationOptions('fan')).toEqual([3, 4, 5]);
    expect(generationOptions('descendants')).toEqual([2, 3, 4, 5]);
    expect(GENERATIONS.descendants.initial).toBe(5);
  });

  it('ignores a view that is not on offer', () => {
    const only = parseTreeView(new URLSearchParams('view=pedigree'), ['family']);
    expect(only).toEqual(FAMILY_VIEW);
    expect(AVAILABLE_VIEWS[0]).toBe('family');
  });
});
