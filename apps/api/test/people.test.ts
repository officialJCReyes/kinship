// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, signInAll } from './helpers/family.js';
import type { Family } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const ids = (list: Array<{ id: string }> | undefined) => (list ?? []).map((c) => c.id);

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

const admin = 'familyadmin';

describe('people: create, read, change', () => {
  it('creates a person with typed dates and precision, and reads it back', async () => {
    const created = await as(admin, 'POST', '/api/people', {
      givenName: '  Ana ',
      surname: 'Méndez',
      gender: 'female',
      birth: { value: '1950-03', precision: 'about' },
    });
    expect(created.status).toBe(201);
    expect(created.body?.person).toMatchObject({
      givenName: 'Ana',
      surname: 'Méndez',
      gender: 'female',
      birth: { value: '1950-03', precision: 'about' },
      deceased: false,
      death: null,
    });
    const read = await as('user', 'GET', `/api/people/${created.body?.person.id}`);
    expect(read.status).toBe(200);
    expect(read.body?.person.birth).toEqual({ value: '1950-03', precision: 'about' });
    expect(read.body?.parents).toEqual({ birth: null, adoptive: null });
    expect(read.body?.unions).toEqual([]);
  });

  it('stores the typed date as typed and fills the sortable range', async () => {
    const created = await as(admin, 'POST', '/api/people', {
      givenName: 'Date',
      surname: 'Test',
      birth: { value: '1955-02' },
    });
    const id = created.body?.person.id as string;
    expect(created.body?.person.birth).toEqual({ value: '1955-02', precision: 'exactly' });
    const row = await sql<{ birth_from: string; birth_to: string }>`
      select birth_from::text, birth_to::text from people where id = ${id}`.execute(t.owner);
    expect(row.rows[0]).toEqual({ birth_from: '1955-02-01', birth_to: '1955-02-28' });
  });

  it.each([
    ['2023-02-30', 'a day that does not exist'],
    ['2023-13', 'a month that does not exist'],
    ['1955-6-4', 'the wrong format'],
    ['0000', 'year zero'],
    ['195', 'a short year'],
    ['1955-06-04T00:00', 'a timestamp'],
  ])('refuses the date %s (%s)', async (value) => {
    const response = await as(admin, 'POST', '/api/people', { givenName: 'A', surname: 'B', birth: { value } });
    expect(response).toMatchObject({ status: 400, body: { error: 'invalid_date' } });
  });

  it('accepts 29 February in a leap year only', async () => {
    const ok = await as(admin, 'POST', '/api/people', { givenName: 'A', surname: 'B', birth: { value: '2024-02-29' } });
    expect(ok.status).toBe(201);
    const bad = await as(admin, 'POST', '/api/people', {
      givenName: 'A',
      surname: 'B',
      birth: { value: '2023-02-29' },
    });
    expect(bad.body?.error).toBe('invalid_date');
  });

  it('refuses an unknown precision, gender or a missing name', async () => {
    expect(
      (
        await as(admin, 'POST', '/api/people', {
          givenName: 'A',
          surname: 'B',
          birth: { value: '1950', precision: 'roughly' },
        })
      ).body?.error,
    ).toBe('invalid_precision');
    expect(
      (await as(admin, 'POST', '/api/people', { givenName: 'A', surname: 'B', gender: 'robot' })).body?.error,
    ).toBe('invalid_gender');
    expect((await as(admin, 'POST', '/api/people', { givenName: '   ', surname: 'B' })).body?.error).toBe(
      'invalid_given_name',
    );
    expect((await as(admin, 'POST', '/api/people', { givenName: 'A', surname: '' })).body?.error).toBe(
      'invalid_surname',
    );
    expect((await as(admin, 'POST', '/api/people', { givenName: 'A', surname: 'x'.repeat(101) })).body?.error).toBe(
      'invalid_surname',
    );
    expect((await as(admin, 'POST', '/api/people', { givenName: 'A' })).body?.error).toBe('invalid_request');
    expect((await as(admin, 'POST', '/api/people', { givenName: 'A', surname: 'B', extra: 1 })).body?.error).toBe(
      'invalid_request',
    );
  });

  it('refuses a death date for someone who is not deceased', async () => {
    const response = await as(admin, 'POST', '/api/people', {
      givenName: 'A',
      surname: 'B',
      deceased: false,
      death: { value: '2001' },
    });
    expect(response.body?.error).toBe('invalid_date');
  });

  it('a death date makes the person deceased; marking them living again clears it', async () => {
    const created = await as(admin, 'POST', '/api/people', {
      givenName: 'Old',
      surname: 'Timer',
      death: { value: '1999-12-31' },
    });
    const id = created.body?.person.id as string;
    expect(created.body?.person).toMatchObject({
      deceased: true,
      death: { value: '1999-12-31', precision: 'exactly' },
    });
    const living = await as(admin, 'PATCH', `/api/people/${id}`, { deceased: false });
    expect(living.body?.person).toMatchObject({ deceased: false, death: null });
  });

  it('changes only what the patch names, and an empty patch is refused', async () => {
    const created = await as(admin, 'POST', '/api/people', {
      givenName: 'Pat',
      surname: 'Chen',
      gender: 'other',
      birth: { value: '1970' },
    });
    const id = created.body?.person.id as string;
    const changed = await as(admin, 'PATCH', `/api/people/${id}`, { surname: 'Chang' });
    expect(changed.body?.person).toMatchObject({
      givenName: 'Pat',
      surname: 'Chang',
      gender: 'other',
      birth: { value: '1970' },
    });
    const cleared = await as(admin, 'PATCH', `/api/people/${id}`, { birth: null, gender: null });
    expect(cleared.body?.person).toMatchObject({ birth: null, gender: null });
    expect((await as(admin, 'PATCH', `/api/people/${id}`, {})).status).toBe(400);
  });

  it('answers 404 for a person that does not exist or an id that is not an id', async () => {
    expect((await as(admin, 'GET', '/api/people/00000000-0000-4000-8000-000000000000')).body?.error).toBe(
      'person_not_found',
    );
    expect((await as(admin, 'GET', '/api/people/not-an-id')).body?.error).toBe('person_not_found');
    expect((await as(admin, 'PATCH', '/api/people/not-an-id', { surname: 'X' })).status).toBe(404);
  });

  it('sets created_by to the signed-in account, whatever the body says', async () => {
    const created = await as(admin, 'POST', '/api/people', { givenName: 'Who', surname: 'Made', createdBy: 'x' });
    expect(created.status).toBe(400);
    const ok = await as(admin, 'POST', '/api/people', { givenName: 'Who', surname: 'Made' });
    const row = await sql<{
      created_by: string;
    }>`select created_by from people where id = ${ok.body?.person.id}`.execute(t.owner);
    expect(row.rows[0]?.created_by).toBe(f.account.familyadmin.id);
  });
});

describe('people: list and search', () => {
  it('lists in name order and pages with a cursor', async () => {
    const first = await as('user', 'GET', '/api/people?limit=3');
    expect(first.status).toBe(200);
    expect(first.body?.items).toHaveLength(3);
    expect(first.body?.nextCursor).toEqual(expect.any(String));
    const seen = new Set<string>(first.body?.items.map((p: { id: string }) => p.id));
    let cursor = first.body?.nextCursor as string | null;
    let pages = 1;
    while (cursor) {
      const next = await as('user', 'GET', `/api/people?limit=3&cursor=${encodeURIComponent(cursor)}`);
      for (const p of next.body?.items as Array<{ id: string }>) {
        expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
      }
      cursor = next.body?.nextCursor ?? null;
      pages += 1;
    }
    expect(pages).toBeGreaterThan(2);
    const total = await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner);
    expect(seen.size).toBe(Number(total.rows[0]?.n));
  });

  it('finds people by any part of the name, ignoring case and accents, every word having to match', async () => {
    await as(admin, 'POST', '/api/people', { givenName: 'José', surname: 'Peña' });
    const names = async (q: string) =>
      (
        (await as('user', 'GET', `/api/people?q=${encodeURIComponent(q)}`)).body?.items as Array<{
          givenName: string;
          surname: string;
        }>
      ).map((p) => `${p.givenName} ${p.surname}`);
    expect(await names('jose pena')).toContain('José Peña');
    expect(await names('JOSÉ')).toContain('José Peña');
    expect(await names('mend')).toContain('Rosa Mendez');
    expect(await names('daniel hale')).toEqual(['Daniel Hale']);
    expect(await names('daniel navarro')).toEqual([]);
  });

  it('treats % and _ in a search as plain characters', async () => {
    expect((await as('user', 'GET', `/api/people?q=${encodeURIComponent('%')}`)).body?.items).toEqual([]);
    expect((await as('user', 'GET', `/api/people?q=${encodeURIComponent('_')}`)).body?.items).toEqual([]);
  });

  it('refuses a cursor that is not one, and caps the page size', async () => {
    expect((await as('user', 'GET', '/api/people?cursor=garbage')).body?.error).toBe('invalid_cursor');
    const big = await as('user', 'GET', '/api/people?limit=999');
    expect(big.status).toBe(200);
    expect(big.body?.items.length).toBeLessThanOrEqual(100);
    expect((await as('user', 'GET', '/api/people?limit=abc')).status).toBe(400);
  });
});

describe('relationships (unions)', () => {
  let a: string;
  let b: string;
  beforeAll(async () => {
    a = await insertPersonRow(t.owner, 'Una', 'Pair');
    b = await insertPersonRow(t.owner, 'Dos', 'Pair');
  });

  it('creates a union in either order and returns the same sorted pair', async () => {
    const one = await as(admin, 'POST', '/api/unions', {
      partnerIds: [b, a],
      status: 'engaged',
      start: { value: '2020-05', precision: 'about' },
    });
    expect(one.status).toBe(201);
    expect(one.body?.union.partnerIds).toEqual([a, b].sort());
    expect(one.body?.union).toMatchObject({
      status: 'engaged',
      start: { value: '2020-05', precision: 'about' },
      end: null,
      children: [],
    });
  });

  it('refuses a union of a person with themselves, with someone missing, or with a bad status', async () => {
    expect((await as(admin, 'POST', '/api/unions', { partnerIds: [a, a], status: 'married' })).body?.error).toBe(
      'partners_identical',
    );
    expect(
      (
        await as(admin, 'POST', '/api/unions', {
          partnerIds: [a, '00000000-0000-4000-8000-000000000000'],
          status: 'married',
        })
      ).body?.error,
    ).toBe('person_not_found');
    expect((await as(admin, 'POST', '/api/unions', { partnerIds: [a, b], status: 'betrothed' })).body?.error).toBe(
      'invalid_union_status',
    );
  });

  it('allows an end date only for divorced, separated and annulment', async () => {
    for (const status of ['married', 'engaged', 'partner', 'widowed', 'friends', 'unknown', 'other']) {
      const response = await as(admin, 'POST', '/api/unions', { partnerIds: [a, b], status, end: { value: '2001' } });
      expect(response, status).toMatchObject({ status: 400, body: { error: 'end_date_not_allowed' } });
    }
    for (const status of ['divorced', 'separated', 'annulment']) {
      const response = await as(admin, 'POST', '/api/unions', {
        partnerIds: [a, b],
        status,
        start: { value: `19${status.length}0` },
        end: { value: '2001-04' },
      });
      expect(response.status, status).toBe(201);
    }
  });

  it('refuses an identical relationship but allows a second one with a different status or date (remarriage)', async () => {
    const c = await insertPersonRow(t.owner, 'Tres', 'Pair');
    const d = await insertPersonRow(t.owner, 'Cuatro', 'Pair');
    const body = { partnerIds: [c, d], status: 'married', start: { value: '1990' } };
    expect((await as(admin, 'POST', '/api/unions', body)).status).toBe(201);
    expect((await as(admin, 'POST', '/api/unions', body)).body?.error).toBe('duplicate_relationship');
    expect(
      (await as(admin, 'POST', '/api/unions', { ...body, status: 'divorced', end: { value: '1995' } })).status,
    ).toBe(201);
    expect((await as(admin, 'POST', '/api/unions', { ...body, start: { value: '1999' } })).status).toBe(201);
  });

  it('changes status and dates, and refuses to keep an end date under a status that has none', async () => {
    // Two new, living people: Walter (deceased in the test family) would turn Married into Widowed.
    const one = (await as(admin, 'POST', '/api/people', { givenName: 'Status', surname: 'One' })).body?.person.id;
    const two = (await as(admin, 'POST', '/api/people', { givenName: 'Status', surname: 'Two' })).body?.person.id;
    const { union } = (await as(admin, 'POST', '/api/unions', { partnerIds: [one, two], status: 'friends' })).body as {
      union: { id: string };
    };
    const divorced = await as(admin, 'PATCH', `/api/unions/${union.id}`, {
      status: 'divorced',
      end: { value: '2010-07-01' },
    });
    expect(divorced.body?.union).toMatchObject({ status: 'divorced', end: { value: '2010-07-01' } });
    const back = await as(admin, 'PATCH', `/api/unions/${union.id}`, { status: 'married' });
    expect(back).toMatchObject({ status: 400, body: { error: 'end_date_not_allowed' } });
    const fixed = await as(admin, 'PATCH', `/api/unions/${union.id}`, { status: 'married', end: null });
    expect(fixed.body?.union).toMatchObject({ status: 'married', end: null });
  });

  it('never removes children when the status changes, and refuses to delete a union that has children', async () => {
    const before = await as('user', 'GET', `/api/unions/${f.union.danielElena}`);
    expect(ids(before.body?.union.children)).toEqual(expect.arrayContaining([f.person.marcus, f.person.sofia]));
    const changed = await as(admin, 'PATCH', `/api/unions/${f.union.danielElena}`, { status: 'separated' });
    expect(ids(changed.body?.union.children).sort()).toEqual([f.person.marcus, f.person.sofia].sort());
    const refused = await as(admin, 'DELETE', `/api/unions/${f.union.danielElena}`);
    expect(refused).toMatchObject({ status: 409, body: { error: 'union_has_children' } });
    await as(admin, 'PATCH', `/api/unions/${f.union.danielElena}`, { status: 'divorced' });
  });

  it('deletes a union without children', async () => {
    const created = await as(admin, 'POST', '/api/unions', {
      partnerIds: [f.person.priya, f.person.gabriel],
      status: 'other',
    });
    const id = created.body?.union.id as string;
    expect((await as(admin, 'DELETE', `/api/unions/${id}`)).status).toBe(204);
    expect((await as(admin, 'GET', `/api/unions/${id}`)).status).toBe(404);
  });

  it("shows a person's unions and the children hanging from each", async () => {
    const daniel = await as('user', 'GET', `/api/people/${f.person.daniel}`);
    expect(daniel.body?.unions).toHaveLength(2);
    const byId = Object.fromEntries(
      (daniel.body?.unions as Array<{ id: string; children: Array<{ id: string }> }>).map((u) => [
        u.id,
        ids(u.children),
      ]),
    );
    expect(byId[f.union.danielElena]?.sort()).toEqual([f.person.marcus, f.person.sofia].sort());
    expect(byId[f.union.danielBeatriz]).toEqual([f.person.gabriel]);
    const beatriz = await as('user', 'GET', `/api/people/${f.person.beatriz}`);
    expect(ids(beatriz.body?.singleParentChildren)).toEqual([f.person.tomas]);
    expect(beatriz.body?.unions.map((u: { id: string }) => u.id)).toEqual([f.union.danielBeatriz]);
  });
});

describe('parents', () => {
  const parentage = async (id: string) => {
    const birth = (await as('user', 'GET', `/api/people/${id}`)).body?.parents.birth;
    return birth ? { unionId: birth.unionId, parentId: birth.parentId } : null;
  };

  it('adds a child under a person alone, or under one of their unions', async () => {
    const alone = await as(admin, 'POST', `/api/people/${f.person.sofia}/children`, {
      child: { givenName: 'Alma', surname: 'Hale' },
    });
    expect(alone.status).toBe(201);
    expect(alone.body?.parentage).toMatchObject({ unionId: null, parentId: f.person.sofia });

    const withUnion = await as(admin, 'POST', `/api/people/${f.person.daniel}/children`, {
      child: { givenName: 'Ines', surname: 'Hale', birth: { value: '2010' } },
      unionId: f.union.danielBeatriz,
    });
    expect(withUnion.body?.parentage).toMatchObject({ unionId: f.union.danielBeatriz, parentId: null });
    const union = await as('user', 'GET', `/api/unions/${f.union.danielBeatriz}`);
    expect(ids(union.body?.union.children)).toContain(withUnion.body?.person.id);
  });

  it('refuses a union that does not include the parent the child is added under', async () => {
    const response = await as(admin, 'POST', `/api/people/${f.person.sofia}/children`, {
      child: { givenName: 'Xavier', surname: 'Yepez' },
      unionId: f.union.danielBeatriz,
    });
    expect(response).toMatchObject({ status: 400, body: { error: 'union_parent_mismatch' } });
    const found = await as('user', 'GET', '/api/people?q=Xavier');
    expect(found.body?.items).toEqual([]);
  });

  it('gives a single-parent child a second parent: the two get an Unknown relationship automatically', async () => {
    const lone = (
      await as(admin, 'POST', `/api/people/${f.person.priya}/children`, {
        child: { givenName: 'Mia', surname: 'Nair' },
      })
    ).body?.person.id as string;
    const other = await insertPersonRow(t.owner, 'Raj', 'Nair');
    const added = await as(admin, 'POST', `/api/people/${lone}/parents`, { parentId: other });
    expect(added.status).toBe(201);
    const unionId = added.body?.parentage.unionId as string;
    expect(added.body?.parentage.parentId).toBeNull();
    const union = await as('user', 'GET', `/api/unions/${unionId}`);
    expect(union.body?.union).toMatchObject({ status: 'unknown', children: [{ id: lone }] });
    expect(union.body?.union.partnerIds.sort()).toEqual([f.person.priya, other].sort());
  });

  it('uses the one relationship two parents already have, and asks which when they have several', async () => {
    const kid = (
      await as(admin, 'POST', `/api/people/${f.person.daniel}/children`, {
        child: { givenName: 'Solo', surname: 'Hale' },
      })
    ).body?.person.id as string;
    const unionsBefore = await sql<{ n: string }>`select count(*) as n from unions`.execute(t.owner);
    const added = await as(admin, 'POST', `/api/people/${kid}/parents`, { parentId: f.person.elena });
    expect(added.body?.parentage.unionId).toBe(f.union.danielElena);
    const unionsAfter = await sql<{ n: string }>`select count(*) as n from unions`.execute(t.owner);
    expect(unionsAfter.rows[0]?.n).toBe(unionsBefore.rows[0]?.n);

    // Daniel and Elena remarry: now there are two unions between them
    await as(admin, 'POST', '/api/unions', {
      partnerIds: [f.person.daniel, f.person.elena],
      status: 'married',
      start: { value: '2015' },
    });
    const kid2 = (
      await as(admin, 'POST', `/api/people/${f.person.daniel}/children`, {
        child: { givenName: 'Solo', surname: 'Two' },
      })
    ).body?.person.id as string;
    const ambiguous = await as(admin, 'POST', `/api/people/${kid2}/parents`, { parentId: f.person.elena });
    expect(ambiguous).toMatchObject({ status: 409, body: { error: 'union_ambiguous' } });
    const chosen = await as(admin, 'POST', `/api/people/${kid2}/parents`, {
      parentId: f.person.elena,
      unionId: f.union.danielElena,
    });
    expect(chosen.body?.parentage.unionId).toBe(f.union.danielElena);
  });

  it('allows at most two parents, and never the same one twice', async () => {
    expect(
      (await as(admin, 'POST', `/api/people/${f.person.marcus}/parents`, { parentId: f.person.beatriz })).body?.error,
    ).toBe('too_many_parents');
    expect(
      (await as(admin, 'POST', `/api/people/${f.person.marcus}/parents`, { parentId: f.person.daniel })).body?.error,
    ).toBe('parent_already_linked');
    expect(
      (await as(admin, 'POST', `/api/people/${f.person.tomas}/parents`, { parentId: f.person.beatriz })).body?.error,
    ).toBe('parent_already_linked');
  });

  it('refuses self-parenting and cycles', async () => {
    expect(
      (await as(admin, 'POST', `/api/people/${f.person.leo}/parents`, { parentId: f.person.leo })).body?.error,
    ).toBe('parent_is_self');
    const top = await insertPersonRow(t.owner, 'Top', 'Ancestor');
    // Leo as a parent of someone unrelated is fine; Leo's own ancestor as his child is a loop
    expect((await as(admin, 'POST', `/api/people/${top}/parents`, { parentId: f.person.leo })).status).toBe(201);
    expect((await as(admin, 'POST', `/api/people/${f.person.leo}/parents`, { parentId: top })).body?.error).toBe(
      'too_many_parents',
    );
    const lonely = await insertPersonRow(t.owner, 'Lonely', 'Loop');
    expect((await as(admin, 'POST', `/api/people/${lonely}/parents`, { parentId: top })).status).toBe(201);
    // top hangs from Leo; adding Lonely (top's own child) as a second parent would make Lonely her own ancestor
    expect((await as(admin, 'POST', `/api/people/${top}/parents`, { parentId: lonely })).body?.error).toBe(
      'would_create_cycle',
    );
  });

  it('refuses a child who is one of the partners of the union (also straight in the database)', async () => {
    const child = await insertPersonRow(t.owner, 'Pa', 'Rtner');
    const partner = await insertPersonRow(t.owner, 'Par', 'Tner');
    const { rows } = await sql<{ id: string }>`
      insert into unions (partner_a_id, partner_b_id, status) values (${child < partner ? child : partner}, ${child < partner ? partner : child}, 'partner') returning id`.execute(
      t.owner,
    );
    await expect(
      sql`insert into person_parents (child_id, union_id) values (${child}, ${rows[0]!.id})`.execute(t.owner),
    ).rejects.toMatchObject({ code: 'KS012' });
    const viaApi = await as(admin, 'POST', `/api/people/${child}/parents`, { parentId: partner, unionId: rows[0]!.id });
    expect(viaApi).toMatchObject({ status: 400, body: { error: 'child_is_partner' } });
  });

  it('detects a cycle that goes through several generations', async () => {
    const g1 = await insertPersonRow(t.owner, 'G1', 'Loop');
    const g2 = (await as(admin, 'POST', `/api/people/${g1}/children`, { child: { givenName: 'G2', surname: 'Loop' } }))
      .body?.person.id as string;
    const g3 = (await as(admin, 'POST', `/api/people/${g2}/children`, { child: { givenName: 'G3', surname: 'Loop' } }))
      .body?.person.id as string;
    expect((await as(admin, 'POST', `/api/people/${g1}/parents`, { parentId: g3 })).body?.error).toBe(
      'would_create_cycle',
    );
    expect((await as(admin, 'POST', `/api/people/${g1}/parents`, { parentId: g2 })).body?.error).toBe(
      'would_create_cycle',
    );
    // straight in the database too, for the one-parent case and the union case
    await expect(
      sql`update person_parents set parent_id = ${g3} where child_id = ${g2}`.execute(t.owner),
    ).rejects.toMatchObject({ code: 'KS013' });
    const u = await insertPersonRow(t.owner, 'Mate', 'Loop');
    const union = (await as(admin, 'POST', '/api/unions', { partnerIds: [g3, u], status: 'partner' })).body?.union
      .id as string;
    await expect(
      sql`insert into person_parents (child_id, union_id) values (${g1}, ${union})`.execute(t.owner),
    ).rejects.toMatchObject({ code: 'KS013' });
  });

  it('removes one parent: from two parents to one, from one to none', async () => {
    const kid = (
      await as(admin, 'POST', `/api/people/${f.person.daniel}/children`, {
        child: { givenName: 'Cut', surname: 'Parent' },
        unionId: f.union.danielBeatriz,
      })
    ).body?.person.id as string;
    const one = await as(admin, 'DELETE', `/api/people/${kid}/parents/${f.person.daniel}`);
    expect(one.body?.parentage).toMatchObject({ unionId: null, parentId: f.person.beatriz });
    expect(await parentage(kid)).toEqual({ unionId: null, parentId: f.person.beatriz });
    expect((await as(admin, 'DELETE', `/api/people/${kid}/parents/${f.person.daniel}`)).body?.error).toBe(
      'parent_not_found',
    );
    const none = await as(admin, 'DELETE', `/api/people/${kid}/parents/${f.person.beatriz}`);
    expect(none.body?.parentage).toBeNull();
    expect(await parentage(kid)).toBeNull();
  });

  it('warns, but does not block, when a parent is less than 12 years older than the child', async () => {
    const parent = await insertPersonRow(t.owner, 'Young', 'Parent', { birth: '2000' });
    const added = await as(admin, 'POST', `/api/people/${parent}/children`, {
      child: { givenName: 'Tiny', surname: 'Parent', birth: { value: '2008-05' } },
    });
    expect(added.status).toBe(201);
    expect(added.body?.warnings).toEqual([
      { code: 'parent_too_young', childId: added.body?.person.id, parentId: parent, yearsDifference: 8 },
    ]);
    const fine = await as(admin, 'POST', `/api/people/${parent}/children`, {
      child: { givenName: 'Fine', surname: 'Parent', birth: { value: '2012' } },
    });
    expect(fine.body?.warnings).toEqual([]);
    const changed = await as(admin, 'PATCH', `/api/people/${added.body?.person.id}`, { birth: { value: '2005' } });
    expect(changed.body?.warnings).toHaveLength(1);
    const ok = await as(admin, 'PATCH', `/api/people/${added.body?.person.id}`, { birth: { value: '2015' } });
    expect(ok.body?.warnings).toEqual([]);
    const unknown = await as(admin, 'POST', `/api/people/${parent}/children`, {
      child: { givenName: 'No', surname: 'Date' },
    });
    expect(unknown.body?.warnings).toEqual([]);
  });
});

describe('deleting a person', () => {
  it('without confirm, reports what would happen (409 confirm_required with counts)', async () => {
    const response = await as(admin, 'DELETE', `/api/people/${f.person.rosa}`);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'confirm_required', unions: 1, children: 1 });
    expect((await as(admin, 'GET', `/api/people/${f.person.rosa}`)).status).toBe(200);
  });

  it('with confirm: children keep the other partner as their single parent, unions go, nothing dangles', async () => {
    const dad = await insertPersonRow(t.owner, 'Dad', 'Delete');
    const mum = await insertPersonRow(t.owner, 'Mum', 'Keep');
    const ex = await insertPersonRow(t.owner, 'Ex', 'Keep');
    const together = (await as(admin, 'POST', '/api/unions', { partnerIds: [dad, mum], status: 'married' })).body?.union
      .id as string;
    const earlier = (await as(admin, 'POST', '/api/unions', { partnerIds: [dad, ex], status: 'divorced' })).body?.union
      .id as string;
    const kidA = (
      await as(admin, 'POST', `/api/people/${dad}/children`, {
        child: { givenName: 'A', surname: 'Kid' },
        unionId: together,
      })
    ).body?.person.id as string;
    const kidB = (
      await as(admin, 'POST', `/api/people/${dad}/children`, {
        child: { givenName: 'B', surname: 'Kid' },
        unionId: earlier,
      })
    ).body?.person.id as string;
    const kidC = (await as(admin, 'POST', `/api/people/${dad}/children`, { child: { givenName: 'C', surname: 'Kid' } }))
      .body?.person.id as string;

    expect((await as(admin, 'DELETE', `/api/people/${dad}`)).body).toEqual({
      error: 'confirm_required',
      unions: 2,
      children: 3,
    });
    expect((await as(admin, 'DELETE', `/api/people/${dad}?confirm=false`)).status).toBe(409);
    expect((await as(admin, 'DELETE', `/api/people/${dad}?confirm=true`)).status).toBe(204);

    expect((await as(admin, 'GET', `/api/people/${dad}`)).status).toBe(404);
    expect((await as(admin, 'GET', `/api/people/${kidA}`)).body?.parents.birth).toMatchObject({
      unionId: null,
      parentId: mum,
    });
    expect((await as(admin, 'GET', `/api/people/${kidB}`)).body?.parents.birth).toMatchObject({
      unionId: null,
      parentId: ex,
    });
    expect((await as(admin, 'GET', `/api/people/${kidC}`)).body?.parents.birth).toBeNull();
    expect((await as(admin, 'GET', `/api/unions/${together}`)).status).toBe(404);
    expect((await as(admin, 'GET', `/api/unions/${earlier}`)).status).toBe(404);
    for (const id of [kidA, kidB, kidC, mum, ex])
      expect((await as(admin, 'GET', `/api/people/${id}`)).status).toBe(200);

    const dangling = await sql<{ n: string }>`
      select (
        (select count(*) from person_parents pp where pp.parent_id is not null and not exists (select 1 from people p where p.id = pp.parent_id))
      + (select count(*) from person_parents pp where pp.union_id is not null and not exists (select 1 from unions u where u.id = pp.union_id))
      + (select count(*) from unions u where not exists (select 1 from people p where p.id = u.partner_a_id) or not exists (select 1 from people p where p.id = u.partner_b_id))
      ) as n`.execute(t.owner);
    expect(dangling.rows[0]?.n).toBe('0');
  });

  it('deletes a person with no relationships without a confirm', async () => {
    const lone = await insertPersonRow(t.owner, 'Lone', 'Person');
    expect((await as(admin, 'DELETE', `/api/people/${lone}`)).status).toBe(204);
  });

  it('refuses to delete the person an account is linked to', async () => {
    const response = await as(admin, 'DELETE', `/api/people/${f.person.marcus}?confirm=true`);
    expect(response).toMatchObject({ status: 409, body: { error: 'person_has_account' } });
    expect((await as(admin, 'GET', `/api/people/${f.person.marcus}`)).body?.hasAccount).toBe(true);
  });
});

describe('the tree around a person', () => {
  it('returns ancestors, descendants, partners and the links between them', async () => {
    const tree = await as('user', 'GET', `/api/tree/${f.person.marcus}?up=2&down=1`);
    expect(tree.status).toBe(200);
    const names = (tree.body?.people as Array<{ givenName: string }>).map((p) => p.givenName);
    expect(names).toEqual(expect.arrayContaining(['Marcus', 'Daniel', 'Elena', 'Walter', 'Rosa', 'Priya', 'Leo']));
    expect(names).not.toContain('Sofia');
    expect(names).not.toContain('Gabriel');
    expect(tree.body?.focalId).toBe(f.person.marcus);
    expect(tree.body?.parentage[f.person.marcus]).toMatchObject({ unionId: f.union.danielElena, parentId: null });
    expect(tree.body?.parentage[f.person.leo]).toMatchObject({ unionId: f.union.marcusPriya, parentId: null });
    const unionIds = (tree.body?.unions as Array<{ id: string }>).map((u) => u.id);
    expect(unionIds).toEqual(expect.arrayContaining([f.union.danielElena, f.union.walterRosa, f.union.marcusPriya]));
    const byName = Object.fromEntries(
      (tree.body?.people as Array<{ givenName: string; hasParents: boolean }>).map((p) => [p.givenName, p.hasParents]),
    );
    expect(byName.Marcus).toBe(true);
    expect(byName.Walter).toBe(false);
    expect(byName.Priya).toBe(false);
  });

  it('stops at the generations asked for, and leaves out links to people who are not drawn', async () => {
    const tree = await as('user', 'GET', `/api/tree/${f.person.marcus}?up=1&down=0`);
    const names = (tree.body?.people as Array<{ givenName: string }>).map((p) => p.givenName).sort();
    // Daniel's partners come along so couples are whole, and Tomas, Beatriz's own son from before (one hop)
    expect(names).toEqual(expect.arrayContaining(['Beatriz', 'Daniel', 'Elena', 'Marcus', 'Priya', 'Tomas']));
    // but not Marcus's own child (below the limit), nor Gabriel (Daniel's child, not on this line)
    expect(names).not.toContain('Leo');
    expect(names).not.toContain('Gabriel');
    expect(tree.body?.parentage[f.person.daniel]).toBeUndefined();
    expect(
      (tree.body?.people as Array<{ id: string; hasParents: boolean }>).find((p) => p.id === f.person.daniel)
        ?.hasParents,
    ).toBe(true);
  });

  it('with collateral, the family tree view also gets siblings, half-siblings and cousins', async () => {
    const tree = await as('user', 'GET', `/api/tree/${f.person.marcus}?up=2&down=1&collateral=true`);
    const names = (tree.body?.people as Array<{ givenName: string }>).map((p) => p.givenName);
    expect(names).toEqual(expect.arrayContaining(['Sofia', 'Gabriel', 'Beatriz', 'Marcus', 'Leo']));
  });

  it('caps the generations, refuses bad numbers and unknown people', async () => {
    expect((await as('user', 'GET', `/api/tree/${f.person.marcus}?up=999`)).status).toBe(400);
    expect((await as('user', 'GET', `/api/tree/${f.person.marcus}?up=x`)).status).toBe(400);
    expect((await as('user', 'GET', `/api/tree/${f.person.marcus}?up=50&down=0`)).status).toBe(200);
    expect((await as('user', 'GET', '/api/tree/00000000-0000-4000-8000-000000000000')).body?.error).toBe(
      'person_not_found',
    );
  });
});
