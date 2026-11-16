// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';

let t: TestApp;
let as: Awaited<ReturnType<typeof signInAll>>;

beforeAll(async () => {
  t = await createTestApp();
  as = await signInAll(t.app, await buildFamily(t.owner));
});
afterAll(() => t.close());

const admin = 'familyadmin';
const create = (body: Record<string, unknown>) => as(admin, 'POST', '/api/people', body);

describe('second and married surnames', () => {
  it('stores both, trims them, and reads them back; blank or null means none', async () => {
    const created = await create({
      givenName: 'Lucia',
      surname: ' Ortiz ',
      secondSurname: ' Vega ',
      marriedSurname: 'Ortiz Hale',
    });
    expect(created.status).toBe(201);
    expect(created.body?.person).toMatchObject({
      surname: 'Ortiz',
      secondSurname: 'Vega',
      marriedSurname: 'Ortiz Hale',
    });
    const plain = await create({ givenName: 'Plain', surname: 'Name', secondSurname: '   ', marriedSurname: null });
    expect(plain.body?.person).toMatchObject({ secondSurname: null, marriedSurname: null });
    const absent = await create({ givenName: 'Absent', surname: 'Name' });
    expect(absent.body?.person).toMatchObject({ secondSurname: null, marriedSurname: null });
    const read = await as('user', 'GET', `/api/people/${created.body?.person.id}`);
    expect(read.body?.person).toMatchObject({ secondSurname: 'Vega', marriedSurname: 'Ortiz Hale' });
  });

  it('changes and clears them with PATCH, leaving the other fields alone', async () => {
    const id = (await create({ givenName: 'Patch', surname: 'Me' })).body?.person.id as string;
    const set = await as(admin, 'PATCH', `/api/people/${id}`, { secondSurname: 'Second', marriedSurname: 'Wed' });
    expect(set.body?.person).toMatchObject({ surname: 'Me', secondSurname: 'Second', marriedSurname: 'Wed' });
    const onlyMarried = await as(admin, 'PATCH', `/api/people/${id}`, { marriedSurname: null });
    expect(onlyMarried.body?.person).toMatchObject({ secondSurname: 'Second', marriedSurname: null });
    const cleared = await as(admin, 'PATCH', `/api/people/${id}`, { secondSurname: '' });
    expect(cleared.body?.person).toMatchObject({ secondSurname: null });
  });

  it.each([
    ['secondSurname', 'invalid_second_surname'],
    ['marriedSurname', 'invalid_married_surname'],
  ])('refuses a %s that is too long or has control characters', async (field, code) => {
    const tooLong = await create({ givenName: 'X', surname: 'Y', [field]: 'a'.repeat(101) });
    expect(tooLong).toMatchObject({ status: 400, body: { error: code } });
    const control = await create({ givenName: 'X', surname: 'Y', [field]: 'bad\u0007name' });
    expect(control).toMatchObject({ status: 400, body: { error: code } });
    const id = (await create({ givenName: 'Ok', surname: 'Fine' })).body?.person.id as string;
    expect(await as(admin, 'PATCH', `/api/people/${id}`, { [field]: 'a'.repeat(101) })).toMatchObject({
      status: 400,
      body: { error: code },
    });
  });

  it('lets a Member change the married surname of their own person, not of anyone else', async () => {
    const me = (await as('member', 'GET', '/api/auth/me')).body?.user.personId as string;
    const own = await as('member', 'PATCH', `/api/people/${me}`, { marriedSurname: 'Hale-Nair' });
    expect(own.status).toBe(200);
    const other = (await create({ givenName: 'Not', surname: 'Mine' })).body?.person.id as string;
    expect((await as('member', 'PATCH', `/api/people/${other}`, { marriedSurname: 'No' })).status).toBe(403);
    expect((await as('user', 'PATCH', `/api/people/${me}`, { marriedSurname: 'No' })).status).toBe(403);
  });
});

describe('search and order with three surnames', () => {
  const found = async (q: string) =>
    (
      (await as('user', 'GET', `/api/people?q=${encodeURIComponent(q)}`)).body?.items as Array<{ givenName: string }>
    ).map((p) => p.givenName);

  it('finds a person by the second surname and by the married surname, ignoring accents and case', async () => {
    await create({ givenName: 'Searchable', surname: 'Prime', secondSurname: 'Segunda', marriedSurname: 'Casada' });
    await create({ givenName: 'Other', surname: 'Prime', secondSurname: 'Different' });
    expect(await found('segúnda')).toEqual(['Searchable']);
    expect(await found('CASADA')).toEqual(['Searchable']);
    expect(await found('searchable casada')).toEqual(['Searchable']);
    expect(await found('prime')).toEqual(expect.arrayContaining(['Searchable', 'Other']));
  });

  it('sorts by surname, then second surname (none first), then given name, and pages through that order', async () => {
    for (const [given, second] of [
      ['Beta', 'Zeta'],
      ['Alpha', 'Zeta'],
      ['Gamma', null],
      ['Delta', 'Alfa'],
      ['Epsilon', null],
    ] as const) {
      await create({ givenName: given, surname: 'Sortfam', ...(second ? { secondSurname: second } : {}) });
    }
    const all: string[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const response = await as('user', 'GET', `/api/people?q=sortfam&limit=2${cursor}`);
      all.push(...(response.body?.items as Array<{ givenName: string }>).map((p) => p.givenName));
      if (!response.body?.nextCursor) break;
      cursor = `&cursor=${encodeURIComponent(response.body.nextCursor as string)}`;
    }
    expect(all).toEqual(['Epsilon', 'Gamma', 'Delta', 'Alpha', 'Beta']);
  });

  it('refuses a cursor in the old shape', async () => {
    const old = Buffer.from(JSON.stringify(['Hale', 'Daniel', '00000000-0000-0000-0000-000000000000'])).toString(
      'base64url',
    );
    expect((await as('user', 'GET', `/api/people?cursor=${old}`)).body?.error).toBe('invalid_cursor');
  });
});
