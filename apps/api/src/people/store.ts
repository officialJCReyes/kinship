// SPDX-License-Identifier: AGPL-3.0-or-later
import { MIN_PARENT_AGE_YEARS } from '@kinship/shared';
import type {
  ApiWarning,
  ChildLink,
  DatePrecision,
  DeletePreview,
  LineageView,
  LinkKind,
  Parentage,
  ParentSets,
  PartialDate,
  Person,
  TreePerson,
  TreeResponse,
  Union,
  UnionWithChildren,
} from '@kinship/shared';
import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { badRequest } from '../errors.js';
import { toPartialDate } from './dates.js';

type Trx = Transaction<Database>;

export const PERSON_COLUMNS = [
  'id',
  'given_name',
  'surname',
  'second_surname',
  'married_surname',
  'gender',
  'birth_date',
  'birth_precision',
  'deceased',
  'death_date',
  'death_precision',
  'created_by',
  'created_at',
  'updated_at',
] as const;
export type PersonRow = Pick<Selectable<Database['people']>, (typeof PERSON_COLUMNS)[number]>;

export const UNION_COLUMNS = [
  'id',
  'partner_a_id',
  'partner_b_id',
  'status',
  'start_date',
  'start_precision',
  'end_date',
  'end_precision',
  'status_auto',
  'created_at',
  'updated_at',
] as const;
export type UnionRow = Pick<Selectable<Database['unions']>, (typeof UNION_COLUMNS)[number]>;

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    givenName: row.given_name,
    surname: row.surname,
    secondSurname: row.second_surname,
    marriedSurname: row.married_surname,
    gender: row.gender,
    birth: toPartialDate(row.birth_date, row.birth_precision),
    deceased: row.deceased,
    death: toPartialDate(row.death_date, row.death_precision),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toUnion(row: UnionRow): Union {
  return {
    id: row.id,
    partnerIds: [row.partner_a_id, row.partner_b_id],
    status: row.status,
    start: toPartialDate(row.start_date, row.start_precision),
    end: toPartialDate(row.end_date, row.end_precision),
    statusAuto: row.status_auto,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function getPerson(trx: Trx, id: string): Promise<PersonRow | undefined> {
  return trx.selectFrom('people').select(PERSON_COLUMNS).where('id', '=', id).executeTakeFirst();
}

export interface PersonValues {
  given_name: string;
  surname: string;
  second_surname: string | null;
  married_surname: string | null;
  gender: 'male' | 'female' | 'other' | null;
  birth_date: string | null;
  birth_precision: PartialDate['precision'];
  deceased: boolean;
  death_date: string | null;
  death_precision: PartialDate['precision'];
}

export async function insertPerson(trx: Trx, createdBy: string, values: PersonValues): Promise<PersonRow> {
  return trx
    .insertInto('people')
    .values({ ...values, created_by: createdBy })
    .returning(PERSON_COLUMNS)
    .executeTakeFirstOrThrow();
}

export async function updatePerson(
  trx: Trx,
  id: string,
  values: Partial<PersonValues>,
): Promise<PersonRow | undefined> {
  return trx.updateTable('people').set(values).where('id', '=', id).returning(PERSON_COLUMNS).executeTakeFirst();
}

export interface PeopleQuery {
  /** Words from the search box. Every word has to match, ignoring case and accents. */
  words: string[];
  limit: number;
  after: { surname: string; secondSurname: string; givenName: string; id: string } | undefined;
}

/** `%`, `_` and `\` mean something to LIKE; a name search treats them as plain characters. */
const likeEscape = (word: string): string => word.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listPeople(trx: Trx, query: PeopleQuery): Promise<{ rows: PersonRow[]; hasMore: boolean }> {
  let q = trx.selectFrom('people').select(PERSON_COLUMNS);
  for (const word of query.words) {
    q = q.where(sql<boolean>`search_names like ${'%' + likeEscape(word) + '%'} escape '\\'`);
  }
  if (query.after) {
    const { surname, secondSurname, givenName, id } = query.after;
    q = q.where(
      sql<boolean>`(surname, coalesce(second_surname, ''), given_name, id) > (${surname}, ${secondSurname}, ${givenName}, ${id}::uuid)`,
    );
  }
  const rows = await q
    .orderBy('surname')
    .orderBy(sql`coalesce(second_surname, '')`)
    .orderBy('given_name')
    .orderBy('id')
    .limit(query.limit + 1)
    .execute();
  return { rows: rows.slice(0, query.limit), hasMore: rows.length > query.limit };
}

/** Lower-cased, accent-free search words, the same way the database builds people.search_name. */
export async function normalizeSearchWords(trx: Trx, q: string): Promise<string[]> {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return [];
  const result = await sql<{ w: string }>`
    select lower(public.kinship_unaccent(w)) as w from unnest(${words}::text[]) as w`.execute(trx);
  return result.rows.map((r) => r.w);
}

export function encodeCursor(row: {
  surname: string;
  second_surname: string | null;
  given_name: string;
  id: string;
}): string {
  return Buffer.from(JSON.stringify([row.surname, row.second_surname ?? '', row.given_name, row.id]), 'utf8').toString(
    'base64url',
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

export function decodeCursor(cursor: string): {
  surname: string;
  secondSurname: string;
  givenName: string;
  id: string;
} {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      typeof parsed[2] === 'string' &&
      typeof parsed[3] === 'string' &&
      isUuid(parsed[3])
    ) {
      return { surname: parsed[0], secondSurname: parsed[1], givenName: parsed[2], id: parsed[3] };
    }
  } catch {
    // fall through
  }
  throw badRequest('invalid_cursor');
}

// ---------------------------------------------------------------------------
// Parents and unions
// ---------------------------------------------------------------------------

export interface ParentageRow {
  child_id: string;
  kind: LinkKind;
  union_id: string | null;
  parent_id: string | null;
  link_date: string | null;
  link_precision: DatePrecision;
}

const PARENTAGE_COLUMNS = ['child_id', 'kind', 'union_id', 'parent_id', 'link_date', 'link_precision'] as const;

export function toParentage(row: Omit<ParentageRow, 'child_id'>): Parentage {
  return {
    unionId: row.union_id,
    parentId: row.parent_id,
    kind: row.kind,
    link: toPartialDate(row.link_date, row.link_precision),
  };
}

/** One set of a child's parents (birth or adoptive), or undefined when that set is not recorded. */
export function getParentageRow(trx: Trx, childId: string, kind: LinkKind): Promise<ParentageRow | undefined> {
  return trx
    .selectFrom('person_parents')
    .select(PARENTAGE_COLUMNS)
    .where('child_id', '=', childId)
    .where('kind', '=', kind)
    .executeTakeFirst();
}

/** Both sets of a child's parents. */
export async function getParentSets(trx: Trx, childId: string): Promise<ParentSets> {
  const rows = await trx
    .selectFrom('person_parents')
    .select(PARENTAGE_COLUMNS)
    .where('child_id', '=', childId)
    .execute();
  const set = (kind: LinkKind) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? toParentage(row) : null;
  };
  return { birth: set('birth'), adoptive: set('adoptive') };
}

/** Which kind a chart follows for a child who has these kinds of links (the rule of kinship_effective_kind). */
export function effectiveKind(kinds: ReadonlySet<LinkKind>, view: LineageView): LinkKind {
  return view === 'adoptive' && kinds.has('adoptive') ? 'adoptive' : 'birth';
}

export function getUnion(trx: Trx, id: string): Promise<UnionRow | undefined> {
  return trx.selectFrom('unions').select(UNION_COLUMNS).where('id', '=', id).executeTakeFirst();
}

/** Unions between two people (any order), oldest first. */
export function unionsBetween(trx: Trx, a: string, b: string): Promise<UnionRow[]> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return trx
    .selectFrom('unions')
    .select(UNION_COLUMNS)
    .where('partner_a_id', '=', lo)
    .where('partner_b_id', '=', hi)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

/** Whether the child of this link also has an adoptive set. */
const ADOPTED =
  sql<boolean>`exists (select 1 from person_parents a where a.child_id = pp.child_id and a.kind = 'adoptive')`.as(
    'adopted',
  );

function toChildLink(row: {
  child_id: string;
  kind: LinkKind;
  link_date: string | null;
  link_precision: DatePrecision;
  adopted: boolean;
}): ChildLink {
  return {
    id: row.child_id,
    kind: row.kind,
    link: toPartialDate(row.link_date, row.link_precision),
    adopted: row.adopted,
  };
}

/** The children hanging from each of these unions (both kinds), youngest last (unknown birth dates last). */
export async function childLinksByUnion(trx: Trx, unionIds: string[]): Promise<Map<string, ChildLink[]>> {
  const map = new Map<string, ChildLink[]>(unionIds.map((id) => [id, []]));
  if (unionIds.length === 0) return map;
  const rows = await trx
    .selectFrom('person_parents as pp')
    .innerJoin('people as c', 'c.id', 'pp.child_id')
    .select(['pp.union_id', 'pp.child_id', 'pp.kind', 'pp.link_date', 'pp.link_precision', ADOPTED])
    .where('pp.union_id', 'in', unionIds)
    .orderBy(sql`c.birth_from nulls last`)
    .orderBy('c.id')
    .execute();
  for (const row of rows) {
    if (row.union_id) map.get(row.union_id)?.push(toChildLink(row));
  }
  return map;
}

/** Children who hang from this person alone, of either kind. */
export async function singleParentChildLinks(trx: Trx, parentId: string): Promise<ChildLink[]> {
  const rows = await trx
    .selectFrom('person_parents as pp')
    .innerJoin('people as c', 'c.id', 'pp.child_id')
    .select(['pp.child_id', 'pp.kind', 'pp.link_date', 'pp.link_precision', ADOPTED])
    .where('pp.parent_id', '=', parentId)
    .orderBy(sql`c.birth_from nulls last`)
    .orderBy('c.id')
    .execute();
  return rows.map(toChildLink);
}

export async function unionsOfPerson(trx: Trx, personId: string): Promise<UnionRow[]> {
  return trx
    .selectFrom('unions')
    .select(UNION_COLUMNS)
    .where((eb) => eb.or([eb('partner_a_id', '=', personId), eb('partner_b_id', '=', personId)]))
    .orderBy(sql`start_from nulls last`)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
}

export async function withChildren(trx: Trx, rows: UnionRow[]): Promise<UnionWithChildren[]> {
  const children = await childLinksByUnion(
    trx,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({ ...toUnion(row), children: children.get(row.id) ?? [] }));
}

export async function countUnionChildren(trx: Trx, unionId: string): Promise<number> {
  const row = await trx
    .selectFrom('person_parents')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('union_id', '=', unionId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** What deleting this person would change, for the confirm prompt. */
export async function deletePreview(trx: Trx, personId: string): Promise<DeletePreview> {
  const result = await sql<{ unions: string; children: string }>`
    select
      (select count(*) from unions where partner_a_id = ${personId} or partner_b_id = ${personId}) as unions,
      (select count(*) from person_parents pp
        where pp.parent_id = ${personId}
           or pp.union_id in (select id from unions where partner_a_id = ${personId} or partner_b_id = ${personId})) as children`.execute(
    trx,
  );
  const row = result.rows[0];
  return { unions: Number(row?.unions ?? 0), children: Number(row?.children ?? 0) };
}

export async function personHasAccount(trx: Trx, personId: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`select public.kinship_person_has_account(${personId}::uuid) as ok`.execute(
    trx,
  );
  return result.rows[0]?.ok === true;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/**
 * Parents who are less than about 12 years older than their child, for every parent link that
 * involves this person (as the child or as a parent). Only birth years are compared, and only when
 * both are known. This is a warning for the person typing, never a rule: it is not stored.
 */
export async function parentAgeWarnings(trx: Trx, personId: string): Promise<ApiWarning[]> {
  const result = await sql<{ child_id: string; parent_id: string; diff: number }>`
    select c.id as child_id, parents.pid as parent_id,
           substr(c.birth_date, 1, 4)::int - substr(p.birth_date, 1, 4)::int as diff
      from person_parents pp
      join people c on c.id = pp.child_id and pp.kind = 'birth'
      cross join lateral (
        select pp.parent_id as pid where pp.parent_id is not null
        union all select u.partner_a_id from unions u where u.id = pp.union_id
        union all select u.partner_b_id from unions u where u.id = pp.union_id
      ) parents
      join people p on p.id = parents.pid
     where (c.id = ${personId} or p.id = ${personId})
       and c.birth_date is not null and p.birth_date is not null
       and substr(c.birth_date, 1, 4)::int - substr(p.birth_date, 1, 4)::int < ${MIN_PARENT_AGE_YEARS}
     order by c.id, parents.pid`.execute(trx);
  return result.rows.map((r) => ({
    code: 'parent_too_young',
    childId: r.child_id,
    parentId: r.parent_id,
    yearsDifference: r.diff,
  }));
}

// ---------------------------------------------------------------------------
// The tree around one person
// ---------------------------------------------------------------------------

export interface TreeQuery {
  focalId: string;
  /** Generations of ancestors above the focal person. */
  up: number;
  /** Generations of descendants below the focal person. */
  down: number;
  /** Also include the other descendants of those ancestors (aunts, uncles, cousins...), as far down as the focal person plus `down`. */
  collateral: boolean;
  /** Which family to follow for adopted people (see kinship_effective_kind in migration 0006). */
  lineage: LineageView;
}

/**
 * The people and links needed to draw a tree around one person, in a handful of queries whatever the size of
 * the family (a recursive walk over the indexed parent links, then lookups by id). The caller has checked that
 * the focal person exists.
 *
 * Every walk follows one set of parents per child: `kinship_effective_kind(child, lineage)`. In the adoptive
 * view that is the adoptive set if the child has one, else the birth set; in the birth view the birth set only.
 */
export async function loadTree(trx: Trx, q: TreeQuery): Promise<TreeResponse> {
  // Postgres cannot estimate how big a recursive walk gets and guesses millions of rows, which makes it
  // compile the query (JIT) for ~140 ms to save microseconds. This transaction only runs this one read.
  await sql`set local jit = off`.execute(trx);
  const view = q.lineage;
  const walk = await sql<{ id: string }>`
    with recursive
    ancestors(id, depth) as (
      select ${q.focalId}::uuid, 0
      union
      select x.pid, a.depth + 1
        from ancestors a, lateral public.kinship_parent_ids_in(a.id, ${view}) as x(pid)
       where a.depth < ${q.up}::int
    ),
    descendants(id, depth) as (
      select ${q.focalId}::uuid, 0
      union
      select c.child_id, d.depth + 1
        from descendants d
        join lateral (
          select pp.child_id from person_parents pp
           where pp.parent_id = d.id and pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
          union all select pp.child_id from unions u join person_parents pp on pp.union_id = u.id
           where u.partner_a_id = d.id and pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
          union all select pp.child_id from unions u join person_parents pp on pp.union_id = u.id
           where u.partner_b_id = d.id and pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
        ) c on true
       where d.depth < ${q.down}::int
    ),
    -- id, and how many more generations may be added below it
    collateral(id, remaining) as (
      -- Only the topmost ancestors seed this walk: everyone below a lower ancestor is also below
      -- one of them, and seeding from all of them would walk the same people again and again.
      select a.id, a.depth + ${q.down}::int from ancestors a
       where ${q.collateral}::boolean
         and (a.depth = ${q.up}::int
              or not exists (select 1 from person_parents pp
                              where pp.child_id = a.id and pp.kind = public.kinship_effective_kind(a.id, ${view})))
      union
      select c.child_id, k.remaining - 1
        from collateral k
        join lateral (
          select pp.child_id from person_parents pp
           where pp.parent_id = k.id and pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
          union all select pp.child_id from unions u join person_parents pp on pp.union_id = u.id
           where u.partner_a_id = k.id and pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
          union all select pp.child_id from unions u join person_parents pp on pp.union_id = u.id
           where u.partner_b_id = k.id and pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
        ) c on true
       where k.remaining > 0
    )
    select id from ancestors union select id from descendants union select id from collateral`.execute(trx);

  const core = walk.rows.map((r) => r.id);
  // Partners of everyone included, so couples are whole.
  const partners = await sql<{ id: string }>`
    select partner_a_id as id from unions where partner_b_id = any(${core}::uuid[])
    union select partner_b_id from unions where partner_a_id = any(${core}::uuid[])`.execute(trx);
  const coreSet = new Set(core);
  const inLaws = [...new Set(partners.rows.map((r) => r.id))].filter((id) => !coreSet.has(id));

  // One more hop: the children of an in-law (someone drawn only because they are a partner) that they had apart
  // from the people already drawn: hanging from them alone, or from a relationship with someone who is not on the
  // chart (those children then hang from the in-law alone) or with another in-law. Children of the in-law's
  // relationship with a person in the walk are left to the walk, so the `down` limit holds. Nothing else of theirs
  // is pulled in: not their other parent, nor their partners or descendants.
  const partnerChildren =
    inLaws.length === 0
      ? { rows: [] as Array<{ id: string }> }
      : await sql<{ id: string }>`
    select pp.child_id as id from person_parents pp
     where pp.kind = public.kinship_effective_kind(pp.child_id, ${view})
       and (pp.parent_id = any(${inLaws}::uuid[])
            or pp.union_id in (
              select u.id from unions u
               where (u.partner_a_id = any(${inLaws}::uuid[]) and not u.partner_b_id = any(${core}::uuid[]))
                  or (u.partner_b_id = any(${inLaws}::uuid[]) and not u.partner_a_id = any(${core}::uuid[]))))`.execute(
          trx,
        );
  const ids = [...new Set([...core, ...inLaws, ...partnerChildren.rows.map((r) => r.id)])];
  const drawn = new Set(ids);

  const people = await trx
    .selectFrom('people')
    .select(PERSON_COLUMNS)
    .where('id', 'in', ids)
    .orderBy('surname')
    .orderBy('given_name')
    .orderBy('id')
    .execute();
  // Only relationships whose partners are BOTH drawn. A partner of a drawn in-law who is not drawn
  // (an earlier marriage of theirs) would otherwise be a line to nobody.
  const unions = await trx
    .selectFrom('unions')
    .select(UNION_COLUMNS)
    .where('partner_a_id', 'in', ids)
    .where('partner_b_id', 'in', ids)
    .orderBy('id')
    .execute();
  const unionIds = new Set(unions.map((u) => u.id));
  const allLinks = await trx
    .selectFrom('person_parents')
    .select(PARENTAGE_COLUMNS)
    .where('child_id', 'in', ids)
    .execute();

  // The set each child follows in this view, and the set they do not follow (if recorded).
  const byChild = new Map<string, ParentageRow[]>();
  for (const row of allLinks) byChild.set(row.child_id, [...(byChild.get(row.child_id) ?? []), row]);
  const links: ParentageRow[] = [];
  const otherSets: Array<{ child: string; kind: LinkKind }> = [];
  for (const [child, rows] of byChild) {
    const kind = effectiveKind(new Set(rows.map((r) => r.kind)), view);
    const followed = rows.find((r) => r.kind === kind);
    if (followed) links.push(followed);
    const other = rows.find((r) => r.kind !== kind);
    if (other) otherSets.push({ child, kind: other.kind });
  }

  // A child whose union is not drawn, because one partner is missing, hangs from the drawn partner alone.
  const hiddenUnionIds = [
    ...new Set(links.flatMap((l) => (l.union_id && !unionIds.has(l.union_id) ? [l.union_id] : []))),
  ];
  const hiddenUnions = new Map<string, [string, string]>();
  if (hiddenUnionIds.length > 0) {
    const rows = await trx
      .selectFrom('unions')
      .select(['id', 'partner_a_id', 'partner_b_id'])
      .where('id', 'in', hiddenUnionIds)
      .execute();
    for (const row of rows) hiddenUnions.set(row.id, [row.partner_a_id, row.partner_b_id]);
  }

  const parentage: Record<string, Parentage> = {};
  for (const link of links) {
    // A link whose parents are not drawn stays out; the child's hasParents tells the chart it exists.
    if (link.union_id) {
      if (unionIds.has(link.union_id)) {
        parentage[link.child_id] = toParentage(link);
      } else {
        const drawnPartner = hiddenUnions.get(link.union_id)?.find((id) => drawn.has(id));
        if (drawnPartner) parentage[link.child_id] = toParentage({ ...link, union_id: null, parent_id: drawnPartner });
      }
    } else if (link.parent_id !== null && drawn.has(link.parent_id)) {
      parentage[link.child_id] = toParentage(link);
    }
  }
  const withParents = new Set(links.map((l) => l.child_id));
  const needLeaf = people.filter((row) => withParents.has(row.id) && parentage[row.id] === undefined).map((r) => r.id);
  const counts = await ancestorCounts(trx, needLeaf, view);
  const others = await otherFamilyCounts(trx, otherSets, view);
  const treePeople: TreePerson[] = people.map((row) => {
    const count = counts.get(row.id);
    const other = others.get(row.id);
    return {
      ...toPerson(row),
      hasParents: withParents.has(row.id),
      ...(count === undefined ? {} : { ancestorCount: count }),
      ...(other === undefined ? {} : { otherFamily: other }),
    };
  });
  return { lineage: view, focalId: q.focalId, people: treePeople, unions: unions.map(toUnion), parentage };
}

/**
 * How many known blood-or-adoptive ancestors (as this view follows them, at any depth, each counted once) each of
 * the given people has. Only asked for the people a chart would give a leaf to. One recursive query for all of them.
 */
async function ancestorCounts(trx: Trx, personIds: string[], view: LineageView): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (personIds.length === 0) return result;
  const rows = await sql<{ origin: string; n: string }>`
    with recursive anc(origin, id) as (
      select o.id, x.pid from unnest(${personIds}::uuid[]) as o(id), lateral public.kinship_parent_ids_in(o.id, ${view}) as x(pid)
      union
      select a.origin, x.pid from anc a, lateral public.kinship_parent_ids_in(a.id, ${view}) as x(pid)
    )
    select origin, count(*) as n from anc group by origin`.execute(trx);
  for (const row of rows.rows) result.set(row.origin, Number(row.n));
  return result;
}

/** For people who have a parent set this view does not follow: which family it is, and how many people are in it. */
async function otherFamilyCounts(
  trx: Trx,
  sets: Array<{ child: string; kind: LinkKind }>,
  view: LineageView,
): Promise<Map<string, { kind: LinkKind; count: number }>> {
  const result = new Map<string, { kind: LinkKind; count: number }>();
  if (sets.length === 0) return result;
  const rows = await sql<{ origin: string; n: string }>`
    with recursive anc(origin, id) as (
      select o.child, x.pid
        from unnest(${sets.map((s) => s.child)}::uuid[], ${sets.map((s) => s.kind)}::text[]) as o(child, kind),
             lateral public.kinship_parent_ids_of_kind(o.child, o.kind) as x(pid)
      union
      select a.origin, x.pid from anc a, lateral public.kinship_parent_ids_in(a.id, ${view}) as x(pid)
    )
    select origin, count(*) as n from anc group by origin`.execute(trx);
  const counts = new Map(rows.rows.map((r) => [r.origin, Number(r.n)]));
  for (const set of sets) result.set(set.child, { kind: set.kind, count: counts.get(set.child) ?? 0 });
  return result;
}
