// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import type { Database } from '../src/db.js';
import { withUserTransaction } from '../src/request-context.js';
import { readVersion } from '../src/version.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, insertUnionRow, linkChild, signInAll } from './helpers/family.js';
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

type UnionState = { status: string; status_auto: boolean };
const unionState = async (id: string): Promise<UnionState> =>
  (await sql<UnionState>`select status, status_auto from unions where id = ${id}`.execute(t.owner)).rows[0]!;

/** Runs SQL as the app role with an account signed in, the way a request does. */
const asAccount = <T>(userId: string, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);
const setDeceased = (userId: string, personId: string, deceased: boolean) =>
  asAccount(userId, (trx) =>
    sql`update people set deceased = ${deceased}, death_date = null where id = ${personId}`.execute(trx),
  );

/** Two new living people and a union between them. */
async function couple(status: string): Promise<{ a: string; b: string; union: string }> {
  const a = await insertPersonRow(t.owner, 'Test', 'Alpha');
  const b = await insertPersonRow(t.owner, 'Test', 'Beta');
  return { a, b, union: await insertUnionRow(t.owner, a, b, status) };
}

describe('automatic Widowed: the people trigger', () => {
  it('turns a Married relationship into Widowed when a partner is marked deceased, and back when marked living', async () => {
    const c = await couple('married');
    await setDeceased(f.account.superadmin.id, c.a, true);
    expect(await unionState(c.union)).toEqual({ status: 'widowed', status_auto: true });
    await setDeceased(f.account.superadmin.id, c.a, false);
    expect(await unionState(c.union)).toEqual({ status: 'married', status_auto: false });
  });

  it('never touches Engaged, Partner, Separated, Divorced, Annulment, Friends, Unknown or Other', async () => {
    for (const status of ['engaged', 'partner', 'separated', 'divorced', 'annulment', 'friends', 'unknown', 'other']) {
      const c = await couple(status);
      await setDeceased(f.account.superadmin.id, c.b, true);
      expect(await unionState(c.union), status).toEqual({ status, status_auto: false });
      await setDeceased(f.account.superadmin.id, c.b, false);
      expect(await unionState(c.union), status).toEqual({ status, status_auto: false });
    }
  });

  it('works when a Member marks themselves deceased (the app role cannot update unions it is not in)', async () => {
    // Marcus is the Member's own person; his union with Priya is one the Member may edit anyway.
    await setDeceased(f.account.member.id, f.person.marcus, true);
    expect(await unionState(f.union.marcusPriya)).toEqual({ status: 'widowed', status_auto: true });
    await setDeceased(f.account.member.id, f.person.marcus, false);
    expect(await unionState(f.union.marcusPriya)).toEqual({ status: 'married', status_auto: false });
  });

  it('works for a union the Member is not in: a person they added, married to someone they did not', async () => {
    const child = await t.owner.transaction().execute(async (trx) => {
      const created = await sql<{ id: string }>`
        insert into people (given_name, surname, created_by) values ('Line', 'Hale', ${f.account.member.id}) returning id`.execute(
        trx,
      );
      const id = created.rows[0]!.id;
      await sql`insert into person_parents (child_id, parent_id, created_by) values (${id}, ${f.person.marcus}, ${f.account.member.id})`.execute(
        trx,
      );
      return id;
    });
    const spouse = await insertPersonRow(t.owner, 'Out', 'Law');
    const union = await insertUnionRow(t.owner, child, spouse, 'married');
    // The Member cannot change this union directly (it does not include their person)...
    await expect(
      asAccount(f.account.member.id, async (trx) => {
        const result = await sql`update unions set status = 'divorced' where id = ${union}`.execute(trx);
        if (result.numAffectedRows === 0n) throw new Error('no rows');
      }),
    ).rejects.toThrow('no rows');
    // ...but marking their own descendant deceased still reaches it.
    await setDeceased(f.account.member.id, child, true);
    expect(await unionState(union)).toEqual({ status: 'widowed', status_auto: true });
    await setDeceased(f.account.member.id, child, false);
    expect(await unionState(union)).toEqual({ status: 'married', status_auto: false });
  });

  it('keeps Widowed while the other partner is still deceased, and reverts when both are living', async () => {
    const c = await couple('married');
    const id = f.account.superadmin.id;
    await setDeceased(id, c.a, true);
    await setDeceased(id, c.b, true);
    expect(await unionState(c.union)).toEqual({ status: 'widowed', status_auto: true });
    await setDeceased(id, c.a, false);
    expect(await unionState(c.union)).toEqual({ status: 'widowed', status_auto: true });
    await setDeceased(id, c.b, false);
    expect(await unionState(c.union)).toEqual({ status: 'married', status_auto: false });
  });

  it('keeps a status chosen by hand', async () => {
    const id = f.account.superadmin.id;
    // Divorced by hand before the death: the death changes nothing.
    const ended = await couple('married');
    await asAccount(id, (trx) => sql`update unions set status = 'divorced' where id = ${ended.union}`.execute(trx));
    await setDeceased(id, ended.a, true);
    expect(await unionState(ended.union)).toEqual({ status: 'divorced', status_auto: false });
    // Widowed by hand: marking the person living again does not revert it.
    const manual = await couple('widowed');
    await setDeceased(id, manual.a, true);
    await setDeceased(id, manual.a, false);
    expect(await unionState(manual.union)).toEqual({ status: 'widowed', status_auto: false });
    // An automatic Widowed that an admin then re-saves with another status is theirs from then on.
    const auto = await couple('married');
    await setDeceased(id, auto.a, true);
    await asAccount(id, (trx) => sql`update unions set status = 'separated' where id = ${auto.union}`.execute(trx));
    expect(await unionState(auto.union)).toEqual({ status: 'separated', status_auto: false });
    await setDeceased(id, auto.a, false);
    expect(await unionState(auto.union)).toEqual({ status: 'separated', status_auto: false });
  });

  it('leaves a divorced relationship alone and flips only the current marriage (remarriage)', async () => {
    const id = f.account.superadmin.id;
    const person = await insertPersonRow(t.owner, 'Twice', 'Married');
    const first = await insertPersonRow(t.owner, 'First', 'Spouse');
    const second = await insertPersonRow(t.owner, 'Second', 'Spouse');
    const old = await insertUnionRow(t.owner, person, first, 'divorced', { start: '1990', end: '1999' });
    const current = await insertUnionRow(t.owner, person, second, 'married', { start: '2001' });
    await setDeceased(id, person, true);
    expect(await unionState(old)).toEqual({ status: 'divorced', status_auto: false });
    expect(await unionState(current)).toEqual({ status: 'widowed', status_auto: true });
  });

  it('does not change who the parents are (adoption is unaffected)', async () => {
    const id = f.account.superadmin.id;
    const mum = await insertPersonRow(t.owner, 'Adopt', 'Mum');
    const dad = await insertPersonRow(t.owner, 'Adopt', 'Dad');
    const kid = await insertPersonRow(t.owner, 'Adopt', 'Kid');
    const union = await insertUnionRow(t.owner, mum, dad, 'married');
    await linkChild(t.owner, kid, { union });
    const before = await sql`select * from person_parents where child_id = ${kid}`.execute(t.owner);
    await setDeceased(id, mum, true);
    const after = await sql`select * from person_parents where child_id = ${kid}`.execute(t.owner);
    expect(after.rows).toEqual(before.rows);
    expect((await unionState(union)).status).toBe('widowed');
  });

  it('is reachable through the API: PATCH a person, and the relationship reads Widowed', async () => {
    const c = await couple('married');
    const patched = await as('familyadmin', 'PATCH', `/api/people/${c.a}`, { deceased: true });
    expect(patched.status).toBe(200);
    const read = await as('user', 'GET', `/api/unions/${c.union}`);
    expect(read.body?.union).toMatchObject({ status: 'widowed', statusAuto: true });
  });
});

describe('automatic Widowed: saving a relationship', () => {
  it('stores a new Married relationship with a deceased partner as Widowed, and says so', async () => {
    const gone = await insertPersonRow(t.owner, 'Late', 'Partner', { deceased: true });
    const living = await insertPersonRow(t.owner, 'Living', 'Partner');
    const created = await as('familyadmin', 'POST', '/api/unions', { partnerIds: [gone, living], status: 'married' });
    expect(created.status).toBe(201);
    expect(created.body?.union).toMatchObject({ status: 'widowed', statusAuto: true });
  });

  it('turns a PATCH to Married into Widowed while a partner is deceased', async () => {
    const gone = await insertPersonRow(t.owner, 'Late', 'Other', { deceased: true });
    const living = await insertPersonRow(t.owner, 'Living', 'Other');
    const created = await as('familyadmin', 'POST', '/api/unions', { partnerIds: [gone, living], status: 'divorced' });
    const id = created.body?.union.id as string;
    expect(created.body?.union).toMatchObject({ status: 'divorced', statusAuto: false });
    const patched = await as('familyadmin', 'PATCH', `/api/unions/${id}`, { status: 'married' });
    expect(patched.body?.union).toMatchObject({ status: 'widowed', statusAuto: true });
  });

  it('makes a status changed by hand permanent: statusAuto goes false', async () => {
    const c = await couple('married');
    await as('familyadmin', 'PATCH', `/api/people/${c.a}`, { deceased: true });
    const patched = await as('familyadmin', 'PATCH', `/api/unions/${c.union}`, { status: 'separated' });
    expect(patched.body?.union).toMatchObject({ status: 'separated', statusAuto: false });
  });

  it('compares the stored status when it looks for a duplicate', async () => {
    const gone = await insertPersonRow(t.owner, 'Dup', 'Gone', { deceased: true });
    const living = await insertPersonRow(t.owner, 'Dup', 'Living');
    const body = { partnerIds: [gone, living], status: 'married', start: { value: '1970' } };
    expect((await as('familyadmin', 'POST', '/api/unions', body)).status).toBe(201);
    expect((await as('familyadmin', 'POST', '/api/unions', body)).body?.error).toBe('duplicate_relationship');
  });

  it('cannot be written by the app role: status_auto is read-only to it', async () => {
    const c = await couple('married');
    await expect(
      asAccount(f.account.superadmin.id, (trx) =>
        sql`update unions set status_auto = true where id = ${c.union}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAccount(f.account.superadmin.id, (trx) =>
        sql`insert into unions (partner_a_id, partner_b_id, status, status_auto, created_by)
            values (${c.a}, ${c.b}, 'engaged', true, ${f.account.superadmin.id})`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

// ---------------------------------------------------------------------------
// Property test: random toggles against a small model of the rules.
// ---------------------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('automatic Widowed: invariants over random toggles', () => {
  const STATUSES = ['married', 'married', 'married', 'engaged', 'divorced', 'separated', 'widowed'];

  it.each([1, 2, 3, 4, 5, 6])(
    'keeps the rules for seed %i',
    async (seed) => {
      const random = rng(seed);
      const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
      const people = await Promise.all(
        Array.from({ length: 6 }, (_, i) => insertPersonRow(t.owner, `Prop${seed}`, `P${i}`)),
      );
      const gone = new Map(people.map((p) => [p, false]));
      // A model of every union: what the rules say its state must be.
      const model = new Map<string, { a: string; b: string; status: string; auto: boolean }>();
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          if (random() < 0.5) continue;
          const status = pick(STATUSES);
          const id = await insertUnionRow(t.owner, people[i]!, people[j]!, status);
          model.set(id, { a: people[i]!, b: people[j]!, status, auto: false });
        }
      }
      const admin = f.account.superadmin.id;

      for (let step = 0; step < 40; step++) {
        const action = random();
        if (action < 0.7) {
          const person = pick(people);
          const next = !gone.get(person);
          gone.set(person, next);
          await setDeceased(admin, person, next);
          for (const u of model.values()) {
            if (u.a !== person && u.b !== person) continue;
            if (next) {
              if (u.status === 'married') Object.assign(u, { status: 'widowed', auto: true });
            } else if (u.status === 'widowed' && u.auto && !gone.get(u.a) && !gone.get(u.b)) {
              Object.assign(u, { status: 'married', auto: false });
            }
          }
        } else if (model.size > 0) {
          const [id, u] = pick([...model.entries()]);
          const status = pick(STATUSES);
          await asAccount(admin, (trx) => sql`update unions set status = ${status} where id = ${id}`.execute(trx));
          if (status !== u.status) u.auto = false;
          u.status = status;
          if (u.status === 'married' && (gone.get(u.a) || gone.get(u.b)))
            Object.assign(u, { status: 'widowed', auto: true });
        }

        for (const [id, u] of model) {
          const actual = await unionState(id);
          expect(actual, `seed ${seed} step ${step}`).toEqual({ status: u.status, status_auto: u.auto });
          // The invariants, independent of the model:
          if (actual.status === 'married') expect(gone.get(u.a) || gone.get(u.b)).toBe(false);
          if (actual.status_auto) {
            expect(actual.status).toBe('widowed');
            expect(gone.get(u.a) || gone.get(u.b)).toBe(true);
          }
        }
      }
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// A status saved by hand makes an automatic Widowed permanent (migration 0008).
// ---------------------------------------------------------------------------
describe('automatic Widowed: a status saved by hand', () => {
  const admin = 'familyadmin';
  const SETTING = 'kinship.union_status_by_hand';

  /** A relationship that the database set to Widowed itself, read back through the API. */
  async function autoWidowed() {
    const c = await couple('married');
    const marked = await as(admin, 'PATCH', `/api/people/${c.a}`, { deceased: true });
    expect(marked.status).toBe(200);
    const read = await as(admin, 'GET', `/api/unions/${c.union}`);
    expect(read.body?.union).toMatchObject({ status: 'widowed', statusAuto: true });
    return c;
  }

  it('clears status_auto when the saved status equals the current one, and un-marking then reverts nothing', async () => {
    const c = await autoWidowed();
    const saved = await as(admin, 'PATCH', `/api/unions/${c.union}`, { status: 'widowed' });
    expect(saved.body?.union).toMatchObject({ status: 'widowed', statusAuto: false });
    const living = await as(admin, 'PATCH', `/api/people/${c.a}`, { deceased: false });
    expect(living.status).toBe(200);
    expect(await unionState(c.union)).toEqual({ status: 'widowed', status_auto: false });
  });

  it('leaves status_auto alone when the PATCH has no status (dates)', async () => {
    const c = await autoWidowed();
    const saved = await as(admin, 'PATCH', `/api/unions/${c.union}`, { start: { value: '1980-05' } });
    expect(saved.body?.union).toMatchObject({ status: 'widowed', statusAuto: true, start: { value: '1980-05' } });
    expect(await unionState(c.union)).toEqual({ status: 'widowed', status_auto: true });
  });

  it('does not touch a different relationship', async () => {
    const one = await autoWidowed();
    const other = await autoWidowed();
    await as(admin, 'PATCH', `/api/unions/${one.union}`, { status: 'widowed' });
    expect(await unionState(one.union)).toEqual({ status: 'widowed', status_auto: false });
    expect(await unionState(other.union)).toEqual({ status: 'widowed', status_auto: true });
  });

  it('is cleared by a status that differs, as before', async () => {
    const c = await autoWidowed();
    const saved = await as(admin, 'PATCH', `/api/unions/${c.union}`, { status: 'divorced', end: null });
    expect(saved.body?.union).toMatchObject({ status: 'divorced', statusAuto: false });
  });

  describe('on one pooled connection', () => {
    // One connection for everything: whatever a request leaves behind, the next request meets it.
    let single: ReturnType<typeof createDb<Database>>;
    let one: Awaited<ReturnType<typeof signInAll>>;
    let app2: ReturnType<typeof buildApp>;
    beforeAll(async () => {
      const config = t.test.config;
      single = t.test.track(createDb<Database>(config, config.appUser, config.appPassword, 1));
      app2 = buildApp({
        db: single,
        version: readVersion('abc1234', '2026-11-15T19:04:05Z'),
        logLevel: 'silent',
        sessions: { idleSeconds: 3600, maxSeconds: 86_400 },
        failureDelayMs: 0,
        loginRequestsPerMinute: 10_000,
        apiRequestsPerMinute: 100_000,
      });
      await app2.ready();
      one = await signInAll(app2, f);
    });
    afterAll(() => app2.close());

    const setting = (id: string) =>
      withUserTransaction(single, id, async (trx) => {
        const r = await sql<{ v: string | null }>`select current_setting(${SETTING}, true) as v`.execute(trx);
        return r.rows[0]?.v ?? '';
      });

    it('does not carry the setting from one request to the next', async () => {
      const a = await autoWidowed();
      const b = await autoWidowed();
      const patched = await one(admin, 'PATCH', `/api/unions/${a.union}`, { status: 'widowed' });
      expect(patched.body?.union).toMatchObject({ statusAuto: false });
      // The next request on the same connection sees no setting, and a plain same-value update leaves b alone.
      expect(await setting(f.account.superadmin.id)).not.toBe('on');
      await asAccount(f.account.superadmin.id, (trx) =>
        sql`update unions set status = status where id = ${b.union}`.execute(trx),
      );
      expect(await unionState(b.union)).toEqual({ status: 'widowed', status_auto: true });
    });

    it('does not keep a setting that a transaction set locally', async () => {
      await withUserTransaction(single, f.account.superadmin.id, (trx) =>
        sql`select set_config(${SETTING}, 'on', true)`.execute(trx),
      );
      expect(await setting(f.account.superadmin.id)).not.toBe('on');
    });

    it('is ignored by the deceased trigger and by the rule for a new relationship', async () => {
      const c = await couple('married');
      const gone = await insertPersonRow(t.owner, 'Setting', 'Gone', { deceased: true });
      await withUserTransaction(single, f.account.superadmin.id, async (trx) => {
        await sql`select set_config(${SETTING}, 'on', true)`.execute(trx);
        await sql`update people set deceased = true where id = ${c.a}`.execute(trx);
      });
      // Marked deceased with the setting on: Widowed, set automatically (status_auto true), not "by hand".
      expect(await unionState(c.union)).toEqual({ status: 'widowed', status_auto: true });
      await withUserTransaction(single, f.account.superadmin.id, async (trx) => {
        await sql`select set_config(${SETTING}, 'on', true)`.execute(trx);
        await sql`update people set deceased = false, death_date = null where id = ${c.a}`.execute(trx);
      });
      expect(await unionState(c.union)).toEqual({ status: 'married', status_auto: false });
      // A Married relationship saved with a deceased partner, setting on: Widowed, automatic.
      const living = await insertPersonRow(t.owner, 'Setting', 'Living');
      const [pa, pb] = gone < living ? [gone, living] : [living, gone];
      const inserted = await withUserTransaction(single, f.account.superadmin.id, async (trx) => {
        await sql`select set_config(${SETTING}, 'on', true)`.execute(trx);
        const r = await sql<{ id: string }>`
          insert into unions (partner_a_id, partner_b_id, status, created_by)
          values (${pa}, ${pb}, 'married', ${f.account.superadmin.id}) returning id`.execute(trx);
        return r.rows[0]!.id;
      });
      expect(await unionState(inserted)).toEqual({ status: 'widowed', status_auto: true });
    });
  });
});
