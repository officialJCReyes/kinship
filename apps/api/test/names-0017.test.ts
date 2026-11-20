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

describe('prefix, suffix, nickname and surname particle (ADR 0024)', () => {
  it('stores, trims and reads back all four; blank or null means none', async () => {
    const created = await create({
      givenName: 'Beatriz',
      surname: ' Cruz ',
      namePrefix: ' Dra. ',
      nameSuffix: ' Jr. ',
      nickname: ' Bea ',
      surnameParticle: ' de la ',
    });
    expect(created.status).toBe(201);
    expect(created.body?.person).toMatchObject({
      surname: 'Cruz',
      namePrefix: 'Dra.',
      nameSuffix: 'Jr.',
      nickname: 'Bea',
      surnameParticle: 'de la',
    });
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
      surnameParticle: null,
    });
    const read = await as('user', 'GET', `/api/people/${created.body?.person.id}`);
    expect(read.body?.person).toMatchObject({ namePrefix: 'Dra.', surnameParticle: 'de la', nickname: 'Bea' });
  });

  it('changes and clears each with PATCH and leaves the other fields alone', async () => {
    const id = (await create({ givenName: 'Daniel', surname: 'Hale' })).body?.person.id as string;
    const set = await as('familyadmin', 'PATCH', `/api/people/${id}`, { nickname: 'Danny', nameSuffix: 'Sr.' });
    expect(set.body?.person).toMatchObject({ givenName: 'Daniel', nickname: 'Danny', nameSuffix: 'Sr.' });
    const cleared = await as('familyadmin', 'PATCH', `/api/people/${id}`, { nickname: '' });
    expect(cleared.body?.person).toMatchObject({ nickname: null, nameSuffix: 'Sr.' });
  });

  it('refuses a value over its limit (30, 30, 100, 30) or with control characters, with that field’s code', async () => {
    const base = { givenName: 'Limit', surname: 'Test' };
    const cases = [
      ['namePrefix', 'x'.repeat(31), 'invalid_name_prefix'],
      ['nameSuffix', 'x'.repeat(31), 'invalid_name_suffix'],
      ['nickname', 'x'.repeat(101), 'invalid_nickname'],
      ['surnameParticle', 'x'.repeat(31), 'invalid_surname_particle'],
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
      ['surnameParticle', 30],
    ] as const) {
      expect((await create({ ...base, [field]: 'x'.repeat(ok) })).status, field).toBe(201);
    }
  });

  it('is searchable by nickname, particle, prefix, suffix, and still by every other part', async () => {
    await create({
      givenName: 'Margarita',
      surname: 'Zapata',
      namePrefix: 'Dr.',
      nameSuffix: 'III',
      nickname: 'Maggie',
      surnameParticle: 'van',
      secondSurname: 'Quiroga',
      marriedSurname: 'Zapata Fox',
    });
    for (const q of ['maggie', 'MAGGIE', 'van zapata', 'dr margarita', 'iii', 'quiroga', 'fox', 'margarita zapata']) {
      expect(await names(q), q).toEqual(['Margarita Zapata']);
    }
    // Accents are ignored, as before.
    await create({ givenName: 'José', surname: 'Peña', nickname: 'Pepé' });
    expect(await names('pepe')).toEqual(['José Peña']);
    expect(await names('jose pena')).toEqual(['José Peña']);
  });

  it('sorts by the bare surname: the particle is ignored', async () => {
    await create({ givenName: 'Aaa', surname: 'Cruz', surnameParticle: 'de la' });
    await create({ givenName: 'Bbb', surname: 'Alba' });
    const all = ((await as('user', 'GET', '/api/people?limit=100')).body?.items as Array<{ surname: string }>).map(
      (p) => p.surname,
    );
    expect(all.indexOf('Alba')).toBeLessThan(all.indexOf('Cruz'));
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
