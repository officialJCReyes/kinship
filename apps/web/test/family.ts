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
  person('femi', 'Femi', 'Okafor', 'male', '1960'),
  person('nora', 'Nora', 'Okafor', 'female', '1962'),
  person('ade', 'Ade', 'Okafor', 'male', '1930', '2001'),
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
  union('u3', 'femi', 'nora', 'married', '1985'),
  union('u4', 'lena', 'sofia', 'engaged', '2024'),
];

/** Where each child hangs from. */
export const PARENTAGE: Record<string, { unionId?: string; parentId?: string }> = {
  daniel: { unionId: 'u0' },
  marcus: { unionId: 'u1' },
  sofia: { unionId: 'u1' },
  carla: { unionId: 'u2' },
  ben: { parentId: 'daniel' },
  lena: { unionId: 'u3' },
  femi: { parentId: 'ade' },
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

const parentsOfPerson = (id: string): string[] => {
  const row = PARENTAGE[id];
  if (!row) return [];
  if (row.parentId) return [row.parentId];
  return [...(UNIONS.find((u) => u.id === row.unionId)?.partnerIds ?? [])];
};
const childrenOfPerson = (id: string): string[] =>
  Object.keys(PARENTAGE).filter((child) => parentsOfPerson(child).includes(id));

/**
 * What GET /api/tree/:id answers, by the API's own rules: `up` generations of ancestors, `down` of descendants,
 * with collateral the other descendants of the topmost ancestors, everyone's partners, only relationships with both
 * partners drawn, parent links only when their parents are drawn, and for a person whose parents are not drawn
 * (a leaf) the number of known ancestors.
 */
export function treeFor(
  focalId: string,
  { up = 3, down = 2, collateral = false }: { up?: number; down?: number; collateral?: boolean } = {},
): TreeResponse {
  const ids = new Set<string>([focalId]);
  const depth = new Map<string, number>([[focalId, 0]]);
  let layer = [focalId];
  for (let d = 1; d <= up; d += 1) {
    layer = layer.flatMap(parentsOfPerson);
    for (const id of layer) {
      ids.add(id);
      depth.set(id, d);
    }
  }
  const walkDown = (from: string[], levels: number) => {
    let current = from;
    for (let d = 0; d < levels; d += 1) {
      current = current.flatMap(childrenOfPerson);
      for (const id of current) ids.add(id);
    }
  };
  walkDown([focalId], down);
  if (collateral) {
    for (const [id, d] of depth) {
      if (d === up || parentsOfPerson(id).length === 0) walkDown([id], d + down);
    }
  }
  const core = [...ids];
  for (const u of UNIONS) {
    for (const p of u.partnerIds) if (core.includes(p)) u.partnerIds.forEach((q) => ids.add(q));
  }
  const unions = UNIONS.filter((u) => u.partnerIds.every((p) => ids.has(p)));
  const unionIds = new Set(unions.map((u) => u.id));
  const parentage: Record<string, Parentage> = {};
  for (const child of Object.keys(PARENTAGE)) {
    if (!ids.has(child)) continue;
    const row = PARENTAGE[child]!;
    if (row.unionId ? unionIds.has(row.unionId) : ids.has(row.parentId!)) parentage[child] = parentageOf(child)!;
  }
  const ancestorsOf = (id: string): Set<string> => {
    const seen = new Set<string>();
    const stack = parentsOfPerson(id);
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(...parentsOfPerson(next));
      }
    }
    return seen;
  };
  const people = PEOPLE.filter((p) => ids.has(p.id)).map((p) => {
    const hasParents = PARENTAGE[p.id] !== undefined;
    return {
      ...p,
      hasParents,
      ...(hasParents && parentage[p.id] === undefined ? { ancestorCount: ancestorsOf(p.id).size } : {}),
    };
  });
  return { focalId, people, unions, parentage };
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
  }
  routes['GET /api/tree/*'] = (_init, path) => {
    const url = new URL(path, 'http://x');
    const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    if (!PEOPLE.some((p) => p.id === id)) return { status: 404, body: { error: 'person_not_found' } };
    return {
      status: 200,
      body: treeFor(id, {
        up: Number(url.searchParams.get('up') ?? 3),
        down: Number(url.searchParams.get('down') ?? 2),
        collateral: url.searchParams.get('collateral') === 'true',
      }),
    };
  };
  return { ...routes, ...extra };
}
