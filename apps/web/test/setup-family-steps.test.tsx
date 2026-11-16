// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calls } from './helpers.js';
import { GOOD, field, fillAccount, next, openSetup, progress, toYou, type } from './setup-helpers.js';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const skip = () => fireEvent.click(screen.getByRole('button', { name: 'Skip this step' }));
const choose = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create my tree' }));
const heading = (name: string) => screen.findByRole('heading', { name });
const inGroup = (group: string) => within(screen.getByRole('group', { name: group }));

/** The request the page sent to POST /api/setup. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/setup');
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

async function toPartner(extra = {}) {
  const fetchMock = await toYou(extra);
  next();
  await heading('Add your spouse or partner');
  return fetchMock;
}

async function toParents(extra = {}) {
  const fetchMock = await toPartner(extra);
  skip();
  await heading('Add your parents');
  return fetchMock;
}

async function toChildren(extra = {}) {
  const fetchMock = await toParents(extra);
  skip();
  await heading('Add your children');
  return fetchMock;
}

describe('step 4, Partner', () => {
  it('can be skipped, and the progress reads Step 4 of 7', async () => {
    await toPartner();
    expect(progress()).toBe('Step 4 of 7 · Partner');
    expect(screen.getByRole('button', { name: 'Skip this step' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });

  it('offers the six statuses with Married first, and a married surname only for Married and Widowed', async () => {
    await toPartner();
    expect(
      within(field('Relationship'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Married', 'Engaged', 'Partner', 'Separated', 'Divorced', 'Widowed']);
    expect(field('Relationship').value).toBe('married');
    expect(screen.getByLabelText('Married surname (optional)')).toBeTruthy();
    choose('Relationship', 'divorced');
    expect(screen.queryByLabelText('Married surname (optional)')).toBeNull();
    choose('Relationship', 'widowed');
    expect(screen.getByLabelText('Married surname (optional)')).toBeTruthy();
  });

  it('with nothing typed, Next means no partner', async () => {
    await toPartner();
    next();
    await heading('Add your parents');
  });

  it('needs both names once one is typed, and says so per field', async () => {
    await toPartner();
    type('Given name', 'Priya');
    next();
    expect(await screen.findByText('Enter a surname (up to 100 characters).')).toBeTruthy();
    expect(document.activeElement).toBe(field('Birth (maiden) surname'));
    expect(progress()).toBe('Step 4 of 7 · Partner');
  });

  it('says at once that Widowed needs Deceased, and does not move on until it is fixed', async () => {
    await toPartner();
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    choose('Relationship', 'widowed');
    expect(
      screen.getByText('Widowed needs someone who has died. Choose Deceased, or another relationship.'),
    ).toBeTruthy();
    next();
    expect(progress()).toBe('Step 4 of 7 · Partner');
    expect(document.activeElement).toBe(field('Living or deceased'));
    choose('Living or deceased', 'deceased');
    next();
    await heading('Add your parents');
  });

  it('says Married and deceased is recorded as Widowed', async () => {
    await toPartner();
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    expect(screen.queryByText(/recorded as Widowed/)).toBeNull();
    choose('Living or deceased', 'deceased');
    expect(screen.getByText('Married and deceased is recorded as Widowed, set automatically.')).toBeTruthy();
  });

  it('Back keeps what was typed, and Skip clears it silently', async () => {
    await toPartner();
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    next();
    await heading('Add your parents');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Add your spouse or partner');
    expect(field('Given name').value).toBe('Priya');
    skip();
    await heading('Add your parents');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Add your spouse or partner');
    expect(field('Given name').value).toBe('');
  });
});

describe('step 5, Parents', () => {
  it('prefills the father with your surname and the mother with nothing, and shows no relationship yet', async () => {
    await toParents();
    expect((inGroup('Father').getByLabelText('Surname') as HTMLInputElement).value).toBe('Hale');
    expect((inGroup('Mother').getByLabelText('Birth surname') as HTMLInputElement).value).toBe('');
    expect(screen.queryByLabelText('Their relationship')).toBeNull();
    // No death dates here: living or deceased only.
    expect(screen.queryByLabelText(/date of death/i)).toBeNull();
  });

  it('shows "Their relationship" only when both parents are entered, defaulting to Married', async () => {
    await toParents();
    fireEvent.change(inGroup('Father').getByLabelText('Given name'), { target: { value: 'Daniel' } });
    expect(screen.queryByLabelText('Their relationship')).toBeNull();
    fireEvent.change(inGroup('Mother').getByLabelText('Given name'), { target: { value: 'Elena' } });
    fireEvent.change(inGroup('Mother').getByLabelText('Birth surname'), { target: { value: 'Ruiz' } });
    expect(field('Their relationship').value).toBe('married');
    choose('Their relationship', 'widowed');
    expect(screen.getByText(/Widowed needs a parent who has died/)).toBeTruthy();
    next();
    expect(progress()).toBe('Step 5 of 7 · Parents');
    fireEvent.change(inGroup('Father').getByLabelText('Status'), { target: { value: 'deceased' } });
    next();
    await heading('Add your children');
  });

  it('a parent with a given name needs a surname, per field', async () => {
    await toParents();
    fireEvent.change(inGroup('Mother').getByLabelText('Given name'), { target: { value: 'Elena' } });
    next();
    expect(await screen.findByText('Enter a surname (up to 100 characters).')).toBeTruthy();
    expect(document.activeElement).toBe(inGroup('Mother').getByLabelText('Birth surname'));
  });
});

describe('step 6, Children', () => {
  it('starts with one empty row, and has no other-parent choice without a partner', async () => {
    await toChildren();
    expect(progress()).toBe('Step 6 of 7 · Children');
    expect(screen.getByText(/No partner was added, so children hang from you alone/)).toBeTruthy();
    expect(screen.queryByLabelText('Other parent')).toBeNull();
    expect((screen.getByLabelText('Surname') as HTMLInputElement).value).toBe('Hale');
  });

  it('adds and removes rows, and keeps what is typed in the others', async () => {
    await toChildren();
    fireEvent.change(screen.getByLabelText('Given name'), { target: { value: 'Leo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another child' }));
    expect(screen.getAllByRole('group', { name: /^Child \d$/ })).toHaveLength(2);
    expect(document.activeElement).toBe(inGroup('Child 2').getByLabelText('Given name'));
    fireEvent.change(inGroup('Child 2').getByLabelText('Given name'), { target: { value: 'Mia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove child 1' }));
    const rows = screen.getAllByRole('group', { name: /^Child \d$/ });
    expect(rows).toHaveLength(1);
    expect((within(rows[0] as HTMLElement).getByLabelText('Given name') as HTMLInputElement).value).toBe('Mia');
    // Removing the last row leaves one empty row, never none.
    fireEvent.click(screen.getByRole('button', { name: 'Remove child 1' }));
    expect(screen.getAllByRole('group', { name: /^Child \d$/ })).toHaveLength(1);
    expect((screen.getByLabelText('Given name') as HTMLInputElement).value).toBe('');
  });

  it('stops at 30 children', async () => {
    await toChildren();
    for (let i = 0; i < 29; i++) fireEvent.click(screen.getByRole('button', { name: 'Add another child' }));
    expect(screen.getAllByRole('group', { name: /^Child \d+$/ })).toHaveLength(30);
    expect((screen.getByRole('button', { name: 'Add another child' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/That is the most the wizard takes \(30\)/)).toBeTruthy();
  });

  it('ignores empty rows, checks the others per row, and names the row in the error', async () => {
    await toChildren();
    fireEvent.click(screen.getByRole('button', { name: 'Add another child' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add another child' }));
    fireEvent.change(inGroup('Child 1').getByLabelText('Given name'), { target: { value: 'Leo' } });
    // The second row is left empty; the third has a bad birth date and no name.
    fireEvent.change(inGroup('Child 3').getByLabelText('Birth date'), { target: { value: '2019-13' } });
    next();
    await screen.findByText('Enter a date as YYYY, YYYY-MM or YYYY-MM-DD. The day and month must exist.');
    expect(inGroup('Child 3').getByText('Enter a given name (up to 100 characters).')).toBeTruthy();
    expect(inGroup('Child 2').queryByText(/Enter a/)).toBeNull();
    expect(inGroup('Child 1').queryByText(/Enter a/)).toBeNull();
    expect(document.activeElement).toBe(inGroup('Child 3').getByLabelText('Given name'));
  });

  it('with a partner, offers the partner (default) or "Not on the tree" for each child, and sends it', async () => {
    const fetchMock = await toPartner();
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    next();
    await heading('Add your parents');
    skip();
    await heading('Add your children');
    expect(screen.getByText(/Priya Nair is the default other parent/)).toBeTruthy();
    expect(
      within(field('Other parent'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Priya Nair', 'Not on the tree']);
    expect(field('Other parent').value).toBe('partner');
    type('Given name', 'Leo');
    fireEvent.click(screen.getByRole('button', { name: 'Add another child' }));
    fireEvent.change(inGroup('Child 2').getByLabelText('Given name'), { target: { value: 'Mia' } });
    fireEvent.change(inGroup('Child 2').getByLabelText('Other parent'), { target: { value: 'none' } });
    next();
    await heading('Check your tree');
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
    const family = sentBody(fetchMock)['family'] as { children: unknown[] };
    expect(family.children).toEqual([
      { givenName: 'Leo', surname: 'Hale', otherParent: 'partner' },
      { givenName: 'Mia', surname: 'Hale', otherParent: 'none' },
    ]);
  });

  it('turns a child of the partner into "not on the tree" when the partner is skipped afterwards', async () => {
    const fetchMock = await toPartner();
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    next();
    await heading('Add your parents');
    skip();
    await heading('Add your children');
    type('Given name', 'Leo');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Add your parents');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Add your spouse or partner');
    skip();
    await heading('Add your parents');
    skip();
    await heading('Add your children');
    expect(screen.queryByLabelText('Other parent')).toBeNull();
    next();
    await heading('Check your tree');
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
    const family = sentBody(fetchMock)['family'] as { partner?: unknown; children: unknown[] };
    expect(family.partner).toBeUndefined();
    expect(family.children).toEqual([{ givenName: 'Leo', surname: 'Hale', otherParent: 'none' }]);
  });
});

describe('warnings are soft', () => {
  async function withYouBorn(birth: string) {
    const fetchMock = await openSetup();
    fillAccount();
    next();
    await heading('Name your first tree');
    next();
    await heading('Start with you');
    type('Birth date', birth);
    next();
    await heading('Add your spouse or partner');
    skip();
    await heading('Add your parents');
    skip();
    await heading('Add your children');
    return fetchMock;
  }

  it('warns, inline and on Review, when a child is less than 12 years younger than you, and still goes on', async () => {
    const fetchMock = await withYouBorn('2000');
    type('Given name', 'Leo');
    type('Birth date', '2006');
    expect(
      screen.getByText('Marcus Hale is only 6 years older than Leo Hale. Check the birth years. You can still go on.'),
    ).toBeTruthy();
    next();
    await heading('Check your tree');
    const warnings = screen.getByRole('region', { name: 'Things to check' });
    expect(within(warnings).getByText(/Marcus Hale is only 6 years older than Leo Hale/)).toBeTruthy();
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
  });

  it('counts a child born before you', async () => {
    await withYouBorn('2000');
    type('Given name', 'Leo');
    type('Birth date', '1990');
    expect(
      screen.getByText('Leo Hale is born before Marcus Hale. Check the birth years. You can still go on.'),
    ).toBeTruthy();
  });

  it('is quiet at exactly 12 years', async () => {
    await withYouBorn('2000');
    type('Given name', 'Leo');
    type('Birth date', '2012');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('notes two people with the same name and birth date, and does not block', async () => {
    await withYouBorn('2000');
    type('Given name', 'Marcus');
    type('Birth date', '2000');
    expect(
      screen.getByText(
        'Same name and birth date as Marcus Hale. Is this the same person entered twice? You can still go on.',
      ),
    ).toBeTruthy();
    next();
    await heading('Check your tree');
    expect(screen.getByRole('region', { name: 'Things to check' })).toBeTruthy();
  });
});

describe('Review shows the whole family in words', () => {
  async function fullFamily() {
    const fetchMock = await toYou();
    type('Birth date', '1986-07-31');
    choose('Gender', 'male');
    next();
    await heading('Add your spouse or partner');
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    type('Married surname (optional)', 'Hale');
    choose('Gender', 'female');
    next();
    await heading('Add your parents');
    fireEvent.change(inGroup('Father').getByLabelText('Given name'), { target: { value: 'Daniel' } });
    fireEvent.change(inGroup('Father').getByLabelText('Status'), { target: { value: 'deceased' } });
    fireEvent.change(inGroup('Mother').getByLabelText('Given name'), { target: { value: 'Elena' } });
    fireEvent.change(inGroup('Mother').getByLabelText('Birth surname'), { target: { value: 'Ruiz' } });
    next();
    await heading('Add your children');
    type('Given name', 'Leo');
    type('Birth date', '2017-04-09');
    choose('Gender', 'male');
    next();
    await heading('Check your tree');
    return fetchMock;
  }

  it('lists each person with the relationship in words, deceased markers and the other parent', async () => {
    await fullFamily();
    const partner = screen.getByRole('region', { name: 'Partner' });
    expect(partner.textContent).toContain('Priya Nair, your wife');
    const parents = screen.getByRole('region', { name: 'Parents' });
    expect(parents.textContent).toContain('Daniel Hale, your father');
    expect(parents.textContent).toContain('deceased');
    expect(parents.textContent).toContain('Elena Ruiz, your mother');
    const children = screen.getByRole('region', { name: 'Children' });
    expect(children.textContent).toContain('Leo Hale, your son');
    expect(children.textContent).toContain('born Apr 9, 2017');
    expect(children.textContent).toContain('with Priya Nair');
    expect(screen.getByText('5 people on the tree')).toBeTruthy();
  });

  it('says the Widowed outcome: Married with a deceased parent becomes Widowed, set automatically', async () => {
    await fullFamily();
    const parents = screen.getByRole('region', { name: 'Parents' });
    expect(parents.textContent).toContain(
      'Daniel Hale and Elena Ruiz: recorded as Widowed, set automatically because someone is deceased.',
    );
    const partner = screen.getByRole('region', { name: 'Partner' });
    expect(partner.textContent).toContain('Marcus Hale and Priya Nair: recorded as Married.');
  });

  it('has a Change button for each section that goes back to that step', async () => {
    await fullFamily();
    fireEvent.click(screen.getByRole('button', { name: 'Change Parents' }));
    await heading('Add your parents');
    expect(inGroup('Father').getByLabelText('Given name')).toBeTruthy();
  });

  it('carries the update-check note, and the invite line instead of Authentik', async () => {
    await fullFamily();
    expect(
      screen.getByText(
        /Once a day KinShip reads the public release list on GitHub and tells the SuperAdmin when a new version is out\. It sends nothing about your install\. Turn it off any time in Admin → Updates\./,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Next: invite relatives under Admin → Users, so they can add their own branches.'),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Authentik|rename it later|more trees/i);
  });

  it('sends the whole family in one request', async () => {
    const fetchMock = await fullFamily();
    create();
    await waitFor(() => expect(calls(fetchMock)).toContain('POST /api/setup'));
    expect(sentBody(fetchMock)).toEqual({
      token: 'tok-secret-123',
      displayName: 'Marcus Hale',
      email: 'marcus@example.com',
      password: GOOD,
      treeName: 'Hale Family',
      settings: { colorScheme: 'forest' },
      family: {
        you: {
          givenName: 'Marcus',
          surname: 'Hale',
          birth: { value: '1986-07-31', precision: 'exactly' },
          gender: 'male',
        },
        partner: { status: 'married', givenName: 'Priya', surname: 'Nair', marriedSurname: 'Hale', gender: 'female' },
        parents: {
          father: { givenName: 'Daniel', surname: 'Hale', deceased: true },
          mother: { givenName: 'Elena', surname: 'Ruiz' },
          status: 'married',
        },
        children: [
          {
            givenName: 'Leo',
            surname: 'Hale',
            birth: { value: '2017-04-09', precision: 'exactly' },
            gender: 'male',
            otherParent: 'partner',
          },
        ],
      },
    });
  });
});

describe('what the server says about the family, mapped to its step and field', () => {
  async function review(answer: Record<string, unknown>) {
    await toYou({ 'POST /api/setup': { status: 400, body: answer } });
    next();
    await heading('Add your spouse or partner');
    type('Given name', 'Priya');
    type('Birth (maiden) surname', 'Nair');
    next();
    await heading('Add your parents');
    skip();
    await heading('Add your children');
    type('Given name', 'Leo');
    fireEvent.click(screen.getByRole('button', { name: 'Add another child' }));
    fireEvent.change(inGroup('Child 2').getByLabelText('Given name'), { target: { value: 'Mia' } });
    next();
    await heading('Check your tree');
    create();
  }

  it('family.children.1.birth: back to the children step, with that row marked and focused', async () => {
    await review({ error: 'invalid_date', field: 'family.children.1.birth' });
    await heading('Add your children');
    expect(inGroup('Child 2').getByText(/Enter a date as/)).toBeTruthy();
    const birth = inGroup('Child 2').getByLabelText('Birth date');
    expect(birth.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(birth);
    expect((inGroup('Child 1').getByLabelText('Given name') as HTMLInputElement).value).toBe('Leo');
    expect(progress()).toBe('Step 6 of 7 · Children');
  });

  it('family.partner.deceased: back to the partner step', async () => {
    await review({ error: 'widowed_needs_deceased', field: 'family.partner.deceased' });
    await heading('Add your spouse or partner');
    expect(screen.getByText(/Widowed needs someone who has died/)).toBeTruthy();
    expect(field('Given name').value).toBe('Priya');
  });

  it('family.parents.status: back to the parents step', async () => {
    await review({ error: 'invalid_union_status', field: 'family.parents.status' });
    await heading('Add your parents');
    expect(progress()).toBe('Step 5 of 7 · Parents');
  });

  it('family.children: too many children goes to the children step with a message', async () => {
    await review({ error: 'too_many_children', field: 'family.children' });
    await heading('Add your children');
    expect(progress()).toBe('Step 6 of 7 · Children');
  });
});
