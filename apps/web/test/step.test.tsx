// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PersonLabel, UnionStatus } from '@kinship/shared';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, detailFor, haleRoutes, PEOPLE, treeFor, UNIONS } from './family.js';
import { stepChildrenOf, stepParentsOf } from '../src/lib/step.js';
import { mockApi, renderApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
  restore();
});

// The test family is shared: a test that adds or changes a relationship puts it back afterwards.
let undo: Array<() => void> = [];
function restore() {
  for (const fn of undo.reverse()) fn();
  undo = [];
}
function addUnion(id: string, a: string, b: string, status: UnionStatus) {
  UNIONS.push({
    id,
    partnerIds: a < b ? [a, b] : [b, a],
    status,
    start: null,
    end: null,
    statusAuto: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  undo.push(() =>
    UNIONS.splice(
      UNIONS.findIndex((u) => u.id === id),
      1,
    ),
  );
}
function setStatus(id: string, status: UnionStatus) {
  const union = UNIONS.find((u) => u.id === id)!;
  const before = union.status;
  union.status = status;
  undo.push(() => (union.status = before));
}

const person = (id: string) => PEOPLE.find((p) => p.id === id)!;
const steps = (id: string, lineage: 'adoptive' | 'birth' = 'adoptive') => {
  const me = { ...ADMIN, lineageView: lineage };
  const tree = treeFor(id, { up: 1, down: 1, collateral: true, lineage });
  return [
    ...stepParentsOf(tree, id).map((r) => `${r.kind}:${r.otherId}`),
    ...stepChildrenOf(detailFor(me, id)).map((r) => `${r.kind}:${r.otherId}`),
  ].sort();
};

describe('step relatives, derived from what the profile has', () => {
  it('gives a step-parent through a Married relationship of a parent, and never a parent of the same relationship', () => {
    // Carla's parents are Daniel and Priya (divorced); Daniel is now married to Elena.
    expect(steps('carla')).toEqual(['stepparent:elena']);
    // Ben hangs from Daniel alone; Elena is Daniel's wife; Priya is his ex.
    expect(steps('ben')).toEqual(['stepparent:elena']);
    // Marcus's parents are Daniel and Elena together: Elena is a parent, and Daniel's divorce from Priya gives nothing.
    expect(steps('marcus')).toEqual([]);
  });

  it('gives a stepchild through a Married relationship: the partner’s children from elsewhere, alone or with someone', () => {
    // Elena is married to Daniel: Carla (with Priya) and Ben (Daniel alone). Marcus and Sofia are her own.
    expect(steps('elena')).toEqual(['stepchild:ben', 'stepchild:carla']);
  });

  it('gives nothing through a divorce: divorced then remarried gives only the current marriage', () => {
    // Priya was married to Daniel (divorced 1998): none of Daniel's other children are her stepchildren,
    // and nobody is Carla's step-parent through Priya.
    expect(steps('priya')).toEqual([]);
    expect(steps('carla')).not.toContain('stepparent:priya');
  });

  it('gives nothing through unmarried partners, separation, engagement or any other status', () => {
    for (const status of ['partner', 'engaged', 'separated', 'friends', 'unknown', 'other', 'annulment'] as const) {
      setStatus('u1', status); // Daniel and Elena
      expect(steps('ben'), status).toEqual([]);
      expect(steps('elena'), status).toEqual([]);
      restore();
    }
  });

  it('counts a Widowed relationship like a Married one', () => {
    setStatus('u1', 'widowed');
    expect(steps('ben')).toEqual(['stepparent:elena']);
    expect(steps('elena')).toEqual(['stepchild:ben', 'stepchild:carla']);
  });

  it('counts a partner’s single-parent child (Ben hangs from Daniel alone)', () => {
    expect(steps('elena')).toContain('stepchild:ben');
  });

  it('follows the lineage view the way half-siblings do', () => {
    // Samuel was born to Frank and Ruth and adopted by Anna and Joseph. Ruth later married Tomas; Carla married Frank.
    addUnion('ux', 'ruth', 'tomas', 'married');
    addUnion('uy', 'carla', 'frank', 'married');
    // Adoptive view: Samuel's parents are Anna and Joseph, so Tomas is nothing to him, and Frank is nothing to Carla's stepchildren.
    expect(steps('samuel', 'adoptive')).toEqual([]);
    expect(steps('carla', 'adoptive')).toEqual(['stepparent:elena']);
    // Birth view: Samuel's parents are Frank and Ruth; Tomas (Ruth's husband) and Carla (Frank's wife) are his step-parents.
    expect(steps('samuel', 'birth')).toEqual(['stepparent:carla', 'stepparent:tomas']);
    expect(steps('carla', 'birth')).toEqual(['stepchild:samuel', 'stepparent:elena']);
  });

  it('gives an adopted child step-parents through the adoptive parents in the adoptive view', () => {
    addUnion('uw', 'anna', 'tomas', 'married'); // Anna (adoptive mother) married Tomas
    expect(steps('samuel', 'adoptive')).toEqual(['stepparent:tomas']);
    expect(steps('samuel', 'birth')).toEqual([]);
  });
});

describe('the profile: step relatives and the partner’s children', () => {
  const labelled = (id: string, other: string, direction: 'from' | 'to'): PersonLabel => ({
    id: `l-${id}`,
    otherId: other,
    other: person(other),
    direction,
    label: 'Godmother',
    reverseLabel: null,
  });
  const routesWithLabel = (labels: Record<string, PersonLabel[]>) =>
    haleRoutes(
      ADMIN,
      Object.fromEntries(
        Object.entries(labels).map(([id, list]) => [
          `GET /api/people/${id}`,
          { status: 200, body: { ...detailFor(ADMIN, id), labels: list } },
        ]),
      ),
    );

  it('lists a step-parent and stepchildren with their titles, and the partner’s other children on the relationship card', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    const list = screen.getByRole('list', { name: 'Step relatives' });
    expect(within(list).getByRole('link', { name: /Carla Nair/ }).textContent).toMatch(/Stepdaughter/);
    expect(within(list).getByRole('link', { name: /Ben Hale/ }).textContent).toMatch(/Stepson/);
    // Marcus and Sofia are her own children.
    expect(within(list).queryByText(/Marcus Hale/)).toBeNull();
    const card = screen.getByRole('article', { name: 'Relationship with Daniel Hale' });
    expect(within(card).getByText('Daniel’s children from another relationship')).toBeTruthy();
    const carla = within(card)
      .getByRole('link', { name: /Carla Nair/ })
      .closest('li')!;
    expect(carla.textContent).toMatch(/with Priya Nair, your stepdaughter/);
    const ben = within(card)
      .getByRole('link', { name: /Ben Hale/ })
      .closest('li')!;
    expect(ben.textContent).toMatch(/other parent not on the tree, your stepson/);
  });

  it('shows a step-parent to the child, and nothing to a child of both parents', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/carla');
    await screen.findByRole('heading', { name: 'Carla Nair' });
    const list = screen.getByRole('list', { name: 'Step relatives' });
    expect(within(list).getByRole('link', { name: /Elena Ruiz/ }).textContent).toMatch(/Stepmother/);
    cleanup();
    vi.unstubAllGlobals();
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/marcus');
    await screen.findAllByRole('heading', { name: 'Marcus Hale' });
    expect(screen.queryByRole('list', { name: 'Step relatives' })).toBeNull();
  });

  it('still lists a divorced partner’s other children, with no step wording', async () => {
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/priya');
    await screen.findByRole('heading', { name: 'Priya Nair' });
    expect(screen.queryByRole('list', { name: 'Step relatives' })).toBeNull();
    const card = screen.getByRole('article', { name: 'Relationship with Daniel Hale' });
    const marcus = within(card)
      .getByRole('link', { name: /Marcus Hale/ })
      .closest('li')!;
    expect(marcus.textContent).toMatch(/with Elena Ruiz/);
    expect(marcus.textContent).not.toMatch(/step/i);
  });

  it('replaces the derived title with the custom label on BOTH profiles of the pair', async () => {
    // Elena is Carla's stepmother; an admin recorded her as Carla's godmother.
    const routes = routesWithLabel({
      carla: [labelled('carla', 'elena', 'from')],
      elena: [labelled('carla', 'carla', 'to')],
    });
    mockApi(routes);
    renderApp('/people/carla');
    await screen.findByRole('heading', { name: 'Carla Nair' });
    // Carla's profile: no derived "Stepmother" row; the custom row is there.
    expect(screen.queryByRole('list', { name: 'Step relatives' })).toBeNull();
    expect(screen.queryByText(/Stepmother/)).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Other relationships' })).getByText(/Godmother:/)).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(routes);
    renderApp('/people/elena');
    await screen.findAllByRole('heading', { name: 'Elena Ruiz' });
    // Elena's profile: Carla's derived "Stepdaughter" row is replaced; Ben (no custom label) keeps his.
    const list = screen.getByRole('list', { name: 'Step relatives' });
    expect(within(list).queryByText(/Carla Nair/)).toBeNull();
    expect(within(list).getByRole('link', { name: /Ben Hale/ }).textContent).toMatch(/Stepson/);
    expect(within(screen.getByRole('list', { name: 'Other relationships' })).getByText(/Godmother of/)).toBeTruthy();
  });

  it('changes only the title row: the relationship card still lists the child, without "your stepdaughter"', async () => {
    mockApi(routesWithLabel({ elena: [labelled('carla', 'carla', 'to')] }));
    renderApp('/people/elena');
    await screen.findByRole('heading', { name: 'Elena Ruiz' });
    const card = screen.getByRole('article', { name: 'Relationship with Daniel Hale' });
    const carla = within(card)
      .getByRole('link', { name: /Carla Nair/ })
      .closest('li')!;
    expect(carla.textContent).toMatch(/with Priya Nair/);
    expect(carla.textContent).not.toMatch(/stepdaughter/);
    // Ben has no custom label: his wording stays.
    expect(
      within(card)
        .getByRole('link', { name: /Ben Hale/ })
        .closest('li')!.textContent,
    ).toMatch(/your stepson/);
  });

  it('follows the viewer’s lineage view on screen', async () => {
    addUnion('ux', 'ruth', 'tomas', 'married');
    mockApi(haleRoutes(ADMIN));
    renderApp('/people/samuel');
    await screen.findByRole('heading', { name: 'Samuel Hale' });
    expect(screen.queryByRole('list', { name: 'Step relatives' })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    mockApi(haleRoutes({ ...ADMIN, lineageView: 'birth' }));
    renderApp('/people/samuel');
    await screen.findAllByRole('heading', { name: 'Samuel Hale' });
    const list = await screen.findByRole('list', { name: 'Step relatives' });
    expect(within(list).getByRole('link', { name: /Tomas Nair/ }).textContent).toMatch(/Stepfather/);
  });
});
