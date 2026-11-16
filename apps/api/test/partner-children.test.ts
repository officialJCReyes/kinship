// SPDX-License-Identifier: AGPL-3.0-or-later
//
// GET /api/people/:id carries `partnerChildren`: the children of the person's partners that do not hang from the
// person. The profile derives the step titles and the "children from another relationship" cards from it.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface Row {
  partnerId: string;
  child: { id: string };
  kind: string;
  adopted: boolean;
  otherParent: { id: string } | null;
}
const partnerChildren = async (who: Parameters<typeof as>[0], id: string): Promise<Row[]> =>
  ((await as(who, 'GET', `/api/people/${id}`)).body?.partnerChildren ?? []) as Row[];
const summary = (rows: Row[]) =>
  rows
    .map(
      (r) =>
        `${r.partnerId}>${r.child.id}${r.otherParent ? `+${r.otherParent.id}` : ''}${r.kind === 'adoptive' ? '*' : ''}`,
    )
    .sort();
const setView = (who: 'familyadmin' | 'user', lineageView: 'adoptive' | 'birth') =>
  as(who, 'PATCH', '/api/auth/me', { lineageView });

describe('partnerChildren on the Hale family', () => {
  it('lists a partner’s child who hangs from the partner alone, with no other parent', async () => {
    // Tomas hangs from Beatriz alone; Daniel is married to Beatriz.
    expect(summary(await partnerChildren('user', f.person.daniel))).toEqual([`${f.person.beatriz}>${f.person.tomas}`]);
  });

  it('lists a partner’s children from another relationship, with the other parent', async () => {
    // Marcus and Sofia hang from Daniel and Elena; Beatriz is Daniel's second wife.
    const rows = await partnerChildren('user', f.person.beatriz);
    expect(summary(rows)).toEqual(
      [
        `${f.person.daniel}>${f.person.marcus}+${f.person.elena}`,
        `${f.person.daniel}>${f.person.sofia}+${f.person.elena}`,
      ].sort(),
    );
    expect(rows[0]!.otherParent).toMatchObject({ givenName: 'Elena' });
  });

  it('never lists a child who hangs from the person, even through the relationship with the partner', async () => {
    // Gabriel hangs from Daniel and Beatriz together: not one of Beatriz's "other" children, nor Daniel's.
    const all = [
      ...(await partnerChildren('user', f.person.daniel)),
      ...(await partnerChildren('user', f.person.beatriz)),
    ].map((r) => r.child.id);
    expect(all).not.toContain(f.person.gabriel);
  });

  it('keeps a partner’s children from a later relationship even when the relationship has ended', async () => {
    // Elena and Daniel are divorced, but Gabriel (Daniel's child with Beatriz) is still listed for Elena: whether it
    // counts as a step relative depends on the status, which is the web app's business, not this query's.
    expect(summary(await partnerChildren('user', f.person.elena))).toEqual([
      `${f.person.daniel}>${f.person.gabriel}+${f.person.beatriz}`,
    ]);
  });

  it('is empty for a person with no partner, and for a partner with no other children', async () => {
    expect(await partnerChildren('user', f.person.leo)).toEqual([]);
    expect(await partnerChildren('user', f.person.walter)).toEqual([]);
  });

  it('is readable by every signed-in account', async () => {
    for (const who of ['superadmin', 'familyadmin', 'member', 'unlinked', 'user'] as const) {
      expect((await partnerChildren(who, f.person.beatriz)).length, who).toBe(2);
    }
  });
});

describe('partnerChildren and the viewer’s lineage view', () => {
  it('follows the set the view follows: an adopted-away child is in the family the viewer sees', async () => {
    // Pat (partner of Quinn) adopted Axel with Rae; Axel's birth parents are Sam and Tess. Quinn is Rae's ex? No:
    // Quinn is Pat's partner; Pat's adopted child Axel hangs, in the adoptive set, from Pat and Rae.
    const pat = await insertPersonRow(t.owner, 'Pat', 'Hale');
    const quinn = await insertPersonRow(t.owner, 'Quinn', 'Hale');
    const rae = await insertPersonRow(t.owner, 'Rae', 'Hale');
    const sam = await insertPersonRow(t.owner, 'Sam', 'Born');
    const tess = await insertPersonRow(t.owner, 'Tess', 'Born');
    const axel = await insertPersonRow(t.owner, 'Axel', 'Both');
    await insertUnionRow(t.owner, pat, quinn, 'married');
    const adopters = await insertUnionRow(t.owner, pat, rae, 'divorced');
    const birthParents = await insertUnionRow(t.owner, sam, tess, 'married');
    await linkChild(t.owner, axel, { union: birthParents }, 'birth');
    await linkChild(t.owner, axel, { union: adopters }, 'adoptive');

    // Adoptive view (the default): Quinn's step relatives include Axel, through Pat and Rae.
    expect(await setView('familyadmin', 'adoptive')).toMatchObject({ status: 200 });
    const adoptive = await partnerChildren('familyadmin', quinn);
    expect(summary(adoptive)).toEqual([`${pat}>${axel}+${rae}*`]);
    expect(adoptive[0]).toMatchObject({ kind: 'adoptive', adopted: true });
    // Birth view: Axel follows Sam and Tess, so he is no one's step child here.
    expect(await setView('familyadmin', 'birth')).toMatchObject({ status: 200 });
    expect(await partnerChildren('familyadmin', quinn)).toEqual([]);
    // And the other way round: a partner of Sam sees Axel only in the birth view.
    const uma = await insertPersonRow(t.owner, 'Uma', 'Born');
    await insertUnionRow(t.owner, sam, uma, 'married');
    expect(summary(await partnerChildren('familyadmin', uma))).toEqual([`${sam}>${axel}+${tess}`]);
    await setView('familyadmin', 'adoptive');
    expect(await partnerChildren('familyadmin', uma)).toEqual([]);
  });

  it('is per account: one viewer’s view does not change another’s', async () => {
    await setView('user', 'birth');
    await setView('familyadmin', 'adoptive');
    const pat = await insertPersonRow(t.owner, 'Pia', 'Hale');
    const quinn = await insertPersonRow(t.owner, 'Quin', 'Hale');
    const kid = await insertPersonRow(t.owner, 'Kit', 'Adopt');
    const bio = await insertPersonRow(t.owner, 'Bio', 'Parent');
    await insertUnionRow(t.owner, pat, quinn, 'married');
    await linkChild(t.owner, kid, { parent: bio }, 'birth');
    await linkChild(t.owner, kid, { parent: pat }, 'adoptive');
    expect(summary(await partnerChildren('familyadmin', quinn))).toEqual([`${pat}>${kid}*`]);
    expect(await partnerChildren('user', quinn)).toEqual([]);
    await setView('user', 'adoptive');
  });
});

// ---------------------------------------------------------------------------
// A seeded property test against a plain model of the rule.
// ---------------------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('partnerChildren: the rule, over random families', () => {
  let checked = 0;
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'matches a plain model for seed %i',
    async (seed) => {
      const random = rng(seed);
      const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
      const people: string[] = [];
      for (let i = 0; i < 9; i++) people.push(await insertPersonRow(t.owner, `Prop${seed}`, `P${i}`));
      const unionIds: string[] = [];
      for (let i = 0; i < 12; i++) {
        const a = Math.floor(random() * people.length);
        const b = Math.floor(random() * people.length);
        if (a === b) continue;
        unionIds.push(
          await insertUnionRow(t.owner, people[a]!, people[b]!, pick(['married', 'divorced', 'partner', 'widowed'])),
        );
      }
      // Children: person i may hang from a union or a single parent among the earlier people (so there are no cycles),
      // and may have an adoptive set too. Rows the database refuses (for example the same person in both sets) are skipped.
      const unionRows = (
        await sql<{
          id: string;
          a: string;
          b: string;
        }>`select id, partner_a_id as a, partner_b_id as b from unions where id = any(${unionIds}::uuid[])`.execute(
          t.owner,
        )
      ).rows;
      for (let i = 1; i < people.length; i++) {
        for (const kind of ['birth', 'adoptive'] as const) {
          if (random() < (kind === 'birth' ? 0.7 : 0.25)) {
            const earlier = new Set(people.slice(0, i));
            const usable = unionRows.filter((u) => earlier.has(u.a) && earlier.has(u.b));
            try {
              if (usable.length > 0 && random() < 0.6)
                await linkChild(t.owner, people[i]!, { union: pick(usable).id }, kind);
              else await linkChild(t.owner, people[i]!, { parent: people[Math.floor(random() * i)]! }, kind);
            } catch {
              // refused by a database rule: leave this child without that set
            }
          }
        }
      }

      // The model, from what is really stored.
      const links = (
        await sql<{ child_id: string; kind: string; union_id: string | null; parent_id: string | null }>`
        select child_id, kind, union_id, parent_id from person_parents where child_id = any(${people}::uuid[])`.execute(
          t.owner,
        )
      ).rows;
      const allUnions = (
        await sql<{
          id: string;
          a: string;
          b: string;
        }>`select id, partner_a_id as a, partner_b_id as b from unions where partner_a_id = any(${people}::uuid[])`.execute(
          t.owner,
        )
      ).rows;
      const byId = new Map(allUnions.map((u) => [u.id, u]));
      const followed = (child: string, view: 'adoptive' | 'birth') => {
        const sets = links.filter((l) => l.child_id === child);
        const kind = view === 'adoptive' && sets.some((l) => l.kind === 'adoptive') ? 'adoptive' : 'birth';
        return sets.find((l) => l.kind === kind);
      };
      const parentsOf = (l: NonNullable<ReturnType<typeof followed>>) =>
        l.parent_id ? [l.parent_id] : [byId.get(l.union_id!)!.a, byId.get(l.union_id!)!.b];

      for (const view of ['adoptive', 'birth'] as const) {
        await setView('familyadmin', view);
        for (const person of people) {
          const partners = new Set(
            allUnions.filter((u) => u.a === person || u.b === person).map((u) => (u.a === person ? u.b : u.a)),
          );
          const expected: string[] = [];
          for (const q of partners) {
            for (const child of people) {
              const set = followed(child, view);
              if (!set || child === person) continue;
              const parents = parentsOf(set);
              if (!parents.includes(q) || parents.includes(person)) continue;
              const other = parents.find((p) => p !== q);
              expected.push(
                `${q}>${child}${set.union_id && other ? `+${other}` : ''}${set.kind === 'adoptive' ? '*' : ''}`,
              );
            }
          }
          const actual = summary(await partnerChildren('familyadmin', person));
          expect(actual, `seed ${seed} ${view} ${person}`).toEqual(expected.sort());
          checked += expected.length;
        }
      }
      await setView('familyadmin', 'adoptive');
    },
    90_000,
  );

  it('was not checking empty families', () => {
    expect(checked).toBeGreaterThan(20);
  });
});
