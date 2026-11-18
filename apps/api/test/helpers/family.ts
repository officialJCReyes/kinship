// SPDX-License-Identifier: AGPL-3.0-or-later
import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import type { UntypedDb } from '../../src/db.js';
import { CSRF, cookieHeader, insertUser, login } from './app.js';

/**
 * A small fictional family, built in test code (nothing real ever goes in this repo):
 *
 *   Walter Hale + Rosa Mendez (married)
 *     └─ Daniel Hale
 *          ├─ with Elena Ruiz   (married, then divorced 2003): Marcus, Sofia
 *          ├─ with Beatriz Navarro (married 2006, a second union after the divorce): Gabriel
 *          │    (Gabriel is Marcus and Sofia's half-brother, through Daniel)
 *          └─ Beatriz also has Tomas Navarro on her own (a single-parent child; no other parent on the tree)
 *   Marcus Hale + Priya Nair (married): Leo   (a child with two parents)
 *
 * Accounts (password PASSWORD in helpers/app.ts):
 *   superadmin, familyadmin      linked to nobody
 *   member       a Member linked to Marcus
 *   unlinked     a Member linked to nobody
 *   user         a read-only User
 */
export const NAMES = [
  ['walter', 'Walter', 'Hale', 'male', '1931', true],
  ['rosa', 'Rosa', 'Mendez', 'female', '1934', false],
  ['daniel', 'Daniel', 'Hale', 'male', '1958', false],
  ['elena', 'Elena', 'Ruiz', 'female', '1960', false],
  ['beatriz', 'Beatriz', 'Navarro', 'female', '1965', false],
  ['marcus', 'Marcus', 'Hale', 'male', '1986', false],
  ['sofia', 'Sofia', 'Hale', 'female', '1989', false],
  ['gabriel', 'Gabriel', 'Hale', 'male', '2007', false],
  ['tomas', 'Tomas', 'Navarro', 'male', '1994', false],
  ['priya', 'Priya', 'Nair', 'female', '1987', false],
  ['leo', 'Leo', 'Hale', 'male', '2017', false],
] as const;
export type PersonKey = (typeof NAMES)[number][0];

export const ACCOUNTS = ['superadmin', 'familyadmin', 'member', 'unlinked', 'user'] as const;
export type AccountKey = (typeof ACCOUNTS)[number];
const ROLE: Record<AccountKey, string> = {
  superadmin: 'superadmin',
  familyadmin: 'familyadmin',
  member: 'member',
  unlinked: 'member',
  user: 'user',
};

export interface Family {
  person: Record<PersonKey, string>;
  /** Union ids by name. */
  union: {
    walterRosa: string;
    danielElena: string;
    danielBeatriz: string;
    marcusPriya: string;
  };
  account: Record<AccountKey, { id: string; email: string }>;
}

const sorted = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

export async function insertPersonRow(
  owner: UntypedDb,
  given: string,
  surname: string,
  extra: { gender?: string | null; birth?: string | null; deceased?: boolean; createdBy?: string | null } = {},
): Promise<string> {
  const result = await sql<{ id: string }>`
    insert into people (given_name, surname, gender, birth_date, deceased, created_by)
    values (${given}, ${surname}, ${extra.gender ?? null}, ${extra.birth ?? null}, ${extra.deceased ?? false}, ${extra.createdBy ?? null})
    returning id`.execute(owner);
  return result.rows[0]!.id;
}

export async function insertUnionRow(
  owner: UntypedDb,
  one: string,
  two: string,
  status: string,
  dates: { start?: string; end?: string } = {},
): Promise<string> {
  const [a, b] = sorted(one, two);
  const result = await sql<{ id: string }>`
    insert into unions (partner_a_id, partner_b_id, status, start_date, end_date)
    values (${a}, ${b}, ${status}, ${dates.start ?? null}, ${dates.end ?? null}) returning id`.execute(owner);
  return result.rows[0]!.id;
}

export async function linkChild(
  owner: UntypedDb,
  child: string,
  from: { union: string } | { parent: string },
  kind: 'birth' | 'adoptive' = 'birth',
  linkDate: string | null = null,
): Promise<void> {
  const union = 'union' in from ? from.union : null;
  const parent = 'parent' in from ? from.parent : null;
  await sql`insert into person_parents (child_id, union_id, parent_id, kind, link_date)
            values (${child}, ${union}, ${parent}, ${kind}, ${linkDate})`.execute(owner);
}

/** Inserts the family and the five accounts as the owner role (the way a restore or a migration would). */
export async function buildFamily(owner: UntypedDb): Promise<Family> {
  const person = {} as Record<PersonKey, string>;
  for (const [key, given, surname, gender, birth, deceased] of NAMES) {
    person[key] = await insertPersonRow(owner, given, surname, { gender, birth, deceased });
  }
  const union = {
    walterRosa: await insertUnionRow(owner, person.walter, person.rosa, 'married', { start: '1955-06-04' }),
    danielElena: await insertUnionRow(owner, person.daniel, person.elena, 'divorced', {
      start: '1984-08-01',
      end: '2003-05',
    }),
    danielBeatriz: await insertUnionRow(owner, person.daniel, person.beatriz, 'married', { start: '2006-09-16' }),
    marcusPriya: await insertUnionRow(owner, person.marcus, person.priya, 'married', { start: '2013-06-08' }),
  };
  await linkChild(owner, person.daniel, { union: union.walterRosa });
  await linkChild(owner, person.marcus, { union: union.danielElena });
  await linkChild(owner, person.sofia, { union: union.danielElena });
  await linkChild(owner, person.gabriel, { union: union.danielBeatriz });
  await linkChild(owner, person.tomas, { parent: person.beatriz });
  await linkChild(owner, person.leo, { union: union.marcusPriya });

  const account = {} as Family['account'];
  for (const key of ACCOUNTS) {
    const email = `${key}@example.com`;
    const id = await insertUser(owner, { email, displayName: key, role: ROLE[key] });
    account[key] = { id, email };
  }
  await sql`update users set person_id = ${person.marcus} where id = ${account.member.id}`.execute(owner);
  return { person, union, account };
}

// Response bodies are checked field by field in the tests, so they are loosely typed on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

export type Who = AccountKey | 'anonymous';

/** Signs everyone in once; returns a function that sends a request as one of them. */
export async function signInAll(app: FastifyInstance, family: Family) {
  const cookies = {} as Record<AccountKey, string>;
  for (const key of ACCOUNTS) {
    cookies[key] = cookieHeader(await login(app, family.account[key].email));
  }
  return async function as(
    who: Who,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) {
    const response = await app.inject({
      method,
      url,
      headers: { ...CSRF, ...(who === 'anonymous' ? {} : { cookie: cookies[who] }) },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    const text = response.body;
    return { status: response.statusCode, body: text ? (JSON.parse(text) as Json) : null };
  };
}
