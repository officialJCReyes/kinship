// SPDX-License-Identifier: AGPL-3.0-or-later
// A small fictional family (the Hales) and the API answers for it, for the people screens' tests.
import type {
  AuthUser,
  ChildLink,
  Gender,
  LineageView,
  LinkKind,
  Parentage,
  ParentSets,
  Person,
  PartnerChild,
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
    secondSurname: null,
    marriedSurname: null,
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
  person('samuel', 'Samuel', 'Hale', 'male', '1936'),
  person('joseph', 'Joseph', 'Hale', 'male', '1905'),
  person('anna', 'Anna', 'Hale', 'female', '1908'),
  person('frank', 'Frank', 'Doyle', 'male', '1910'),
  person('ruth', 'Ruth', 'Doyle', 'female', '1912'),
  person('tomas', 'Tomas', 'Nair', 'male', '1990'),
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
    statusAuto: status === 'widowed',
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
  union('u5', 'anna', 'joseph', 'married', '1930'),
  union('u6', 'frank', 'ruth', 'married', '1932'),
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
  tomas: { parentId: 'priya' },
  samuel: { unionId: 'u6' },
};

/** Adoptive sets: Samuel was adopted in 1938 by Joseph and Anna. */
export const ADOPTIVE: Record<string, { unionId?: string; parentId?: string; link?: string }> = {
  samuel: { unionId: 'u5', link: '1938' },
};

function parentageOf(id: string, kind: LinkKind = 'birth'): Parentage | null {
  const row = (kind === 'birth' ? PARENTAGE : ADOPTIVE)[id];
  if (!row) return null;
  const when = (row as { link?: string }).link;
  const link = when ? { value: when, precision: 'exactly' as const } : null;
  return { unionId: row.unionId ?? null, parentId: row.parentId ?? null, kind, link };
}

/** The set a chart follows for a child in this view (the rule of kinship_effective_kind). */
function followedKind(id: string, view: LineageView): LinkKind {
  return view === 'adoptive' && ADOPTIVE[id] ? 'adoptive' : 'birth';
}

export const ADMIN: AuthUser = {
  id: 'u-admin',
  email: 'a@example.com',
  displayName: 'Ada Admin',
  role: 'superadmin',
  personId: null,
  lineageView: 'adoptive',
};
export const MEMBER: AuthUser = {
  id: 'u-member',
  email: 'm@example.com',
  displayName: 'Marcus Hale',
  role: 'member',
  personId: 'marcus',
  lineageView: 'adoptive',
};
export const READER: AuthUser = {
  id: 'u-user',
  email: 'r@example.com',
  displayName: 'Rae Reader',
  role: 'user',
  personId: null,
  lineageView: 'adoptive',
};

/** What the API would say a signed-in account may do with a person (a Member: themselves only, here). */
export function permissionsFor(me: AuthUser, id: string): PersonPermissions {
  if (me.role === 'superadmin' || me.role === 'familyadmin') return { edit: true, delete: true, addChild: true };
  if (me.role === 'member' && me.personId === id) return { edit: true, delete: false, addChild: true };
  return { edit: false, delete: false, addChild: false };
}

const childLink = (child: string, kind: LinkKind): ChildLink => ({
  id: child,
  kind,
  link: parentageOf(child, kind)?.link ?? null,
  adopted: ADOPTIVE[child] !== undefined,
});

/** Every child hanging from this union or this single parent, by either kind of link. */
function childrenOf(match: { unionId?: string; parentId?: string }): ChildLink[] {
  const out: ChildLink[] = [];
  for (const kind of ['birth', 'adoptive'] as const) {
    const table = kind === 'birth' ? PARENTAGE : ADOPTIVE;
    for (const [child, row] of Object.entries(table)) {
      if (match.unionId ? row.unionId === match.unionId : row.parentId === match.parentId)
        out.push(childLink(child, kind));
    }
  }
  return out;
}

/**
 * What GET /api/people/:id answers as `partnerChildren`, by the API's own rule: children of this person's partners who
 * do not hang from this person, each following the set the viewer's lineage view follows (the adoptive set if there
 * is one, in the adoptive view; the birth set in the birth view).
 */
export function partnerChildrenFor(me: AuthUser, id: string): PartnerChild[] {
  const partners = [
    ...new Set(UNIONS.filter((u) => u.partnerIds.includes(id)).map((u) => u.partnerIds.find((p) => p !== id)!)),
  ];
  const person = (pid: string) => PEOPLE.find((p) => p.id === pid)!;
  const out: PartnerChild[] = [];
  for (const partnerId of partners) {
    for (const child of PEOPLE.map((p) => p.id)) {
      if (child === id) continue;
      const kind = followedKind(child, me.lineageView);
      const row = (kind === 'adoptive' ? ADOPTIVE : PARENTAGE)[child];
      if (!row) continue;
      const union = row.unionId ? UNIONS.find((u) => u.id === row.unionId) : undefined;
      const parents = row.parentId ? [row.parentId] : (union?.partnerIds ?? []);
      if (!parents.includes(partnerId) || parents.includes(id)) continue;
      const other = parents.find((p) => p !== partnerId);
      out.push({
        partnerId,
        child: person(child),
        kind,
        adopted: ADOPTIVE[child] !== undefined,
        otherParent: other && union ? person(other) : null,
      });
    }
  }
  return out;
}

export function detailFor(me: AuthUser, id: string): PersonDetail {
  const found = PEOPLE.find((p) => p.id === id);
  if (!found) throw new Error(`no such person ${id}`);
  const parents: ParentSets = { birth: parentageOf(id, 'birth'), adoptive: parentageOf(id, 'adoptive') };
  return {
    person: found,
    parents,
    unions: UNIONS.filter((u) => u.partnerIds.includes(id)).map((u) => ({
      ...u,
      children: childrenOf({ unionId: u.id }),
    })),
    singleParentChildren: childrenOf({ parentId: id }),
    permissions: permissionsFor(me, id),
    hasAccount: me.personId === id,
    labels: [],
    partnerChildren: partnerChildrenFor(me, id),
  };
}

const parentsOfPerson = (id: string, view: LineageView): string[] => {
  const row = (followedKind(id, view) === 'adoptive' ? ADOPTIVE : PARENTAGE)[id];
  if (!row) return [];
  if (row.parentId) return [row.parentId];
  return [...(UNIONS.find((u) => u.id === row.unionId)?.partnerIds ?? [])];
};
const childrenOfPerson = (id: string, view: LineageView): string[] =>
  PEOPLE.map((p) => p.id).filter((child) => parentsOfPerson(child, view).includes(id));

/**
 * What GET /api/tree/:id answers, by the API's own rules: `up` generations of ancestors, `down` of descendants,
 * with collateral the other descendants of the topmost ancestors, everyone's partners, only relationships with both
 * partners drawn, each child following ONE set of parents (the adoptive set if there is one, in the adoptive view;
 * the birth set only in the birth view), parent links only when their parents are drawn, a count of known ancestors
 * for a person whose parents are not drawn (a leaf), and `otherFamily` for a person who has a set the view does not
 * follow.
 */
export function treeFor(
  focalId: string,
  {
    up = 3,
    down = 2,
    collateral = false,
    lineage = 'adoptive',
  }: { up?: number; down?: number; collateral?: boolean; lineage?: LineageView } = {},
): TreeResponse {
  const view = lineage;
  const ids = new Set<string>([focalId]);
  const depth = new Map<string, number>([[focalId, 0]]);
  let layer = [focalId];
  for (let d = 1; d <= up; d += 1) {
    layer = layer.flatMap((id) => parentsOfPerson(id, view));
    for (const id of layer) {
      ids.add(id);
      depth.set(id, d);
    }
  }
  const walkDown = (from: string[], levels: number) => {
    let current = from;
    for (let d = 0; d < levels; d += 1) {
      current = current.flatMap((id) => childrenOfPerson(id, view));
      for (const id of current) ids.add(id);
    }
  };
  walkDown([focalId], down);
  if (collateral) {
    for (const [id, d] of depth) {
      if (d === up || parentsOfPerson(id, view).length === 0) walkDown([id], d + down);
    }
  }
  const core = [...ids];
  for (const u of UNIONS) {
    for (const p of u.partnerIds) if (core.includes(p)) u.partnerIds.forEach((q) => ids.add(q));
  }
  // One more hop: the children of an in-law (drawn only as a partner) that hang from them alone, or from a
  // relationship with somebody who is not a core person (the same rule as the API).
  const inLaws = [...ids].filter((id) => !core.includes(id));
  for (const child of PEOPLE.map((p) => p.id)) {
    const row = (followedKind(child, view) === 'adoptive' ? ADOPTIVE : PARENTAGE)[child];
    if (!row) continue;
    if (row.parentId && inLaws.includes(row.parentId)) ids.add(child);
    const union = row.unionId ? UNIONS.find((u) => u.id === row.unionId) : undefined;
    if (union && union.partnerIds.some((p) => inLaws.includes(p)) && !union.partnerIds.some((p) => core.includes(p))) {
      ids.add(child);
    }
  }
  const unions = UNIONS.filter((u) => u.partnerIds.every((p) => ids.has(p)));
  const unionIds = new Set(unions.map((u) => u.id));
  const parentage: Record<string, Parentage> = {};
  for (const child of PEOPLE.map((p) => p.id)) {
    if (!ids.has(child)) continue;
    const kind = followedKind(child, view);
    const row = (kind === 'adoptive' ? ADOPTIVE : PARENTAGE)[child];
    if (!row) continue;
    if (row.unionId ? unionIds.has(row.unionId) : ids.has(row.parentId!)) parentage[child] = parentageOf(child, kind)!;
  }
  const ancestorsOf = (starts: string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(...parentsOfPerson(next, view));
      }
    }
    return seen;
  };
  const people = PEOPLE.filter((p) => ids.has(p.id)).map((p) => {
    const hasParents = parentsOfPerson(p.id, view).length > 0;
    const followed = followedKind(p.id, view);
    const otherKind: LinkKind = followed === 'adoptive' ? 'birth' : 'adoptive';
    const otherRow = (otherKind === 'adoptive' ? ADOPTIVE : PARENTAGE)[p.id];
    const otherParents = otherRow
      ? otherRow.parentId
        ? [otherRow.parentId]
        : [...(UNIONS.find((u) => u.id === otherRow.unionId)?.partnerIds ?? [])]
      : [];
    return {
      ...p,
      hasParents,
      ...(hasParents && parentage[p.id] === undefined
        ? { ancestorCount: ancestorsOf(parentsOfPerson(p.id, view)).size }
        : {}),
      ...(otherRow ? { otherFamily: { kind: otherKind, count: ancestorsOf(otherParents).size } } : {}),
    };
  });
  return { lineage, focalId, people, unions, parentage };
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
        lineage: (url.searchParams.get('lineage') as LineageView | null) ?? me.lineageView,
      }),
    };
  };
  return { ...routes, ...extra };
}
