// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, signInAll } from './helpers/family.js';
import type { Family } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

const create = (body: Record<string, unknown>) => as('familyadmin', 'POST', '/api/people', body);
const names = async (q: string) =>
  (
    (await as('user', 'GET', `/api/people?q=${encodeURIComponent(q)}`)).body?.items as Array<{
      givenName: string;
      surname: string;
    }>
  ).map((p) => `${p.givenName} ${p.surname}`);

describe('prefix, suffix and nickname (ADR 0024; the particle folded into the surname by ADR 0038)', () => {
  it('stores, trims and reads back all three; blank or null means none', async () => {
    const created = await create({
      givenName: 'Beatriz',
      surname: ' de la Cruz ',
      namePrefix: ' Dra. ',
      nameSuffix: ' Jr. ',
      nickname: ' Bea ',
    });
    expect(created.status).toBe(201);
    expect(created.body?.person).toMatchObject({
      surname: 'de la Cruz',
      namePrefix: 'Dra.',
      nameSuffix: 'Jr.',
      nickname: 'Bea',
    });
    expect(created.body?.person).not.toHaveProperty('surnameParticle');
    const plain = await create({
      givenName: 'Plain',
      surname: 'Name',
      namePrefix: '  ',
      nickname: null,
    });
    expect(plain.body?.person).toMatchObject({
      namePrefix: null,
      nameSuffix: null,
      nickname: null,
    });
    const read = await as('user', 'GET', `/api/people/${created.body?.person.id}`);
    expect(read.body?.person).toMatchObject({ namePrefix: 'Dra.', surname: 'de la Cruz', nickname: 'Bea' });
    expect(read.body?.person).not.toHaveProperty('surnameParticle');
  });

  it('changes and clears each with PATCH and leaves the other fields alone', async () => {
    const id = (await create({ givenName: 'Daniel', surname: 'Hale' })).body?.person.id as string;
    const set = await as('familyadmin', 'PATCH', `/api/people/${id}`, { nickname: 'Danny', nameSuffix: 'Sr.' });
    expect(set.body?.person).toMatchObject({ givenName: 'Daniel', nickname: 'Danny', nameSuffix: 'Sr.' });
    const cleared = await as('familyadmin', 'PATCH', `/api/people/${id}`, { nickname: '' });
    expect(cleared.body?.person).toMatchObject({ nickname: null, nameSuffix: 'Sr.' });
  });

  it('refuses a value over its limit (30, 30, 100) or with control characters, with that field’s code', async () => {
    const base = { givenName: 'Limit', surname: 'Test' };
    const cases = [
      ['namePrefix', 'x'.repeat(31), 'invalid_name_prefix'],
      ['nameSuffix', 'x'.repeat(31), 'invalid_name_suffix'],
      ['nickname', 'x'.repeat(101), 'invalid_nickname'],
      ['nickname', 'Da\nnny', 'invalid_nickname'],
    ] as const;
    for (const [field, value, code] of cases) {
      expect(await create({ ...base, [field]: value }), `${field}=${value.length}`).toMatchObject({
        status: 400,
        body: { error: code },
      });
    }
    for (const [field, ok] of [
      ['namePrefix', 30],
      ['nameSuffix', 30],
      ['nickname', 100],
    ] as const) {
      expect((await create({ ...base, [field]: 'x'.repeat(ok) })).status, field).toBe(201);
    }
  });

  it('is searchable by nickname, a particle in the surname, prefix, suffix, and still by every other part', async () => {
    await create({
      givenName: 'Margarita',
      surname: 'van Zapata',
      namePrefix: 'Dr.',
      nameSuffix: 'III',
      nickname: 'Maggie',
      secondSurname: 'Quiroga',
      marriedSurname: 'Zapata Fox',
    });
    for (const q of ['maggie', 'MAGGIE', 'van zapata', 'dr margarita', 'iii', 'quiroga', 'fox', 'margarita zapata']) {
      expect(await names(q), q).toEqual(['Margarita van Zapata']);
    }
    // Accents are ignored, as before.
    await create({ givenName: 'José', surname: 'Peña', nickname: 'Pepé' });
    expect(await names('pepe')).toEqual(['José Peña']);
    expect(await names('jose pena')).toEqual(['José Peña']);
  });

  it('sorts a surname with a particle as written: "de la Cruz" comes under D (ADR 0038)', async () => {
    await create({ givenName: 'Aaa', surname: 'de la Cruz' });
    await create({ givenName: 'Ccc', surname: 'Cruz' });
    const all = ((await as('user', 'GET', '/api/people?limit=100')).body?.items as Array<{ surname: string }>).map(
      (p) => p.surname,
    );
    // Before 0024 the particle was ignored and "de la Cruz" sorted with "Cruz" by given name (Aaa first). Now the
    // particle's letter counts, under any collation.
    expect(all.indexOf('Cruz')).toBeLessThan(all.indexOf('de la Cruz'));
  });

  it('refuses surnameParticle in a create or a change: the field is gone (ADR 0038)', async () => {
    const created = await create({ givenName: 'Old', surname: 'Client', surnameParticle: 'de' });
    expect(created).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    const changed = await as('familyadmin', 'PATCH', `/api/people/${f.person.walter}`, { surnameParticle: 'de' });
    expect(changed).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });

  it('follows the usual permissions: a User cannot write, and a Member writes only in their own line', async () => {
    expect((await as('user', 'POST', '/api/people', { givenName: 'X', surname: 'Y', nickname: 'Z' })).status).toBe(403);
    const marcus = f.person.marcus;
    const own = await as('member', 'PATCH', `/api/people/${marcus}`, { nickname: 'Marc' });
    expect(own.status).toBe(200);
    const other = await as('member', 'PATCH', `/api/people/${f.person.walter}`, { nickname: 'Wally' });
    expect(other.status).toBe(403);
    const stored = await sql`select nickname from people where id = ${f.person.walter}`.execute(t.owner);
    expect(stored.rows).toEqual([{ nickname: null }]);
  });

  it('is enforced by the database too: the app role may write the columns, the CHECKs refuse bad text', async () => {
    const me = f.account.familyadmin.id;
    await withUserTransaction(t.db, me, (trx) =>
      sql`update people set name_prefix = 'Sir', surname_particle = 'de' where id = ${f.person.walter}`.execute(trx),
    );
    for (const bad of [
      sql`update people set name_prefix = ' Sir' where id = ${f.person.walter}`,
      sql`update people set name_suffix = '' where id = ${f.person.walter}`,
      sql`update people set nickname = ${'x'.repeat(101)} where id = ${f.person.walter}`,
      sql`update people set surname_particle = ${'x'.repeat(31)} where id = ${f.person.walter}`,
    ]) {
      await expect(withUserTransaction(t.db, me, (trx) => bad.execute(trx))).rejects.toThrow(/check constraint/);
    }
  });

  it('a placeholder cannot carry a prefix, suffix, nickname or particle', async () => {
    for (const column of ['name_prefix', 'name_suffix', 'nickname', 'surname_particle']) {
      await expect(
        sql`insert into people (given_name, surname, gender, is_placeholder, ${sql.id(column)})
            values ('', '', 'male', true, 'x')`.execute(t.owner),
        column,
      ).rejects.toThrow(/people_placeholder_is_blank/);
    }
  });
});
