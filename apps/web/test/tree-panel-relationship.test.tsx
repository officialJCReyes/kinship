// SPDX-License-Identifier: AGPL-3.0-or-later
// The person panel (step 49 B): who the selected person is to you, and the FamilySearch research link.
import type { Person, RelationshipResponse } from '@kinship/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelRelationship, relationshipLine } from '../src/tree/PanelRelationship.js';
import { ADMIN, haleRoutes, MEMBER } from './family.js';
import { calls, mockApi, renderApp } from './helpers.js';
import { answer } from './relationship-answer.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 25, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const finder = { 'GET /api/relationship*': (_init: RequestInit, path: string) => answer(path) };

async function panelFor(me: typeof ADMIN, id: string, extra: Parameters<typeof haleRoutes>[1] = finder) {
  const fetchMock = mockApi(haleRoutes(me, extra));
  renderApp(`/tree/marcus?sel=${id}`);
  const panel = await screen.findByRole('complementary', { name: 'Selected person' });
  await within(panel).findByRole('heading', { level: 2 });
  return { panel, fetchMock };
}

const relText = (panel: HTMLElement) => panel.querySelector('.panel-rel')?.textContent ?? null;
const relCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  calls(fetchMock).filter((call) => call.startsWith('GET /api/relationship'));

describe('the relationship line', () => {
  it('says who the person is to you, in lower case after "Your", above the Born line', async () => {
    const { panel, fetchMock } = await panelFor(MEMBER, 'walter');
    await waitFor(() => expect(relText(panel)).toBe('Your grandfather'));
    expect(relCalls(fetchMock)).toEqual(['GET /api/relationship?a=marcus&b=walter']);
    const facts = panel.querySelector('.panel-facts')!;
    expect(facts.firstElementChild?.classList.contains('panel-rel')).toBe(true);
  });

  it('says "This is you" on your own person, with no request and no You pill', async () => {
    const { panel, fetchMock } = await panelFor(MEMBER, 'marcus');
    expect(relText(panel)).toBe('This is you');
    expect(within(panel).queryByText('You', { exact: true })).toBeNull();
    // Give a debounced request every chance to go out.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(relCalls(fetchMock)).toEqual([]);
  });

  it('is not there, and not asked for, when the account has no person', async () => {
    const { panel, fetchMock } = await panelFor(ADMIN, 'walter');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(relText(panel)).toBeNull();
    expect(relCalls(fetchMock)).toEqual([]);
  });

  it('shows nothing while it loads, and nothing for no relationship', async () => {
    const loading = await panelFor(MEMBER, 'walter', { 'GET /api/relationship*': 'never' });
    await waitFor(() => expect(relCalls(loading.fetchMock)).toHaveLength(1));
    expect(relText(loading.panel)).toBeNull();
    expect(loading.panel.textContent).not.toMatch(/Loading|Working/);
  });

  it('uses an admin’s custom step title as it was typed', async () => {
    const custom = {
      'GET /api/relationship*': (_init: RequestInit, path: string) => {
        const reply = answer(path);
        return {
          ...reply,
          // As if Walter were a step-grandfather with an admin's label (ADR 0010: it replaces the step title).
          body: {
            ...reply.body,
            stepTitle: true,
            labels: [{ direction: 'from' as const, label: 'Bonus grandpa', reverseLabel: null }],
          },
        };
      },
    };
    const { panel } = await panelFor(MEMBER, 'walter', custom);
    await waitFor(() => expect(relText(panel)).toBe('Your Bonus grandpa'));
    expect(panel.textContent).not.toMatch(/Also called|grandfather/i);
  });
});

describe('relationshipLine', () => {
  const base = answer('/api/relationship?a=marcus&b=naomi').body;
  it('lower-cases the derived name and says nothing for none or self', () => {
    expect(relationshipLine(base)).toBe('Your first cousin');
    expect(relationshipLine({ ...base, kind: 'none', name: null } as RelationshipResponse)).toBeNull();
    expect(relationshipLine({ ...base, kind: 'self' } as RelationshipResponse)).toBeNull();
  });

  it('keeps a custom label for a blood relative as an extra, not the headline', () => {
    const labels = [{ direction: 'from' as const, label: 'Godmother', reverseLabel: null }];
    expect(relationshipLine({ ...base, labels })).toBe('Your first cousin');
  });
});

describe('a placeholder', () => {
  it('gets no relationship line and no request', async () => {
    const fetchMock = mockApi({});
    const placeholder = {
      id: 'unknown-1',
      givenName: '',
      surname: '',
      isPlaceholder: true,
    } as unknown as Person;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <PanelRelationship person={placeholder} mePersonId="marcus" />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(container.textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the research link', () => {
  const link = (panel: HTMLElement) =>
    within(panel).queryByRole('link', { name: 'Research this person on FamilySearch (opens in a new tab)' });

  it('follows Add relative, opens FamilySearch in a new tab, with the name and the years', async () => {
    const { panel } = await panelFor(ADMIN, 'walter');
    const research = link(panel)!;
    expect(research.getAttribute('href')).toBe(
      'https://www.familysearch.org/en/search/record/results?count=20&q.birthLikeDate.from=1930&q.deathLikeDate.from=2005&q.givenName=Walter&q.surname=Hale',
    );
    expect(research.getAttribute('target')).toBe('_blank');
    expect(research.getAttribute('rel')).toBe('noopener noreferrer');
    expect(research.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const group = within(panel).getByRole('group', { name: 'Actions for Walter Hale' });
    expect(Array.from(group.querySelectorAll('a, button')).map((el) => el.getAttribute('aria-label'))).toEqual([
      'Open profile',
      'Edit details',
      'Add relative',
      'Research this person on FamilySearch (opens in a new tab)',
      'View Walter’s family',
      'More actions',
    ]);
  });

  it('shows for a living adult, with no death year', async () => {
    const { panel } = await panelFor(ADMIN, 'rosa');
    expect(link(panel)!.getAttribute('href')).toBe(
      'https://www.familysearch.org/en/search/record/results?count=20&q.birthLikeDate.from=1934&q.givenName=Rosa&q.surname=Hale',
    );
  });

  it('does not show for a living person under 18', async () => {
    // In mid-2017 Ben (born 2000) is 16 or 17, and Marcus (born 1988) is an adult.
    vi.setSystemTime(new Date(2017, 5, 1, 12));
    expect(link((await panelFor(ADMIN, 'ben')).panel)).toBeNull();
    cleanup();
    expect(link((await panelFor(ADMIN, 'marcus')).panel)).toBeTruthy();
  });
});
