// SPDX-License-Identifier: AGPL-3.0-or-later
// A small fictional family (the Hales) and the API answers for it, for the people screens' tests.
import type {
  AuthUser,
  Gender,
  Parentage,
  Person,
  PersonDetail,
  PersonPermissions,
  TreeResponse,
  Union,
  UnionStatus,
} from '@kinship/shared';
import { ME, signedIn } from './helpers.js';
import type { MockRoute } from './helpers.js';

function person(
  id: string,
  givenName: string,
  surname: string,
  gender: Gender | null,
  birth: string | null,
  death: string | null = null,
): Person {
  return {
    id,
    givenName,
    surname,
    gender,
    birth: birth ? { value: birth, precision: 'exactly' } : null,
    deceased: death !== null,
    death: death ? { value: death, precision: 'exactly' } : null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

export const PEOPLE: Person[] = [
  person('walter', 'Walter', 'Hale', 'male', '1930', '2005'),
  person('rosa', 'Rosa', 'Hale', 'female', '1934'),
  person('daniel', 'Daniel', 'Hale', 'male', '1960'),
  person('elena', 'Elena', 'Ruiz', 'female', '1962'),
  person('priya', 'Priya', 'Nair', 'female', '1965'),
  person('marcus', 'Marcus', 'Hale', 'male', '1988'),
  person('sofia', 'Sofia', 'Hale', 'female', '1991'),
  person('carla', 'Carla', 'Nair', 'female', '1995'),
  person('ben', 'Ben', 'Hale', 'male', '2000'),
  person('lena', 'Lena', 'Okafor', 'other', '1989'),
];

function union(
  id: string,
  a: string,
  b: string,
  status: UnionStatus,
  start: string | null,
  end: string | null = null,
): Union {
  return {
    id,
    partnerIds: [a, b],
    status,
    start: start ? { value: start, precision: 'exactly' } : null,
    end: end ? { value: end, precision: 'exactly' } : null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

export const UNIONS: Union[] = [
  union('u0', 'rosa', 'walter', 'widowed', '1955-06-04'),
  union('u1', 'daniel', 'elena', 'married', '1985-05'),
  union('u2', 'daniel', 'priya', 'divorced', '1993', '1998-03-09'),
];

/** Where each child hangs from. */
export const PARENTAGE: Record<string, { unionId?: string; parentId?: string }> = {
  daniel: { unionId: 'u0' },
  marcus: { unionId: 'u1' },
  sofia: { unionId: 'u1' },
  carla: { unionId: 'u2' },
  ben: { parentId: 'daniel' },
};

function parentageOf(id: string): Parentage | null {
  const row = PARENTAGE[id];
  return row ? { unionId: row.unionId ?? null, parentId: row.parentId ?? null } : null;
}

export const ADMIN: AuthUser = {
  id: 'u-admin',
  email: 'a@example.com',
  displayName: 'Ada Admin',
  role: 'superadmin',
  personId: null,
};
export const MEMBER: AuthUser = {
  id: 'u-member',
  email: 'm@example.com',
  displayName: 'Marcus Hale',
  role: 'member',
  personId: 'marcus',
};
export const READER: AuthUser = {
  id: 'u-user',
  email: 'r@example.com',
  displayName: 'Rae Reader',
  role: 'user',
  personId: null,
};

/** What the API would say a signed-in account may do with a person (a Member: themselves only, here). */
export function permissionsFor(me: AuthUser, id: string): PersonPermissions {
  if (me.role === 'superadmin' || me.role === 'familyadmin') return { edit: true, delete: true, addChild: true };
  if (me.role === 'member' && me.personId === id) return { edit: true, delete: false, addChild: true };
  return { edit: false, delete: false, addChild: false };
}

export function detailFor(me: AuthUser, id: string): PersonDetail {
  const found = PEOPLE.find((p) => p.id === id);
  if (!found) throw new Error(`no such person ${id}`);
  return {
    person: found,
    parentage: parentageOf(id),
    unions: UNIONS.filter((u) => u.partnerIds.includes(id)).map((u) => ({
      ...u,
      childIds: Object.entries(PARENTAGE)
        .filter(([, row]) => row.unionId === u.id)
        .map(([child]) => child),
    })),
    singleParentChildIds: Object.entries(PARENTAGE)
      .filter(([, row]) => row.parentId === id)
      .map(([child]) => child),
    permissions: permissionsFor(me, id),
    hasAccount: me.personId === id,
  };
}

export function treeFor(focalId: string): TreeResponse {
  return {
    focalId,
    people: PEOPLE.map((p) => ({ ...p, hasParents: PARENTAGE[p.id] !== undefined })),
    unions: UNIONS,
    parentage: Object.fromEntries(Object.keys(PARENTAGE).map((child) => [child, parentageOf(child) as Parentage])),
  };
}

/** Routes for a signed-in account over the Hale family. Add more (or override) with `extra`. */
export function haleRoutes(me: AuthUser, extra: Record<string, MockRoute> = {}): Record<string, MockRoute> {
  const routes: Record<string, MockRoute> = {
    ...signedIn,
    '/api/auth/me': { status: 200, body: { ...ME, user: me } },
    '/api/people': { status: 200, body: { items: PEOPLE, nextCursor: null } },
  };
  for (const { id } of PEOPLE) {
    routes[`GET /api/people/${id}`] = { status: 200, body: detailFor(me, id) };
    routes[`GET /api/tree/${id}?up=1&down=1&collateral=true`] = { status: 200, body: treeFor(id) };
  }
  return { ...routes, ...extra };
}
