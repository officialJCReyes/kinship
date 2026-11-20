// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which view of the tree is drawn: the Family tree (the default) or one of the three views that follow one person
// (ADR 0026). The view is a display setting kept in the address: /tree/:id?view=pedigree&gen=4. The Family tree has
// no `view` parameter, so its addresses do not change.

export type TreeViewName = 'family' | 'pedigree' | 'fan' | 'descendants';

/**
 * The views the switcher offers, in order. The list is data: a view that is not ready is simply not in it, and an
 * address that names it falls back to the Family tree.
 */
export const AVAILABLE_VIEWS: readonly TreeViewName[] = ['family', 'pedigree'];

interface Generations {
  min: number;
  max: number;
  /** Used when the address has no (or a bad) `gen`. The choice is not remembered between visits. */
  initial: number;
}

/** How many generations each view draws. The Family tree has no such choice. */
export const GENERATIONS: Record<Exclude<TreeViewName, 'family'>, Generations> = {
  pedigree: { min: 3, max: 5, initial: 4 },
  fan: { min: 3, max: 5, initial: 4 },
  descendants: { min: 2, max: 5, initial: 5 },
};

export interface TreeViewState {
  view: TreeViewName;
  /** The generations drawn (0 for the Family tree). */
  gen: number;
}

export const FAMILY_VIEW: TreeViewState = { view: 'family', gen: 0 };

export function generationOptions(view: TreeViewName): number[] {
  if (view === 'family') return [];
  const { min, max } = GENERATIONS[view];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** `?view=` and `?gen=` from an address. Anything unknown or out of range falls back to the default. */
export function parseTreeView(
  params: URLSearchParams,
  available: readonly TreeViewName[] = AVAILABLE_VIEWS,
): TreeViewState {
  const raw = params.get('view');
  const view = available.find((v) => v === raw);
  if (!view || view === 'family') return FAMILY_VIEW;
  const range = GENERATIONS[view];
  const asked = Number(params.get('gen'));
  const gen = Number.isInteger(asked) && asked > 0 ? Math.min(range.max, Math.max(range.min, asked)) : range.initial;
  return { view, gen };
}

/** The query string for a view: empty for the Family tree, and `gen` left out when it is the view's default. */
export function treeViewQuery(state: TreeViewState): string {
  if (state.view === 'family') return '';
  const query = new URLSearchParams({ view: state.view });
  if (state.gen !== GENERATIONS[state.view].initial) query.set('gen', String(state.gen));
  return query.toString();
}

/** The view a switch to `view` goes to, with that view's default number of generations. */
export function viewState(view: TreeViewName): TreeViewState {
  return view === 'family' ? FAMILY_VIEW : { view, gen: GENERATIONS[view].initial };
}
