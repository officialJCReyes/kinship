// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, signInAll } from './helpers/family.js';
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

const admin = 'familyadmin';
const make = (from: string, to: string, label: string, reverseLabel?: string | null) =>
  as(admin, 'POST', '/api/labels', {
    fromId: from,
    toId: to,
    label,
    ...(reverseLabel !== undefined ? { reverseLabel } : {}),
  });
const labelsOf = async (id: string, who: Parameters<typeof as>[0] = admin) =>
  ((await as(who, 'GET', `/api/people/${id}`)).body?.labels ?? []) as Array<Record<string, unknown>>;
const rows = async () =>
  (await sql<{ n: string }>`select count(*) as n from relationship_labels`.execute(t.owner)).rows[0]!.n;

describe('custom relationship labels: create and read', () => {
  it('creates a label and shows it on both profiles, from either side', async () => {
    const { marcus, sofia } = f.person;
    const created = await make(marcus, sofia, '  Godmother ', 'Godchild');
    expect(created.status).toBe(201);
    expect(created.body?.label).toMatchObject({
      fromId: marcus,
      toId: sofia,
      label: 'Godmother',
      reverseLabel: 'Godchild',
    });
    const id = created.body?.label.id as string;
    expect(await labelsOf(marcus)).toContainEqual({
      id,
      otherId: sofia,
      other: expect.objectContaining({ id: sofia, givenName: 'Sofia' }),
      direction: 'from',
      label: 'Godmother',
      reverseLabel: 'Godchild',
    });
    expect(await labelsOf(sofia)).toContainEqual({
      id,
      otherId: marcus,
      other: expect.objectContaining({ id: marcus, givenName: 'Marcus' }),
      direction: 'to',
      label: 'Godmother',
      reverseLabel: 'Godchild',
    });
  });

  it('keeps no reverse label when none is given (blank or null)', async () => {
    const { daniel, tomas, gabriel } = f.person;
    expect((await make(daniel, tomas, 'Guardian')).body?.label.reverseLabel).toBeNull();
    expect((await make(daniel, gabriel, 'Guardian', '   ')).body?.label.reverseLabel).toBeNull();
    expect((await make(tomas, gabriel, 'Guardian', null)).body?.label.reverseLabel).toBeNull();
  });

  it('lets any signed-in account read labels, including a User', async () => {
    const { elena, leo } = f.person;
    const id = (await make(elena, leo, 'Family friend')).body?.label.id as string;
    for (const who of ['superadmin', 'familyadmin', 'member', 'unlinked', 'user'] as const) {
      expect(
        (await labelsOf(leo, who)).map((l) => l.id),
        who,
      ).toContain(id);
    }
    expect((await as('anonymous', 'GET', `/api/people/${leo}`)).status).toBe(401);
  });

  it('answers with an empty list for a person with no labels', async () => {
    const lonely = await insertPersonRow(t.owner, 'No', 'Labels');
    expect(await labelsOf(lonely)).toEqual([]);
  });
});

describe('custom relationship labels: validation', () => {
  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'a'.repeat(61)],
    ['a control character', 'bad\u0007label'],
  ])('refuses a label that is %s', async (_name, label) => {
    const r = await make(f.person.walter, f.person.sofia, label);
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid_label' } });
  });

  it('refuses a reverse label that is too long', async () => {
    const r = await make(f.person.walter, f.person.sofia, 'Ok', 'a'.repeat(61));
    expect(r).toMatchObject({ status: 400, body: { error: 'invalid_label' } });
  });

  it('accepts exactly 60 characters', async () => {
    expect((await make(f.person.walter, f.person.leo, 'a'.repeat(60), 'b'.repeat(60))).status).toBe(201);
  });

  it('refuses a person labelled to themselves', async () => {
    expect(await make(f.person.marcus, f.person.marcus, 'Self')).toMatchObject({
      status: 400,
      body: { error: 'invalid_label' },
    });
  });

  it('refuses people who do not exist', async () => {
    const ghost = '99999999-9999-4999-8999-999999999999';
    expect(await make(ghost, f.person.marcus, 'Ghost')).toMatchObject({
      status: 404,
      body: { error: 'person_not_found' },
    });
    expect(await make(f.person.marcus, 'not-a-uuid', 'Ghost')).toMatchObject({
      status: 404,
      body: { error: 'person_not_found' },
    });
  });
});

describe('custom relationship labels: duplicates', () => {
  it('refuses the same pair, direction and label (any case), with duplicate_label', async () => {
    const { rosa, beatriz } = f.person;
    expect((await make(rosa, beatriz, 'Neighbour')).status).toBe(201);
    expect(await make(rosa, beatriz, 'Neighbour')).toMatchObject({ status: 409, body: { error: 'duplicate_label' } });
    expect(await make(rosa, beatriz, '  NEIGHBOUR ')).toMatchObject({
      status: 409,
      body: { error: 'duplicate_label' },
    });
  });

  it('allows the same pair with a different label', async () => {
    const { rosa, beatriz } = f.person;
    expect((await make(rosa, beatriz, 'Colleague')).status).toBe(201);
  });

  it('allows the reverse direction with the same label (Carla is Marcus’s godmother, Marcus is Carla’s)', async () => {
    const { priya, gabriel } = f.person;
    expect((await make(priya, gabriel, 'Godmother')).status).toBe(201);
    expect((await make(gabriel, priya, 'Godmother')).status).toBe(201);
    expect(await make(gabriel, priya, 'godmother')).toMatchObject({ status: 409, body: { error: 'duplicate_label' } });
  });
});

describe('custom relationship labels: change and delete', () => {
  it('changes the wording, and clears the reverse label', async () => {
    const { walter, tomas } = f.person;
    const id = (await make(walter, tomas, 'Mentor', 'Student')).body?.label.id as string;
    const changed = await as(admin, 'PATCH', `/api/labels/${id}`, { label: ' Teacher ', reverseLabel: null });
    expect(changed.body?.label).toMatchObject({ label: 'Teacher', reverseLabel: null, fromId: walter, toId: tomas });
    const onlyReverse = await as(admin, 'PATCH', `/api/labels/${id}`, { reverseLabel: 'Pupil' });
    expect(onlyReverse.body?.label).toMatchObject({ label: 'Teacher', reverseLabel: 'Pupil' });
  });

  it('refuses a change into a duplicate, a bad label, and a label that does not exist', async () => {
    const { walter, leo } = f.person;
    await make(walter, leo, 'Patron');
    const id = (await make(walter, leo, 'Sponsor')).body?.label.id as string;
    expect(await as(admin, 'PATCH', `/api/labels/${id}`, { label: 'patron' })).toMatchObject({
      status: 409,
      body: { error: 'duplicate_label' },
    });
    expect(await as(admin, 'PATCH', `/api/labels/${id}`, { label: '' })).toMatchObject({
      status: 400,
      body: { error: 'invalid_label' },
    });
    expect(await as(admin, 'PATCH', `/api/labels/${id}`, { label: 'Sponsor' })).toMatchObject({ status: 200 });
    const ghost = '99999999-9999-4999-8999-999999999999';
    expect(await as(admin, 'PATCH', `/api/labels/${ghost}`, { label: 'x' })).toMatchObject({
      status: 404,
      body: { error: 'label_not_found' },
    });
  });

  it('cannot move a label to other people (the two people are not in the PATCH body)', async () => {
    const { walter, leo, sofia } = f.person;
    const id = (await make(walter, leo, 'Fixed')).body?.label.id as string;
    expect(await as(admin, 'PATCH', `/api/labels/${id}`, { toId: sofia })).toMatchObject({ status: 400 });
  });

  it('deletes a label from both profiles', async () => {
    const { elena, tomas } = f.person;
    const id = (await make(elena, tomas, 'Temporary')).body?.label.id as string;
    expect((await as(admin, 'DELETE', `/api/labels/${id}`)).status).toBe(204);
    expect((await labelsOf(elena)).map((l) => l.id)).not.toContain(id);
    expect((await labelsOf(tomas)).map((l) => l.id)).not.toContain(id);
    expect(await as(admin, 'DELETE', `/api/labels/${id}`)).toMatchObject({
      status: 404,
      body: { error: 'label_not_found' },
    });
  });

  it('refuses a Member and a User with forbidden', async () => {
    const { elena, tomas } = f.person;
    const id = (await make(elena, tomas, 'Mine')).body?.label.id as string;
    for (const who of ['member', 'unlinked', 'user'] as const) {
      const mine = { fromId: elena, toId: tomas, label: `By ${who}` };
      expect(await as(who, 'POST', '/api/labels', mine), who).toMatchObject({
        status: 403,
        body: { error: 'forbidden' },
      });
      expect(await as(who, 'PATCH', `/api/labels/${id}`, { label: 'x' }), who).toMatchObject({
        status: 403,
        body: { error: 'forbidden' },
      });
      expect(await as(who, 'DELETE', `/api/labels/${id}`), who).toMatchObject({
        status: 403,
        body: { error: 'forbidden' },
      });
    }
    expect((await labelsOf(tomas)).map((l) => l.label)).toContain('Mine');
  });
});

describe('custom relationship labels: row-level security as the app role', () => {
  const asUser = <T>(userId: string, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
    withUserTransaction(t.db, userId, fn);

  it('has row-level security enabled and forced', async () => {
    const r = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>`
      select relrowsecurity, relforcerowsecurity from pg_class where relname = 'relationship_labels'`.execute(t.owner);
    expect(r.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  });

  it('lets a Member and a User read, and blocks their insert, update and delete in SQL', async () => {
    const { elena, tomas } = f.person;
    const id = (await make(elena, tomas, 'Protected')).body?.label.id as string;
    for (const who of ['member', 'user'] as const) {
      const account = f.account[who].id;
      const seen = await asUser(account, (trx) =>
        trx.selectFrom('relationship_labels').select('id').where('id', '=', id).execute(),
      );
      expect(seen, who).toHaveLength(1);
      await expect(
        asUser(account, (trx) =>
          trx
            .insertInto('relationship_labels')
            .values({ from_id: tomas, to_id: elena, label: `Sneaky ${who}`, created_by: account })
            .execute(),
        ),
        who,
      ).rejects.toThrow(/row-level security|permission denied/);
      const changed = await asUser(account, (trx) =>
        trx.updateTable('relationship_labels').set({ label: 'Changed' }).where('id', '=', id).execute(),
      );
      expect(changed[0]!.numUpdatedRows, who).toBe(0n);
      const removed = await asUser(account, (trx) =>
        trx.deleteFrom('relationship_labels').where('id', '=', id).execute(),
      );
      expect(removed[0]!.numDeletedRows, who).toBe(0n);
    }
    expect((await labelsOf(tomas)).map((l) => l.label)).toContain('Protected');
  });

  it('cannot change who the label is between, even as an admin', async () => {
    const { elena, tomas, sofia } = f.person;
    const id = (await make(elena, tomas, 'Stays')).body?.label.id as string;
    await expect(
      asUser(f.account.superadmin.id, (trx) =>
        sql`update relationship_labels set to_id = ${sofia} where id = ${id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('custom relationship labels: deleting a person', () => {
  it('deletes their labels, whether they are the from side or the to side', async () => {
    const a = await insertPersonRow(t.owner, 'Cascade', 'A');
    const b = await insertPersonRow(t.owner, 'Cascade', 'B');
    const c = await insertPersonRow(t.owner, 'Cascade', 'C');
    await make(a, b, 'Godmother'); // a is the from side, b the to side
    await make(c, a, 'Guardian'); // a is the to side
    await make(b, c, 'Friend'); // untouched by deleting a
    const before = Number(await rows());
    expect((await as(admin, 'DELETE', `/api/people/${a}`)).status).toBe(204);
    expect(Number(await rows())).toBe(before - 2);
    expect(await labelsOf(b)).toEqual([expect.objectContaining({ otherId: c, label: 'Friend' })]);
    // Deleting the to side of what is left removes it too.
    expect((await as(admin, 'DELETE', `/api/people/${c}`)).status).toBe(204);
    expect(await labelsOf(b)).toEqual([]);
  });
});

describe('custom relationship labels never change the family', () => {
  const treeOf = async (id: string) => (await as(admin, 'GET', `/api/tree/${id}?up=3&down=3&collateral=true`)).body;
  const myLine = (accountId: string, personId: string) =>
    withUserTransaction(t.db, accountId, async (trx) => {
      const r = await sql<{ in_line: boolean; parents: string[] }>`
        select public.kinship_in_my_line(${personId}::uuid) as in_line,
               coalesce((select array_agg(p order by p) from public.kinship_parent_ids(${personId}::uuid) as p), '{}') as parents`.execute(
        trx,
      );
      return r.rows[0];
    });

  it('leaves the tree, the parent helpers and "my line" exactly as they were', async () => {
    const everyone = Object.values(f.person);
    const trees = async () => Promise.all(everyone.map((id) => treeOf(id)));
    const lines = async () => Promise.all(everyone.map((id) => myLine(f.account.member.id, id)));
    const parents = async () =>
      (
        await sql`select child_id, kind, union_id, parent_id from person_parents order by child_id, kind`.execute(
          t.owner,
        )
      ).rows;
    const unions = async () =>
      (await sql`select id, status, status_auto from unions order by id`.execute(t.owner)).rows;
    const beforeTrees = await trees();
    const beforeLines = await lines();
    const beforeParents = await parents();
    const beforeUnions = await unions();

    // Labels in every shape: between relatives, between strangers, a would-be parent, the Member's own person.
    const { marcus, daniel, leo, walter, tomas, priya } = f.person;
    await make(marcus, daniel, 'Guardian'); // a father, labelled something else
    await make(leo, walter, 'Godfather', 'Godchild');
    await make(daniel, leo, 'Parent'); // the word "parent" is only a word
    await make(tomas, marcus, 'Mentor');
    await make(priya, tomas, 'Adoptive mother'); // the word "adoptive" is only a word

    expect(await trees()).toEqual(beforeTrees);
    expect(await lines()).toEqual(beforeLines);
    expect(await parents()).toEqual(beforeParents);
    expect(await unions()).toEqual(beforeUnions);
  });
});
