// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The relationship finder page: the two people are in the address, the answer is announced, the path is listed in
// words as well as drawn, removed cousins get the explainer, and the adoption hint matches the viewer's view.
import { findWithAdoptionHint } from '@kinship/shared';
import type { LineageView, Person, RelationshipResponse } from '@kinship/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN, haleRoutes } from './family.js';
import { HALE_PEOPLE, haleGraph } from './fixtures/hale.js';
import { calls, mockApi, renderApp } from './helpers.js';

afterEach(() => vi.unstubAllGlobals());

const personOf = (key: string): Person => {
  const p = HALE_PEOPLE.find((candidate) => candidate.key === key)!;
  return {
    id: key,
    givenName: p.givenName,
    surname: p.surname,
    secondSurname: null,
    marriedSurname: null,
    namePrefix: null,
    nameSuffix: null,
    nickname: p.nickname ?? null,
    surnameParticle: null,
    gender: p.gender,
    birth: { value: p.birth, precision: 'exactly' },
    deceased: p.death !== undefined,
    death: p.death ? { value: p.death, precision: 'exactly' } : null,
    isPlaceholder: false,
    photoMediaId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
};

/** What the API would answer, from the shared finder on the Hale fixture. */
function answer(path: string, viewer: LineageView = ADMIN.lineageView): { status: number; body: RelationshipResponse } {
  const url = new URL(path, 'http://x');
  const a = url.searchParams.get('a')!;
  const b = url.searchParams.get('b')!;
  const lineage = (url.searchParams.get('lineage') as LineageView | null) ?? viewer;
  const { facts, other } = findWithAdoptionHint(haleGraph(), a, b, lineage);
  const named = new Set<string>([
    a,
    b,
    ...(facts.blood ? [...facts.blood.ancestors, ...facts.blood.lineA, ...facts.blood.lineB] : []),
    ...(facts.chain?.people ?? []),
    ...(facts.chain?.hops ?? []).flatMap((hop) => (hop ? [...hop.ancestors, ...hop.lineA, ...hop.lineB] : [])),
  ]);
  const people: RelationshipResponse['people'] = {};
  for (const key of named) {
    const full = personOf(key);
    people[key] = {
      id: full.id,
      givenName: full.givenName,
      surname: full.surname,
      secondSurname: null,
      marriedSurname: null,
      namePrefix: null,
      nameSuffix: null,
      surnameParticle: null,
      gender: full.gender,
      birth: full.birth,
      deceased: full.deceased,
      death: full.death,
      isPlaceholder: false,
      photoMediaId: null,
    };
  }
  return { status: 200, body: { ...facts, lineage, a, b, other, people, labels: [] } };
}

const routes = (viewer = ADMIN) =>
  haleRoutes(viewer, { 'GET /api/relationship*': (_init, path) => answer(path, viewer.lineageView) });

describe('the relationship finder page', () => {
  it('asks for two people before it answers, with the finder under the Family tree tab', async () => {
    mockApi(routes());
    renderApp('/relationship');
    expect(await screen.findByRole('heading', { name: 'Relationship finder' })).toBeTruthy();
    expect(screen.getByText('Choose two people to see how they are related.')).toBeTruthy();
    const sections = screen.getByRole('navigation', { name: 'Family tree sections' });
    expect(within(sections).getByRole('link', { name: 'Chart' })).toBeTruthy();
    expect(within(sections).getByRole('link', { name: 'Relationship finder' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Main' }))
        .getByRole('link', { name: 'Family tree' })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('names the relationship, announces it, and lists the path in words with links', async () => {
    const fetchMock = mockApi(routes());
    renderApp('/relationship?a=marcus&b=naomi');
    expect(await screen.findByText('First cousin')).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/relationship?a=marcus&b=naomi');
    const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('First cousin'))!;
    expect(status.textContent).toContain('Naomi Brooks’s relationship to Marcus Hale');
    expect(screen.getByText(/Closest common ancestors: /)).toBeTruthy();
    const path = within(screen.getByRole('list', { name: '' })).getAllByRole('listitem');
    expect(path[0]!.textContent).toBe('Marcus Hale');
    expect(path[1]!.textContent).toBe('Daniel Hale · father of Marcus Hale');
    expect(within(path[0]!).getByRole('link', { name: 'Marcus Hale' }).getAttribute('href')).toBe('/people/marcus');
    expect(path.at(-1)!.textContent).toMatch(/^Naomi Brooks · daughter of /);
  });

  it('hides the drawing from assistive technology, so the list is the one path read out', async () => {
    mockApi(routes());
    renderApp('/relationship?a=marcus&b=naomi');
    await screen.findByText('First cousin');
    const drawing = document.querySelector('.rdiagram')!;
    expect(drawing.getAttribute('aria-hidden')).toBe('true');
    for (const link of drawing.querySelectorAll('a')) expect(link.getAttribute('tabindex')).toBe('-1');
  });

  it('explains "once removed" for a removed cousin, and says generations in the family tree', async () => {
    mockApi(routes());
    renderApp('/relationship?a=leo&b=naomi');
    expect(await screen.findByText('First cousin once removed')).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'What “first cousin once removed” means' })).toBeTruthy();
    expect(screen.getByText('Leo Hale is one generation further down the family tree than Naomi Brooks.')).toBeTruthy();
    expect(screen.getByText(/The term is the same from either side/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/younger|older/);
    // The general "how it was worked out" paragraph is gone (backlog 10); only this panel explains anything.
    expect(document.body.textContent).not.toMatch(/Worked out from the tree alone/);
  });

  it('has no paragraph on how the answer was worked out', async () => {
    mockApi(routes());
    renderApp('/relationship');
    await screen.findByText('Choose two people to see how they are related.');
    expect(document.body.textContent).not.toMatch(/Worked out from the tree alone|closest shared ancestor, counts/);
  });

  it('has no explainer for a plain cousin', async () => {
    mockApi(routes());
    renderApp('/relationship?a=marcus&b=naomi');
    await screen.findByText('First cousin');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('shows "also related as" for a person related two ways', async () => {
    mockApi(
      haleRoutes(ADMIN, {
        'GET /api/relationship*': {
          status: 200,
          body: {
            ...answer('/api/relationship?a=marcus&b=naomi').body,
            also: [{ key: 'union.label.married.female' }],
          },
        },
      }),
    );
    renderApp('/relationship?a=marcus&b=naomi');
    expect(await screen.findByText('Also related as: wife.')).toBeTruthy();
  });

  it('says no relationship was found, with the adoption hint for the view the viewer is in', async () => {
    mockApi(routes({ ...ADMIN, lineageView: 'birth' }));
    renderApp('/relationship?a=marcus&b=samuel');
    expect(await screen.findByText('No relationship found')).toBeTruthy();
    expect(screen.getByText('Related through adoption. Switch to the adoptive view to see it.')).toBeTruthy();
    expect(screen.queryByText('The path in words')).toBeNull();
    // The hint replaces the "not connected" line: the two are connected, in the other view
    expect(screen.queryByText('These two people are not connected on the tree yet.')).toBeNull();
  });

  it('gives no adoption hint when the two are unrelated in both views', async () => {
    mockApi(routes());
    renderApp('/relationship?a=marcus&b=frank');
    expect(await screen.findByText('No relationship found')).toBeTruthy();
    expect(screen.getByText('These two people are not connected on the tree yet.')).toBeTruthy();
    expect(screen.queryByText(/through adoption/)).toBeNull();
  });

  it('swaps the two people in the address', async () => {
    const fetchMock = mockApi(routes());
    renderApp('/relationship?a=marcus&b=naomi');
    await screen.findByText('First cousin');
    fireEvent.click(screen.getByRole('button', { name: 'Swap people' }));
    expect(await screen.findByText(/Marcus Hale’s relationship to Naomi Brooks/)).toBeTruthy();
    expect(calls(fetchMock)).toContain('GET /api/relationship?a=naomi&b=marcus');
  });

  it('reads an in-law or step result as a chain, with each link in words', async () => {
    mockApi(routes());
    renderApp('/relationship?a=marcus&b=raymond');
    expect(await screen.findByText('Stepfather')).toBeTruthy();
    const path = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(path.some((text) => text?.includes('mother of Marcus Hale'))).toBe(true);
    expect(path.some((text) => text?.includes('husband of '))).toBe(true);
  });

  describe('shared ancestors of a link in a chain (backlog 9)', () => {
    it('draws the wife’s parents above her and her brother, and says the same in words, as a list under the step', async () => {
      mockApi(routes());
      renderApp('/relationship?a=marcus&b=arjun');
      expect(await screen.findByText('Brother-in-law')).toBeTruthy();
      // The drawing: an SVG with a card for each of the five, hidden from assistive technology.
      const drawing = document.querySelector('.rdiagram')!;
      expect(drawing.getAttribute('aria-hidden')).toBe('true');
      expect(drawing.querySelector('svg')).not.toBeNull();
      expect(Array.from(drawing.querySelectorAll('.rcard title')).map((n) => n.textContent)).toEqual(
        expect.arrayContaining(['Marcus Hale', 'Priya Nair', 'Arjun Nair', 'Raj Nair', 'Meera Iyer']),
      );
      expect(drawing.querySelectorAll('.rcard.hl')).toHaveLength(2);
      // The words: Priya is Marcus's wife, Arjun her brother, and under that step, their parents.
      const path = screen.getByRole('list', { name: '' }).parentElement!;
      const via = within(path).getByRole('list', { name: 'How Priya Nair and Arjun Nair are related' });
      const items = within(via).getAllByRole('listitem');
      expect(items.map((li) => li.textContent)).toEqual([
        'Raj Nair and Meera Iyer · parents of Priya Nair and Arjun Nair (shared ancestors)',
      ]);
      expect(
        within(items[0]!)
          .getAllByRole('link')
          .map((a) => a.textContent),
      ).toEqual(['Raj Nair', 'Meera Iyer']);
    });

    it('lists the people between, top-down, for a link through grandparents', async () => {
      mockApi(routes());
      renderApp('/relationship?a=marcus&b=anthony');
      expect(await screen.findByText('Aunt’s ex-husband')).toBeTruthy();
      const via = screen.getByRole('list', { name: 'How Marcus Hale and Carla Hale are related' });
      expect(
        within(via)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual([
        'Daniel Hale · father of Marcus Hale',
        expect.stringMatching(
          /^Walter Hale( Sr\.)? and Rosa Mendez · parents of Daniel Hale and Carla Hale \(shared ancestors\)$/,
        ),
      ]);
    });

    it('adds nothing under a direct line or a marriage', async () => {
      mockApi(routes());
      renderApp('/relationship?a=marcus&b=raj');
      expect(await screen.findByText('Father-in-law')).toBeTruthy();
      expect(document.querySelector('.finder-path-via')).toBeNull();
    });

    it('shrinks to fit down to 0.7, then scrolls inside its own box', async () => {
      mockApi(routes());
      renderApp('/relationship?a=marcus&b=tomas');
      expect(await screen.findByText('Stepbrother')).toBeTruthy();
      const svg = document.querySelector<SVGSVGElement>('.rdiagram svg')!;
      const width = Number(svg.getAttribute('width'));
      expect(svg.style.maxWidth).toBe('100%');
      expect(svg.style.minWidth).toBe(`${Math.round(width * 0.7)}px`);
    });
  });

  it('never shows a nickname', async () => {
    mockApi(routes());
    renderApp('/relationship?a=marcus&b=daniel');
    await screen.findByText('Father');
    expect(document.body.textContent).not.toContain('Danny');
  });

  it('shows an error with a retry when the answer cannot be had', async () => {
    mockApi(haleRoutes(ADMIN, { 'GET /api/relationship*': { status: 404, body: { error: 'person_not_found' } } }));
    renderApp('/relationship?a=marcus&b=naomi');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  describe('custom labels (#39)', () => {
    const withLabels = (labels: RelationshipResponse['labels'], from = 'marcus', to = 'beatriz') =>
      mockApi(
        haleRoutes(ADMIN, {
          'GET /api/relationship*': {
            status: 200,
            body: { ...answer(`/api/relationship?a=${from}&b=${to}`).body, labels },
          },
        }),
      );

    it('keeps the derived headline and adds "Also called" with the custom pill for a blood or in-law result', async () => {
      withLabels([{ direction: 'from', label: 'Godmother', reverseLabel: 'Godchild' }], 'marcus', 'naomi');
      renderApp('/relationship?a=marcus&b=naomi');
      expect(await screen.findByText('First cousin')).toBeTruthy();
      const line = screen.getByText(/Also called Godmother/);
      expect(line.textContent).toContain('(custom)');
    });

    it('replaces a step title with the label, as the profile does (ADR 0010)', async () => {
      withLabels([{ direction: 'from', label: 'Godmother', reverseLabel: 'Godchild' }]);
      renderApp('/relationship?a=marcus&b=beatriz');
      await waitFor(() =>
        expect(screen.getAllByRole('status').some((el) => el.textContent?.includes('Godmother'))).toBe(true),
      );
      const status = screen.getAllByRole('status').find((el) => el.textContent?.includes('Godmother'))!;
      expect(status.textContent).not.toContain('Stepmother');
      expect(status.textContent).toContain('(custom)');
    });

    it('uses the reverse label from the other side, and a sentence when there is none', async () => {
      withLabels([{ direction: 'to', label: 'Godmother', reverseLabel: 'Godchild' }], 'naomi', 'marcus');
      renderApp('/relationship?a=naomi&b=marcus');
      expect(await screen.findByText(/Also called Godchild/)).toBeTruthy();
      cleanup();
      withLabels([{ direction: 'to', label: 'Godmother', reverseLabel: null }], 'naomi', 'marcus');
      renderApp('/relationship?a=naomi&b=marcus');
      expect(await screen.findByText(/Naomi Brooks is Marcus Hale’s Godmother/)).toBeTruthy();
    });

    it('shows nothing extra when the pair has no label', async () => {
      withLabels([]);
      renderApp('/relationship?a=marcus&b=beatriz');
      await screen.findByText('Stepmother');
      expect(screen.queryByText(/Also called/)).toBeNull();
      expect(screen.queryByText('(custom)')).toBeNull();
    });
  });
});
