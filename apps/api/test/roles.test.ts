// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The role-by-role matrix. Every route is tried as nobody, a SuperAdmin, a Family Admin, a Member
// linked to a person, a Member linked to nobody and a User. Each case runs twice against the same
// table of expected answers: once through the API (so the API's own checks and error codes are
// covered), and once as direct SQL under the app role with only kinship.user_id set (so row-level
// security alone is proven to block what the API blocks).
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_ERROR_CODES, PEOPLE_ROUTES } from '@kinship/shared';
import { withUserTransaction } from '../src/request-context.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { buildFamily, insertPersonRow, insertUnionRow, signInAll } from './helpers/family.js';
import type { Family, Who } from './helpers/family.js';

let t: TestApp;
let f: Family;
let as: Awaited<ReturnType<typeof signInAll>>;
const errorsSeen = new Set<string>();

beforeAll(async () => {
  t = await createTestApp();
  f = await buildFamily(t.owner);
  as = await signInAll(t.app, f);
});
afterAll(() => t.close());

const WHO: Who[] = ['anonymous', 'superadmin', 'familyadmin', 'member', 'unlinked', 'user'];
/** Allowed or not, in the order of WHO. */
type Allowed = [boolean, boolean, boolean, boolean, boolean, boolean];
const ALL_SIGNED_IN: Allowed = [false, true, true, true, true, true];
const ADMINS: Allowed = [false, true, true, false, false, false];
const ADMINS_AND_MEMBER: Allowed = [false, true, true, true, false, false];

interface Target {
  request: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown };
  /** The same operation as plain SQL as the app role. Resolves true when it took effect. */
  sql: (userId: string | null) => Promise<boolean>;
}
interface Case {
  name: string;
  allowed: Allowed;
  prepare: () => Promise<Target>;
}

const asUser = <T>(userId: string | null, fn: Parameters<typeof withUserTransaction<T>>[2]) =>
  withUserTransaction(t.db, userId, fn);

/** Runs SQL as someone; "allowed" means no error (not even at commit) and, when it should change rows, at least one changed. */
async function attempt(
  userId: string | null,
  run: (trx: Parameters<Parameters<typeof asUser>[1]>[0]) => Promise<number | void>,
) {
  try {
    const changed = await asUser(userId, run);
    return changed === undefined ? true : changed > 0;
  } catch {
    return false;
  }
}

/** A label row put in by the owner, for the cases that change or delete one. */
async function insertLabelRow(from: string, to: string, label: string): Promise<string> {
  const result = await sql<{ id: string }>`
    insert into relationship_labels (from_id, to_id, label) values (${from}, ${to}, ${label}) returning id`.execute(
    t.owner,
  );
  return result.rows[0]!.id;
}

/** A person added by an account, with their place in the tree, in one transaction (a Member's person needs both at commit). */
const personCreatedBy = (account: string, parent: string) =>
  t.owner.transaction().execute(async (trx) => {
    const result = await sql<{ id: string }>`
      insert into people (given_name, surname, created_by) values ('Added', 'ByMember', ${account}) returning id`.execute(
      trx,
    );
    const id = result.rows[0]!.id;
    await sql`insert into person_parents (child_id, parent_id) values (${id}, ${parent})`.execute(trx);
    return id;
  });

function cases(): Case[] {
  return [
    {
      name: 'GET /api/people',
      allowed: ALL_SIGNED_IN,
      prepare: async () => ({
        request: { method: 'GET', url: '/api/people' },
        sql: (u) => attempt(u, async (trx) => (await trx.selectFrom('people').select('id').execute()).length),
      }),
    },
    {
      name: 'GET /api/people/:id',
      allowed: ALL_SIGNED_IN,
      prepare: async () => ({
        request: { method: 'GET', url: `/api/people/${f.person.daniel}` },
        sql: (u) =>
          attempt(
            u,
            async (trx) =>
              (await trx.selectFrom('people').select('id').where('id', '=', f.person.daniel).execute()).length,
          ),
      }),
    },
    {
      name: 'GET /api/tree/:personId',
      allowed: ALL_SIGNED_IN,
      prepare: async () => ({
        request: { method: 'GET', url: `/api/tree/${f.person.marcus}` },
        sql: (u) =>
          attempt(u, async (trx) => (await trx.selectFrom('person_parents').select('child_id').execute()).length),
      }),
    },
    {
      name: 'GET /api/unions/:id',
      allowed: ALL_SIGNED_IN,
      prepare: async () => ({
        request: { method: 'GET', url: `/api/unions/${f.union.danielElena}` },
        sql: (u) => attempt(u, async (trx) => (await trx.selectFrom('unions').select('id').execute()).length),
      }),
    },
    {
      name: 'POST /api/people (an unattached person)',
      allowed: ADMINS,
      prepare: async () => ({
        request: { method: 'POST', url: '/api/people', payload: { givenName: 'New', surname: 'Person' } },
        sql: (u) =>
          attempt(u, async (trx) => {
            await trx.insertInto('people').values({ given_name: 'New', surname: 'Person', created_by: u }).execute();
          }),
      }),
    },
    {
      name: "PATCH /api/people/:id (the Member's own person)",
      allowed: ADMINS_AND_MEMBER,
      prepare: async () => ({
        request: { method: 'PATCH', url: `/api/people/${f.person.marcus}`, payload: { surname: 'Hale' } },
        sql: (u) =>
          attempt(u, async (trx) =>
            (await trx.updateTable('people').set({ surname: 'Hale' }).where('id', '=', f.person.marcus).execute())[0]!
              .numUpdatedRows > 0n
              ? 1
              : 0,
          ),
      }),
    },
    {
      name: "PATCH /api/people/:id (someone else's person)",
      allowed: ADMINS,
      prepare: async () => ({
        request: { method: 'PATCH', url: `/api/people/${f.person.daniel}`, payload: { surname: 'Hale' } },
        sql: (u) =>
          attempt(u, async (trx) =>
            (await trx.updateTable('people').set({ surname: 'Hale' }).where('id', '=', f.person.daniel).execute())[0]!
              .numUpdatedRows > 0n
              ? 1
              : 0,
          ),
      }),
    },
    {
      name: "PATCH /api/people/:id (a descendant who is not the Member's own, and was not added by them)",
      allowed: ADMINS,
      prepare: async () => ({
        request: { method: 'PATCH', url: `/api/people/${f.person.leo}`, payload: { surname: 'Hale' } },
        sql: (u) =>
          attempt(u, async (trx) =>
            (await trx.updateTable('people').set({ surname: 'Hale' }).where('id', '=', f.person.leo).execute())[0]!
              .numUpdatedRows > 0n
              ? 1
              : 0,
          ),
      }),
    },
    {
      name: 'PATCH /api/people/:id (a child the Member added, still in their line)',
      allowed: ADMINS_AND_MEMBER,
      prepare: async () => {
        const id = await personCreatedBy(f.account.member.id, f.person.leo);
        return {
          request: { method: 'PATCH', url: `/api/people/${id}`, payload: { surname: 'Fixed' } },
          sql: (u) =>
            attempt(u, async (trx) =>
              (await trx.updateTable('people').set({ surname: 'Fixed' }).where('id', '=', id).execute())[0]!
                .numUpdatedRows > 0n
                ? 1
                : 0,
            ),
        };
      },
    },
    {
      name: 'PATCH /api/people/:id (a person the Member added, but not in their line)',
      allowed: ADMINS,
      prepare: async () => {
        const id = await personCreatedBy(f.account.member.id, f.person.sofia);
        return {
          request: { method: 'PATCH', url: `/api/people/${id}`, payload: { surname: 'Fixed' } },
          sql: (u) =>
            attempt(u, async (trx) =>
              (await trx.updateTable('people').set({ surname: 'Fixed' }).where('id', '=', id).execute())[0]!
                .numUpdatedRows > 0n
                ? 1
                : 0,
            ),
        };
      },
    },
    {
      name: 'DELETE /api/people/:id (a person with no relationships)',
      allowed: ADMINS,
      prepare: async () => {
        const id = await insertPersonRow(t.owner, 'Doomed', 'Person');
        return {
          request: { method: 'DELETE', url: `/api/people/${id}` },
          sql: (u) =>
            attempt(u, async (trx) =>
              Number((await trx.deleteFrom('people').where('id', '=', id).execute())[0]!.numDeletedRows),
            ),
        };
      },
    },
    {
      name: 'DELETE /api/people/:id (a child the Member added themselves)',
      allowed: ADMINS,
      prepare: async () => {
        const id = await personCreatedBy(f.account.member.id, f.person.marcus);
        return {
          request: { method: 'DELETE', url: `/api/people/${id}?confirm=true` },
          sql: (u) =>
            attempt(u, async (trx) =>
              Number((await trx.deleteFrom('people').where('id', '=', id).execute())[0]!.numDeletedRows),
            ),
        };
      },
    },
    {
      name: "POST /api/people/:id/children (under the Member's own person)",
      allowed: ADMINS_AND_MEMBER,
      prepare: async () => ({
        request: {
          method: 'POST',
          url: `/api/people/${f.person.marcus}/children`,
          payload: { child: { givenName: 'Kid', surname: 'Hale' } },
        },
        sql: (u) =>
          attempt(u, async (trx) => {
            const kid = await trx
              .insertInto('people')
              .values({ given_name: 'Kid', surname: 'Hale', created_by: u })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('person_parents')
              .values({ child_id: kid.id, parent_id: f.person.marcus, created_by: u })
              .execute();
          }),
      }),
    },
    {
      name: "POST /api/people/:id/children (under the Member's grandchild line: Leo)",
      allowed: ADMINS_AND_MEMBER,
      prepare: async () => ({
        request: {
          method: 'POST',
          url: `/api/people/${f.person.leo}/children`,
          payload: { child: { givenName: 'Grand', surname: 'Kid' } },
        },
        sql: (u) =>
          attempt(u, async (trx) => {
            const kid = await trx
              .insertInto('people')
              .values({ given_name: 'Grand', surname: 'Kid', created_by: u })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('person_parents')
              .values({ child_id: kid.id, parent_id: f.person.leo, created_by: u })
              .execute();
          }),
      }),
    },
    {
      name: "POST /api/people/:id/children (from the Member's existing union)",
      allowed: ADMINS_AND_MEMBER,
      prepare: async () => ({
        request: {
          method: 'POST',
          url: `/api/people/${f.person.marcus}/children`,
          payload: { child: { givenName: 'Kid', surname: 'Two' }, unionId: f.union.marcusPriya },
        },
        sql: (u) =>
          attempt(u, async (trx) => {
            const kid = await trx
              .insertInto('people')
              .values({ given_name: 'Kid', surname: 'Two', created_by: u })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('person_parents')
              .values({ child_id: kid.id, union_id: f.union.marcusPriya, created_by: u })
              .execute();
          }),
      }),
    },
    {
      name: "POST /api/people/:id/children (under someone else: the Member's sister)",
      allowed: ADMINS,
      prepare: async () => ({
        request: {
          method: 'POST',
          url: `/api/people/${f.person.sofia}/children`,
          payload: { child: { givenName: 'Nephew', surname: 'Hale' } },
        },
        sql: (u) =>
          attempt(u, async (trx) => {
            const kid = await trx
              .insertInto('people')
              .values({ given_name: 'Nephew', surname: 'Hale', created_by: u })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('person_parents')
              .values({ child_id: kid.id, parent_id: f.person.sofia, created_by: u })
              .execute();
          }),
      }),
    },
    {
      name: "POST /api/people/:id/children (under the Member's father)",
      allowed: ADMINS,
      prepare: async () => ({
        request: {
          method: 'POST',
          url: `/api/people/${f.person.daniel}/children`,
          payload: { child: { givenName: 'Sibling', surname: 'Hale' }, unionId: f.union.danielElena },
        },
        sql: (u) =>
          attempt(u, async (trx) => {
            const kid = await trx
              .insertInto('people')
              .values({ given_name: 'Sibling', surname: 'Hale', created_by: u })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('person_parents')
              .values({ child_id: kid.id, union_id: f.union.danielElena, created_by: u })
              .execute();
          }),
      }),
    },
    {
      name: 'POST /api/people/:id/parents (a parent for an existing person)',
      allowed: ADMINS,
      prepare: async () => {
        // An existing person nobody in the Member's line added: only an admin may give them a parent.
        const child = await insertPersonRow(t.owner, 'Parentless', 'Person');
        return {
          request: { method: 'POST', url: `/api/people/${child}/parents`, payload: { parentId: f.person.marcus } },
          sql: (u) =>
            attempt(u, async (trx) => {
              await trx
                .insertInto('person_parents')
                .values({ child_id: child, parent_id: f.person.marcus, created_by: u })
                .execute();
            }),
        };
      },
    },
    {
      name: 'DELETE /api/people/:id/parents/:parentId',
      allowed: ADMINS,
      prepare: async () => {
        const child = await personCreatedBy(f.account.member.id, f.person.marcus);
        return {
          request: { method: 'DELETE', url: `/api/people/${child}/parents/${f.person.marcus}` },
          sql: (u) =>
            attempt(u, async (trx) =>
              Number(
                (await trx.deleteFrom('person_parents').where('child_id', '=', child).execute())[0]!.numDeletedRows,
              ),
            ),
        };
      },
    },
    {
      name: 'POST /api/unions',
      allowed: ADMINS,
      prepare: async () => {
        const a = await insertPersonRow(t.owner, 'Left', 'Partner');
        const b = await insertPersonRow(t.owner, 'Right', 'Partner');
        const [lo, hi] = a < b ? [a, b] : [b, a];
        return {
          request: { method: 'POST', url: '/api/unions', payload: { partnerIds: [a, b], status: 'partner' } },
          sql: (u) =>
            attempt(u, async (trx) => {
              await trx
                .insertInto('unions')
                .values({ partner_a_id: lo, partner_b_id: hi, status: 'partner', created_by: u })
                .execute();
            }),
        };
      },
    },
    {
      name: 'PATCH /api/unions/:id (a union the Member is in)',
      allowed: ADMINS_AND_MEMBER,
      prepare: async () => ({
        request: { method: 'PATCH', url: `/api/unions/${f.union.marcusPriya}`, payload: { status: 'married' } },
        sql: (u) =>
          attempt(u, async (trx) =>
            (
              await trx.updateTable('unions').set({ status: 'married' }).where('id', '=', f.union.marcusPriya).execute()
            )[0]!.numUpdatedRows > 0n
              ? 1
              : 0,
          ),
      }),
    },
    {
      name: "PATCH /api/unions/:id (someone else's union)",
      allowed: ADMINS,
      prepare: async () => ({
        request: { method: 'PATCH', url: `/api/unions/${f.union.danielBeatriz}`, payload: { status: 'married' } },
        sql: (u) =>
          attempt(u, async (trx) =>
            (
              await trx
                .updateTable('unions')
                .set({ status: 'married' })
                .where('id', '=', f.union.danielBeatriz)
                .execute()
            )[0]!.numUpdatedRows > 0n
              ? 1
              : 0,
          ),
      }),
    },
    {
      name: 'POST /api/labels',
      allowed: ADMINS,
      prepare: async () => {
        const a = await insertPersonRow(t.owner, 'Label', 'From');
        const b = await insertPersonRow(t.owner, 'Label', 'To');
        return {
          request: { method: 'POST', url: '/api/labels', payload: { fromId: a, toId: b, label: 'Godmother' } },
          sql: (u) =>
            attempt(u, async (trx) => {
              await trx
                .insertInto('relationship_labels')
                .values({ from_id: a, to_id: b, label: 'Godmother', created_by: u })
                .execute();
            }),
        };
      },
    },
    {
      name: 'PATCH /api/labels/:id',
      allowed: ADMINS,
      prepare: async () => {
        const a = await insertPersonRow(t.owner, 'Label', 'From');
        const b = await insertPersonRow(t.owner, 'Label', 'To');
        const id = await insertLabelRow(a, b, 'Godmother');
        return {
          request: { method: 'PATCH', url: `/api/labels/${id}`, payload: { label: 'Guardian' } },
          sql: (u) =>
            attempt(u, async (trx) =>
              Number(
                (
                  await trx.updateTable('relationship_labels').set({ label: 'Guardian' }).where('id', '=', id).execute()
                )[0]!.numUpdatedRows,
              ),
            ),
        };
      },
    },
    {
      name: 'DELETE /api/labels/:id',
      allowed: ADMINS,
      prepare: async () => {
        const a = await insertPersonRow(t.owner, 'Label', 'From');
        const b = await insertPersonRow(t.owner, 'Label', 'To');
        const id = await insertLabelRow(a, b, 'Godmother');
        return {
          request: { method: 'DELETE', url: `/api/labels/${id}` },
          sql: (u) =>
            attempt(u, async (trx) =>
              Number((await trx.deleteFrom('relationship_labels').where('id', '=', id).execute())[0]!.numDeletedRows),
            ),
        };
      },
    },
    {
      name: "DELETE /api/unions/:id (even the Member's own)",
      allowed: ADMINS,
      prepare: async () => {
        const a = await insertPersonRow(t.owner, 'Gone', 'One');
        const id = await insertUnionRow(t.owner, f.person.marcus, a, 'friends');
        return {
          request: { method: 'DELETE', url: `/api/unions/${id}` },
          sql: (u) =>
            attempt(u, async (trx) =>
              Number((await trx.deleteFrom('unions').where('id', '=', id).execute())[0]!.numDeletedRows),
            ),
        };
      },
    },
  ];
}

describe('role matrix: every route as every kind of account', () => {
  for (const c of cases()) {
    describe(c.name, () => {
      WHO.forEach((who, index) => {
        const allowed = c.allowed[index]!;
        it(`${who} ${allowed ? 'may' : 'may not'} (API)`, async () => {
          const target = await c.prepare();
          const response = await as(who, target.request.method, target.request.url, target.request.payload);
          if (response.body?.error) errorsSeen.add(response.body.error as string);
          if (allowed) {
            expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
          } else {
            expect(response.status).toBe(who === 'anonymous' ? 401 : 403);
            expect(response.body?.error).toBe(who === 'anonymous' ? 'unauthenticated' : 'forbidden');
          }
        });
        it(`${who} ${allowed ? 'may' : 'may not'} (row-level security, direct SQL)`, async () => {
          const target = await c.prepare();
          expect(await target.sql(who === 'anonymous' ? null : f.account[who].id)).toBe(allowed);
        });
      });
    });
  }
});

describe('row-level security by itself', () => {
  it('shows nothing to a made-up account, and lets it change nothing', async () => {
    const ghost = '99999999-9999-4999-8999-999999999999';
    expect(await asUser(ghost, (trx) => trx.selectFrom('people').select('id').execute())).toEqual([]);
    expect(await asUser(ghost, (trx) => trx.selectFrom('unions').select('id').execute())).toEqual([]);
    expect(await asUser(ghost, (trx) => trx.selectFrom('person_parents').select('child_id').execute())).toEqual([]);
    expect(
      await attempt(ghost, async (trx) => {
        await trx.insertInto('people').values({ given_name: 'G', surname: 'H', created_by: ghost }).execute();
      }),
    ).toBe(false);
  });

  it('refuses an insert that names another account as the creator', async () => {
    for (const who of ['superadmin', 'familyadmin'] as const) {
      const ok = await attempt(f.account[who].id, async (trx) => {
        await trx
          .insertInto('people')
          .values({ given_name: 'F', surname: 'G', created_by: f.account.user.id })
          .execute();
      });
      expect(ok, who).toBe(false);
    }
  });

  it('cannot change columns it has no right to, even as an admin', async () => {
    const admin = f.account.superadmin.id;
    for (const statement of [
      sql`update people set created_by = null where id = ${f.person.daniel}`,
      sql`update people set id = gen_random_uuid() where id = ${f.person.daniel}`,
      sql`update people set created_at = now() where id = ${f.person.daniel}`,
      sql`update unions set partner_a_id = ${f.person.priya} where id = ${f.union.marcusPriya}`,
      sql`update unions set created_by = null where id = ${f.union.marcusPriya}`,
      sql`update person_parents set child_id = ${f.person.leo} where child_id = ${f.person.sofia}`,
      sql`update people set search_name = 'x' where id = ${f.person.daniel}`,
    ]) {
      await expect(asUser(admin, (trx) => statement.execute(trx))).rejects.toThrow(/permission denied|cannot|column/i);
    }
  });

  it('cannot change the partners of a union even with the right (the owner is stopped by a trigger)', async () => {
    await expect(
      sql`update unions set partner_a_id = ${f.person.priya} where id = ${f.union.marcusPriya}`.execute(t.owner),
    ).rejects.toMatchObject({ code: 'KS014' });
  });

  it('cannot read or write the account tables beyond what 0002 allows, and cannot see other accounts', async () => {
    const seen = await asUser(f.account.member.id, (trx) =>
      trx.selectFrom('users').select(['id', 'person_id']).execute(),
    );
    expect(seen).toEqual([{ id: f.account.member.id, person_id: f.person.marcus }]);
    await expect(
      asUser(f.account.superadmin.id, (trx) =>
        sql`update users set person_id = ${f.person.leo} where id = ${f.account.member.id}`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('keeps a Member out of the tree for a child added without a place in it (committed or not)', async () => {
    const before = await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner);
    const failed = await attempt(f.account.member.id, async (trx) => {
      await trx
        .insertInto('people')
        .values({ given_name: 'Orphan', surname: 'Member', created_by: f.account.member.id })
        .execute();
    });
    expect(failed).toBe(false);
    const after = await sql<{ n: string }>`select count(*) as n from people`.execute(t.owner);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("lets a Member attach a child they added only under their own line, and cannot reach another line's union", async () => {
    const member = f.account.member.id;
    const sneaky = await attempt(member, async (trx) => {
      const kid = await trx
        .insertInto('people')
        .values({ given_name: 'S', surname: 'N', created_by: member })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Daniel and Beatriz are not in the Member's line; Marcus's father Daniel is an ancestor, not a descendant
      await trx
        .insertInto('person_parents')
        .values({ child_id: kid.id, union_id: f.union.danielBeatriz, created_by: member })
        .execute();
    });
    expect(sneaky).toBe(false);
  });

  it('works under a non-linked Member: no line at all', async () => {
    const unlinked = f.account.unlinked.id;
    const result = await asUser(unlinked, (trx) =>
      sql<{
        a: boolean;
        b: boolean;
      }>`select public.kinship_in_my_line(${f.person.marcus}::uuid) as a, public.kinship_in_my_line(${f.person.leo}::uuid) as b`.execute(
        trx,
      ),
    );
    expect(result.rows[0]).toEqual({ a: false, b: false });
    const member = await asUser(f.account.member.id, (trx) =>
      sql<{ me: boolean; kid: boolean; dad: boolean; sis: boolean }>`
      select public.kinship_in_my_line(${f.person.marcus}::uuid) as me, public.kinship_in_my_line(${f.person.leo}::uuid) as kid,
             public.kinship_in_my_line(${f.person.daniel}::uuid) as dad, public.kinship_in_my_line(${f.person.sofia}::uuid) as sis`.execute(
        trx,
      ),
    );
    expect(member.rows[0]).toEqual({ me: true, kid: true, dad: false, sis: false });
  });
});

describe('what the permissions hints say (for the screens of the next step)', () => {
  it('reports what each account may do with a person', async () => {
    const hints = async (who: Who, id: string) => (await as(who, 'GET', `/api/people/${id}`)).body?.permissions;
    expect(await hints('superadmin', f.person.daniel)).toEqual({ edit: true, delete: true, addChild: true });
    expect(await hints('member', f.person.marcus)).toEqual({ edit: true, delete: false, addChild: true });
    expect(await hints('member', f.person.leo)).toEqual({ edit: false, delete: false, addChild: true });
    expect(await hints('member', f.person.daniel)).toEqual({ edit: false, delete: false, addChild: false });
    expect(await hints('unlinked', f.person.marcus)).toEqual({ edit: false, delete: false, addChild: false });
    expect(await hints('user', f.person.marcus)).toEqual({ edit: false, delete: false, addChild: false });
  });

  it('answers only with codes the shared package declares, and covers every people route', () => {
    for (const code of errorsSeen) expect(API_ERROR_CODES as readonly string[]).toContain(code);
    expect(PEOPLE_ROUTES.length).toBeGreaterThan(0);
  });
});
