// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The relationship finder (ADR 0028): the pure part. `findRelationship` works on an in-memory graph of the facts the
// finder needs (who is whose parent in each family, and who is partnered with whom) and returns the relationship as
// facts plus a name made of translation keys. The API loads the graph and calls this; the web only draws the result.
// Nothing here reads a database, the clock or the viewer's settings except the `view` it is told to follow.
import type { Translate, MessageParams } from './i18n.js';
import type { MessageKey } from './messages/en.js';
import type { Gender, LineageView, LinkKind, Person, UnionStatus } from './people.js';

/** The ancestor walk stops here; two people further apart than this are "too distant to name". */
export const RELATIONSHIP_MAX_GENERATIONS = 30;

// ---------------------------------------------------------------------------
// Names: a key plus parameters, which may themselves be names ("Father" inside "Father’s ex-wife")
// ---------------------------------------------------------------------------

export type RelNameParam = string | number | RelName;
export interface RelName {
  key: MessageKey;
  params?: Record<string, RelNameParam>;
}

function renderRaw(name: RelName, t: Translate): string {
  const params: MessageParams = {};
  for (const [key, value] of Object.entries(name.params ?? {})) {
    params[key] = typeof value === 'object' ? renderRaw(value, t) : value;
  }
  return t(name.key, params);
}

/** The name as text, with a capital letter first. Word keys are lower case so they can sit inside a longer name. */
export function renderRelName(name: RelName, t: Translate): string {
  const text = renderRaw(name, t);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type Side = 'male' | 'female' | 'neutral';
const sideOf = (gender: Gender | null): Side => (gender === 'male' || gender === 'female' ? gender : 'neutral');

export type WordFamily =
  'parent' | 'child' | 'sibling' | 'auntUncle' | 'nibling' | 'grandparent' | 'grandchild' | 'partner';
/** The word for a relative of one kind, by gender: `relWord('parent', 'male')` is "father". Lower case; see renderRelName. */
export const relWord = (family: WordFamily, gender: Gender | null): RelName => word(family, gender);
const word = (family: WordFamily, gender: Gender | null): RelName => ({
  key: `rel.word.${family}.${sideOf(gender)}` as MessageKey,
});

const wrap = (key: MessageKey, inner: RelName, extra: Record<string, RelNameParam> = {}): RelName => ({
  key,
  params: { word: inner, ...extra },
});

/** "great-", "great-great-", "3x great-" in front of a word; none for 0. */
function greats(count: number, inner: RelName): RelName {
  if (count <= 0) return inner;
  if (count === 1) return wrap('rel.great.one', inner);
  if (count === 2) return wrap('rel.great.two', inner);
  return wrap('rel.great.many', inner, { n: count });
}

const ORDINALS: MessageKey[] = [
  'rel.ordinal.1',
  'rel.ordinal.2',
  'rel.ordinal.3',
  'rel.ordinal.4',
  'rel.ordinal.5',
  'rel.ordinal.6',
  'rel.ordinal.7',
  'rel.ordinal.8',
  'rel.ordinal.9',
  'rel.ordinal.10',
];

/** "first", "second", "21st": the cousin number. */
export function ordinalName(n: number): RelName {
  const known = ORDINALS[n - 1];
  if (known) return { key: known };
  const last = n % 10;
  const teen = Math.floor(n / 10) % 10 === 1;
  const key: MessageKey =
    !teen && last === 1
      ? 'rel.ordinal.nSt'
      : !teen && last === 2
        ? 'rel.ordinal.nNd'
        : !teen && last === 3
          ? 'rel.ordinal.nRd'
          : 'rel.ordinal.nTh';
  return { key, params: { n } };
}

const NUMBER_WORDS: Record<number, MessageKey> = {
  3: 'rel.number.3',
  4: 'rel.number.4',
  5: 'rel.number.5',
  6: 'rel.number.6',
  7: 'rel.number.7',
  8: 'rel.number.8',
  9: 'rel.number.9',
  10: 'rel.number.10',
};

/** "once", "twice", "three times": how far removed, as a word on its own. */
export function removedWordName(removed: number): RelName {
  if (removed === 1) return { key: 'rel.removedWord.once' };
  if (removed === 2) return { key: 'rel.removedWord.twice' };
  const numberWord = NUMBER_WORDS[removed];
  return { key: 'rel.removedWord.times', params: { n: numberWord ? { key: numberWord } : removed } };
}

/** "first cousin once removed": a word with how far removed it is. */
export function removedName(removed: number, inner: RelName): RelName {
  if (removed === 1) return wrap('rel.removed.once', inner);
  if (removed === 2) return wrap('rel.removed.twice', inner);
  const numberWord = NUMBER_WORDS[removed];
  return wrap('rel.removed.times', inner, { n: numberWord ? { key: numberWord } : removed });
}

/** The cousin number as a name: "first cousin". */
export function cousinName(degree: number): RelName {
  return { key: 'rel.cousin', params: { ordinal: ordinalName(degree) } };
}

// ---------------------------------------------------------------------------
// Names of a blood relationship, from the generation counts alone
// ---------------------------------------------------------------------------

/**
 * Whether the path crosses an adoption in the closest family words (parent, child, brother or sister): `adoptive` when
 * a link on it is an adoptive link, `birth` when none is but one of the children has an adoptive set the viewer is not
 * following, `none` otherwise. Aunts, cousins and further out use the plain name.
 */
export type AdoptionWords = 'none' | 'adoptive' | 'birth';

export interface BloodFacts {
  /** Generations from the first person up to the closest shared ancestor. 0 when that person is the ancestor. */
  dA: number;
  /** The same for the second person, whose relationship to the first this is. */
  dB: number;
  half: boolean;
  adoption: AdoptionWords;
  /** The second person's gender: the words say what THEY are to the first person. */
  gender: Gender | null;
}

export function bloodName(facts: BloodFacts): RelName {
  const { dA, dB, half, adoption, gender } = facts;
  const halfOf = (inner: RelName): RelName => (half ? wrap('rel.half.hyphen', inner) : inner);
  const withAdoption = (inner: RelName, kind: 'parent' | 'child' | 'sibling'): RelName => {
    if (adoption === 'none') return inner;
    if (adoption === 'birth') return wrap('rel.birth', inner);
    return wrap(kind === 'child' ? 'rel.adopted' : 'rel.adoptive', inner);
  };
  if (dA === 0 && dB === 0) return { key: 'rel.self' };
  if (dA === 0) {
    // The second person is a descendant of the first.
    const n = dB - 1;
    if (n === 0) return withAdoption(word('child', gender), 'child');
    return greats(n - 1, word('grandchild', gender));
  }
  if (dB === 0) {
    // The second person is an ancestor of the first.
    const n = dA - 1;
    if (n === 0) return withAdoption(word('parent', gender), 'parent');
    return greats(n - 1, word('grandparent', gender));
  }
  if (dA === 1 && dB === 1) return withAdoption(halfOf(word('sibling', gender)), 'sibling');
  if (dA === 1) {
    // A niece or nephew: dB 2 is plain, 3 is grand, 4 is great-grand.
    const n = dB - 2;
    const base = word('nibling', gender);
    return halfOf(n === 0 ? base : greats(n - 1, wrap('rel.grand', base)));
  }
  if (dB === 1) {
    // An aunt or uncle: dA 2 is plain, 3 is great, 4 is great-great.
    const n = dA - 2;
    return halfOf(greats(n, word('auntUncle', gender)));
  }
  const degree = Math.min(dA, dB) - 1;
  const removed = Math.abs(dA - dB);
  const cousin = removed === 0 ? cousinName(degree) : removedName(removed, cousinName(degree));
  return half ? wrap('rel.half.space', cousin) : cousin;
}

// ---------------------------------------------------------------------------
// Names of partners
// ---------------------------------------------------------------------------

/** Only a Married or Widowed relationship gives in-law and step names (ADR 0010). */
export function givesStepTitles(status: UnionStatus): boolean {
  return status === 'married' || status === 'widowed';
}

/** The translation key for what to call a partner: "Wife", "Ex-husband", "Late wife" and so on. */
export function unionLabelKey(status: UnionStatus, partnerGender: Gender | null, partnerDeceased: boolean): MessageKey {
  const side = sideOf(partnerGender);
  if (status === 'widowed') return `union.label.widowed.${partnerDeceased ? 'late' : 'survivor'}.${side}` as MessageKey;
  return `union.label.${status}.${side}` as MessageKey;
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export interface RelPersonFacts {
  id: string;
  gender: Gender | null;
  deceased: boolean;
  isPlaceholder: boolean;
}
export interface RelUnionFacts {
  a: string;
  b: string;
  status: UnionStatus;
}
export interface RelGraphInput {
  people: readonly RelPersonFacts[];
  unions: readonly RelUnionFacts[];
  /** Each child's parents in the birth set and in the adoptive set (either may be missing). */
  parents: Readonly<Record<string, { birth?: readonly string[]; adoptive?: readonly string[] }>>;
}

export interface RelGraph {
  has(id: string): boolean;
  person(id: string): RelPersonFacts;
  /** The parents this view follows for one person: the adoptive set if there is one (adoptive view), else the birth set. */
  parentIds(id: string, view: LineageView): readonly string[];
  /** Which kind of link this view follows for one person. */
  kindOf(id: string, view: LineageView): LinkKind;
  hasAdoptiveSet(id: string): boolean;
  childrenOf(id: string, view: LineageView): readonly string[];
  unionsOf(id: string): ReadonlyArray<{ partnerId: string; status: UnionStatus }>;
}

export function createRelGraph(input: RelGraphInput): RelGraph {
  const people = new Map(input.people.map((person) => [person.id, person]));
  const unions = new Map<string, Array<{ partnerId: string; status: UnionStatus }>>();
  for (const union of input.unions) {
    for (const [self, other] of [
      [union.a, union.b],
      [union.b, union.a],
    ] as const) {
      unions.set(self, [...(unions.get(self) ?? []), { partnerId: other, status: union.status }]);
    }
  }
  const children = new Map<LineageView, Map<string, string[]>>();
  const kindOf = (id: string, view: LineageView): LinkKind =>
    view === 'adoptive' && (input.parents[id]?.adoptive?.length ?? 0) > 0 ? 'adoptive' : 'birth';
  const parentIds = (id: string, view: LineageView): readonly string[] => {
    const sets = input.parents[id];
    return (kindOf(id, view) === 'adoptive' ? sets?.adoptive : sets?.birth) ?? [];
  };
  return {
    has: (id) => people.has(id),
    person: (id) => {
      const found = people.get(id);
      if (!found) throw new Error(`Unknown person ${id}`);
      return found;
    },
    parentIds,
    kindOf,
    hasAdoptiveSet: (id) => (input.parents[id]?.adoptive?.length ?? 0) > 0,
    childrenOf: (id, view) => {
      let index = children.get(view);
      if (!index) {
        index = new Map();
        for (const child of Object.keys(input.parents)) {
          for (const parent of parentIds(child, view)) index.set(parent, [...(index.get(parent) ?? []), child]);
        }
        children.set(view, index);
      }
      return index.get(id) ?? [];
    },
    unionsOf: (id) => unions.get(id) ?? [],
  };
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export const RELATIONSHIP_KINDS = ['self', 'blood', 'partner', 'inlaw', 'step', 'former', 'none'] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** The facts of a blood relationship: the closest shared ancestor(s) and each person's line down to them. */
export interface BloodDetail {
  dA: number;
  dB: number;
  half: boolean;
  adoption: AdoptionWords;
  /** The closest shared ancestors (a couple for a full relationship), in id order. */
  ancestors: string[];
  /** From the ancestor's child down to the first person, top first, the person last. Empty when the person is the ancestor. */
  lineA: string[];
  lineB: string[];
}

/** An in-law, step or partner result drawn as people with a labelled link between each pair. */
export interface ChainDetail {
  /** The first and second person, with whoever joins them between. */
  people: string[];
  /** `links[i]` says what `people[i + 1]` is to `people[i]`. */
  links: RelName[];
}

export interface RelationshipFacts {
  kind: RelationshipKind;
  /** What the second person is to the first. Null for "none". */
  name: RelName | null;
  /** True for a simple step title (Stepmother, Stepbrother): the one kind a custom label replaces (ADR 0010). */
  stepTitle: boolean;
  blood: BloodDetail | null;
  chain: ChainDetail | null;
  /** Other ways the same two people are related, closest first (at most 3). */
  also: RelName[];
  /** The ancestor walk hit its limit before finding anyone shared. */
  tooDistant: boolean;
}

const NONE: RelationshipFacts = {
  kind: 'none',
  name: null,
  stepTitle: false,
  blood: null,
  chain: null,
  also: [],
  tooDistant: false,
};

const MAX_ALSO = 3;

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

interface Ancestors {
  levels: string[][];
  depths: Map<string, number[]>;
  /** For a person reached at a depth, the person one step down the walk that reached them. */
  below: Map<string, string>;
  truncated: boolean;
}

interface Context {
  graph: RelGraph;
  view: LineageView;
  cache: Map<string, Ancestors>;
}

function ancestorsOf(ctx: Context, id: string): Ancestors {
  const cached = ctx.cache.get(id);
  if (cached) return cached;
  const levels: string[][] = [[id]];
  const depths = new Map<string, number[]>([[id, [0]]]);
  const below = new Map<string, string>();
  let truncated = false;
  for (let depth = 0; depth < RELATIONSHIP_MAX_GENERATIONS; depth++) {
    const next = new Set<string>();
    for (const node of levels[depth]!) {
      for (const parent of ctx.graph.parentIds(node, ctx.view)) {
        next.add(parent);
        if (!below.has(`${parent}@${depth + 1}`)) below.set(`${parent}@${depth + 1}`, node);
      }
    }
    if (next.size === 0) break;
    const level = [...next].sort();
    levels.push(level);
    for (const node of level) depths.set(node, [...(depths.get(node) ?? []), depth + 1]);
  }
  const top = levels[levels.length - 1]!;
  if (levels.length - 1 === RELATIONSHIP_MAX_GENERATIONS) {
    truncated = top.some((node) => ctx.graph.parentIds(node, ctx.view).length > 0);
  }
  const result = { levels, depths, below, truncated };
  ctx.cache.set(id, result);
  return result;
}

interface BloodGroup {
  dA: number;
  dB: number;
  /** The closest shared ancestors that sit exactly dA and dB generations up. */
  ancestors: string[];
  half: boolean;
  adoption: AdoptionWords;
}

interface Blood extends BloodGroup {
  /** Every distinct relationship through a closest shared ancestor, the best first (the first is this one). */
  all: BloodGroup[];
  lineA: string[];
  lineB: string[];
}

const byCloseness = (x: BloodGroup, y: BloodGroup): number =>
  x.dA + x.dB - (y.dA + y.dB) ||
  Math.max(x.dA, x.dB) - Math.max(y.dA, y.dB) ||
  Number(x.half) - Number(y.half) ||
  x.dA - y.dA ||
  x.dB - y.dB;

/** The way up from a person to an ancestor, as the people below the ancestor, the ancestor's child first. */
function lineTo(anc: Ancestors, ancestor: string, depth: number): string[] {
  const line: string[] = [];
  let current = ancestor;
  for (let d = depth; d > 0; d--) {
    const child = anc.below.get(`${current}@${d}`);
    if (child === undefined) break;
    line.push(child);
    current = child;
  }
  return line;
}

function blood(ctx: Context, x: string, y: string): Blood | null {
  const ax = ancestorsOf(ctx, x);
  const ay = ancestorsOf(ctx, y);
  const common = [...ax.depths.keys()].filter((id) => ay.depths.has(id));
  if (common.length === 0) return null;
  // Everything above a shared ancestor is shared too; the closest ones are those that are nobody's parent in the set.
  const dominated = new Set<string>();
  for (const id of common) for (const parent of ctx.graph.parentIds(id, ctx.view)) dominated.add(parent);
  const closest = common.filter((id) => !dominated.has(id));
  const grouped = new Map<string, { dA: number; dB: number; ids: string[] }>();
  for (const id of closest.sort()) {
    for (const dA of ax.depths.get(id)!) {
      for (const dB of ay.depths.get(id)!) {
        const key = `${dA},${dB}`;
        const group = grouped.get(key) ?? { dA, dB, ids: [] };
        group.ids.push(id);
        grouped.set(key, group);
      }
    }
  }
  const knownOtherParent = (child: string, ancestor: string): boolean =>
    ctx.graph
      .parentIds(child, ctx.view)
      .some((parent) => parent !== ancestor && !ctx.graph.person(parent).isPlaceholder);
  const groups: BloodGroup[] = [...grouped.values()].map(({ dA, dB, ids }) => {
    let half = false;
    if (dA >= 1 && dB >= 1 && ids.length === 1) {
      // Half only when someone below the ancestor has a second, known parent who is not shared (a missing parent is unknown).
      const ancestor = ids[0]!;
      const below = [
        ...ax.levels[dA - 1]!.filter((n) => ctx.graph.parentIds(n, ctx.view).includes(ancestor)),
        ...ay.levels[dB - 1]!.filter((n) => ctx.graph.parentIds(n, ctx.view).includes(ancestor)),
      ];
      half = below.some((n) => knownOtherParent(n, ancestor));
    }
    return { dA, dB, ancestors: ids, half, adoption: adoptionOf(ctx, x, y, dA, dB) };
  });
  groups.sort(byCloseness);
  const best = groups[0]!;
  return {
    ...best,
    all: groups,
    lineA: lineTo(ax, best.ancestors[0]!, best.dA),
    lineB: lineTo(ay, best.ancestors[0]!, best.dB),
  };
}

function adoptionOf(ctx: Context, x: string, y: string, dA: number, dB: number): AdoptionWords {
  const edges: string[] = [];
  if (dA === 1 && dB === 0) edges.push(x);
  else if (dA === 0 && dB === 1) edges.push(y);
  else if (dA === 1 && dB === 1) edges.push(x, y);
  else return 'none';
  if (edges.some((id) => ctx.graph.kindOf(id, ctx.view) === 'adoptive')) return 'adoptive';
  if (edges.some((id) => ctx.graph.hasAdoptiveSet(id))) return 'birth';
  return 'none';
}

const bloodNameFor = (ctx: Context, group: BloodGroup, target: string): RelName =>
  bloodName({
    dA: group.dA,
    dB: group.dB,
    half: group.half,
    adoption: group.adoption,
    gender: ctx.graph.person(target).gender,
  });

// ---------------------------------------------------------------------------
// Marriage hops: in-laws, step relatives and former partners
// ---------------------------------------------------------------------------

/** The people this person is married to (Married or Widowed), not placeholders. */
function currentSpouses(ctx: Context, id: string): string[] {
  const ids = ctx.graph
    .unionsOf(id)
    .filter((union) => givesStepTitles(union.status) && !ctx.graph.person(union.partnerId).isPlaceholder)
    .map((union) => union.partnerId);
  return [...new Set(ids)].sort();
}

function unionName(ctx: Context, partner: string, status: UnionStatus): RelName {
  const p = ctx.graph.person(partner);
  return { key: unionLabelKey(status, p.gender, p.deceased) };
}

/** The union to use between two people: the one that names them best (Married, then Widowed, then the rest). */
const STATUS_ORDER: UnionStatus[] = [
  'married',
  'widowed',
  'separated',
  'engaged',
  'partner',
  'divorced',
  'annulment',
  'friends',
  'unknown',
  'other',
];
function bestUnion(ctx: Context, a: string, b: string): UnionStatus | null {
  const found = ctx.graph.unionsOf(a).filter((union) => union.partnerId === b);
  if (found.length === 0) return null;
  return found.map((union) => union.status).sort((x, y) => STATUS_ORDER.indexOf(x) - STATUS_ORDER.indexOf(y))[0]!;
}

const possessive = (owner: RelName, inner: RelName): RelName => ({
  key: 'rel.possessive',
  params: { owner, word: inner },
});

const stepOf = (inner: RelName, hyphen: boolean): RelName => wrap(hyphen ? 'rel.step.hyphen' : 'rel.step.plain', inner);
const inLawOf = (inner: RelName): RelName => wrap('rel.inlaw', inner);

/** Something a person who is married to a blood relative can be called, by the shape of that blood relationship. */
interface Chained {
  name: RelName;
  kind: 'inlaw' | 'step';
  stepTitle: boolean;
  people: string[];
  links: RelName[];
  /** Smaller is closer; used to choose between several ways to reach the same result. */
  cost: number;
  /** Order of the shapes: the first that fits wins, as in the mockup. */
  shape: number;
}

function realPerson(ctx: Context, id: string): boolean {
  return ctx.graph.has(id) && !ctx.graph.person(id).isPlaceholder;
}

/** B is a blood relative of A's spouse. */
function ofSpouse(ctx: Context, a: string, b: string): Chained[] {
  const out: Chained[] = [];
  for (const spouse of currentSpouses(ctx, a)) {
    if (spouse === b) continue;
    const found = blood(ctx, spouse, b);
    if (!found) continue;
    const status = bestUnion(ctx, a, spouse)!;
    const spouseWord = word('partner', ctx.graph.person(spouse).gender);
    const gender = ctx.graph.person(b).gender;
    let name: RelName;
    let kind: 'inlaw' | 'step' = 'inlaw';
    let stepTitle = false;
    if (found.dA === 1 && found.dB === 1) name = inLawOf(word('sibling', gender));
    else if (found.dA === 1 && found.dB === 0) name = inLawOf(word('parent', gender));
    else if (found.dA === 0 && found.dB === 1) {
      name = stepOf(word('child', gender), false);
      kind = 'step';
      stepTitle = true;
    } else if (found.dA === 0 && found.dB >= 2) {
      // A spouse's grandchild is a step-grandchild, the mirror of Step-grandmother.
      name = stepOf(bloodNameFor(ctx, found, b), true);
      kind = 'step';
      stepTitle = true;
    } else name = possessive(spouseWord, bloodNameFor(ctx, found, b));
    out.push({
      name,
      kind,
      stepTitle,
      people: [a, spouse, b],
      links: [unionName(ctx, spouse, status), bloodNameFor(ctx, found, b)],
      cost: found.dA + found.dB,
      shape: 0,
    });
  }
  return out;
}

/** B is the spouse of one of A's blood relatives. */
function spouseOfRelative(ctx: Context, a: string, b: string): Chained[] {
  const out: Chained[] = [];
  for (const spouse of currentSpouses(ctx, b)) {
    if (spouse === a) continue;
    const found = blood(ctx, a, spouse);
    if (!found) continue;
    const status = bestUnion(ctx, b, spouse)!;
    const gender = ctx.graph.person(b).gender;
    let name: RelName;
    let kind: 'inlaw' | 'step' = 'inlaw';
    let stepTitle = false;
    if (found.dA === 1 && found.dB === 1) name = inLawOf(word('sibling', gender));
    else if (found.dA === 0 && found.dB === 1) name = inLawOf(word('child', gender));
    else if (found.dB === 0 && found.dA >= 1) {
      // The spouse of a parent is a step-parent; of a grandparent, a step-grandparent.
      const n = found.dA - 1;
      name = n === 0 ? stepOf(word('parent', gender), false) : stepOf(greats(n - 1, word('grandparent', gender)), true);
      kind = 'step';
      stepTitle = true;
    } else name = possessive(bloodNameFor(ctx, found, spouse), word('partner', gender));
    out.push({
      name,
      kind,
      stepTitle,
      people: [a, spouse, b],
      links: [bloodNameFor(ctx, found, spouse), unionName(ctx, b, status)],
      cost: found.dA + found.dB,
      shape: 1,
    });
  }
  return out;
}

interface StepSibling {
  sibling: string;
  parent: string;
  spouse: string;
}

/** The children of the current spouses of one's parents who are not one's own blood relatives. */
function stepSiblingsOf(ctx: Context, id: string): StepSibling[] {
  const out: StepSibling[] = [];
  const parents = ctx.graph.parentIds(id, ctx.view);
  for (const parent of parents) {
    for (const spouse of currentSpouses(ctx, parent)) {
      if (parents.includes(spouse)) continue;
      for (const child of ctx.graph.childrenOf(spouse, ctx.view)) {
        if (child === id || !realPerson(ctx, child)) continue;
        if (blood(ctx, id, child)) continue;
        out.push({ sibling: child, parent, spouse });
      }
    }
  }
  return out;
}

const stepSiblingName = (ctx: Context, sibling: string): RelName =>
  stepOf(word('sibling', ctx.graph.person(sibling).gender), false);

/** B is a child of the spouse of one of A's parents. */
function stepSibling(ctx: Context, a: string, b: string): Chained[] {
  return stepSiblingsOf(ctx, a)
    .filter((entry) => entry.sibling === b)
    .map((entry) => {
      const spouseStatus = bestUnion(ctx, entry.parent, entry.spouse)!;
      return {
        name: stepSiblingName(ctx, b),
        kind: 'step',
        stepTitle: true,
        people: [a, entry.parent, entry.spouse, b],
        links: [
          word('parent', ctx.graph.person(entry.parent).gender),
          unionName(ctx, entry.spouse, spouseStatus),
          word('child', ctx.graph.person(b).gender),
        ],
        cost: 2,
        shape: 2,
      } satisfies Chained;
    });
}

/** B is a blood relative of one of A's step-brothers or step-sisters ("Stepbrother’s son"). */
function bloodOfStepSibling(ctx: Context, a: string, b: string): Chained[] {
  const out: Chained[] = [];
  for (const entry of stepSiblingsOf(ctx, a)) {
    if (entry.sibling === b) continue;
    const found = blood(ctx, entry.sibling, b);
    if (!found) continue;
    const first = stepSiblingName(ctx, entry.sibling);
    const second = bloodNameFor(ctx, found, b);
    out.push({
      name: possessive(first, second),
      kind: 'inlaw',
      stepTitle: false,
      people: [a, entry.sibling, b],
      links: [first, second],
      cost: 2 + found.dA + found.dB,
      shape: 3,
    });
  }
  return out;
}

/** B is a step-brother or step-sister of one of A's blood relatives ("Brother’s stepsister"). */
function stepSiblingOfRelative(ctx: Context, a: string, b: string): Chained[] {
  const out: Chained[] = [];
  // B's step-siblings are found from B: a step-relation is the same from either side.
  for (const entry of stepSiblingsOf(ctx, b)) {
    const relative = entry.sibling;
    if (relative === a || !realPerson(ctx, relative)) continue;
    const found = blood(ctx, a, relative);
    if (!found) continue;
    const first = bloodNameFor(ctx, found, relative);
    const second = stepSiblingName(ctx, b);
    out.push({
      name: possessive(first, second),
      kind: 'inlaw',
      stepTitle: false,
      people: [a, relative, b],
      links: [first, second],
      cost: 2 + found.dA + found.dB,
      shape: 4,
    });
  }
  return out;
}

const EX_STATUSES: UnionStatus[] = ['divorced', 'annulment', 'separated'];

/** B was once partnered with a blood relative of A: described plainly, never as an in-law (D5). */
function formerPartner(ctx: Context, a: string, b: string): Chained[] {
  const out: Chained[] = [];
  const gender = ctx.graph.person(b).gender;
  const seen = new Set<string>();
  for (const union of ctx.graph.unionsOf(b)) {
    if (!EX_STATUSES.includes(union.status) || seen.has(union.partnerId)) continue;
    const relative = union.partnerId;
    if (relative === a || !realPerson(ctx, relative)) continue;
    const found = blood(ctx, a, relative);
    if (!found) continue;
    seen.add(relative);
    const owner = bloodNameFor(ctx, found, relative);
    const label: RelName = { key: `rel.ex.${sideOf(gender)}` as MessageKey };
    out.push({
      name: possessive(owner, label),
      kind: 'inlaw',
      stepTitle: false,
      people: [a, relative, b],
      links: [owner, label],
      cost: found.dA + found.dB,
      shape: 5,
    });
  }
  return out;
}

function chosen(candidates: Chained[]): Chained | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((x, y) => x.shape - y.shape || x.cost - y.cost)[0]!;
}

// ---------------------------------------------------------------------------
// The finder
// ---------------------------------------------------------------------------

function findIn(graph: RelGraph, a: string, b: string, view: LineageView): RelationshipFacts {
  if (a === b) return { ...NONE, kind: 'self', name: { key: 'rel.self' } };
  const ctx: Context = { graph, view, cache: new Map() };
  const found = blood(ctx, a, b);
  const union = bestUnion(ctx, a, b);
  if (found) {
    const name = bloodNameFor(ctx, found, b);
    const seen = new Set([JSON.stringify(name)]);
    const also: RelName[] = [];
    for (const group of found.all.slice(1)) {
      const other = bloodNameFor(ctx, group, b);
      const key = JSON.stringify(other);
      if (!seen.has(key)) {
        seen.add(key);
        also.push(other);
      }
    }
    if (union) also.push({ key: unionLabelKey(union, graph.person(b).gender, graph.person(b).deceased) });
    return {
      kind: 'blood',
      name,
      stepTitle: false,
      blood: {
        dA: found.dA,
        dB: found.dB,
        half: found.half,
        adoption: found.adoption,
        ancestors: found.ancestors,
        lineA: found.lineA,
        lineB: found.lineB,
      },
      chain: null,
      also: also.slice(0, MAX_ALSO),
      tooDistant: false,
    };
  }
  if (union) {
    const name = unionName(ctx, b, union);
    return {
      ...NONE,
      kind: 'partner',
      name,
      chain: { people: [a, b], links: [name] },
    };
  }
  const via = chosen([
    ...ofSpouse(ctx, a, b),
    ...spouseOfRelative(ctx, a, b),
    ...stepSibling(ctx, a, b),
    ...bloodOfStepSibling(ctx, a, b),
    ...stepSiblingOfRelative(ctx, a, b),
    ...formerPartner(ctx, a, b),
  ]);
  if (via) {
    return {
      ...NONE,
      kind: via.shape === 5 ? 'former' : via.kind,
      name: via.name,
      stepTitle: via.stepTitle,
      chain: { people: via.people, links: via.links },
    };
  }
  const tooDistant = ancestorsOf(ctx, a).truncated || ancestorsOf(ctx, b).truncated;
  return { ...NONE, tooDistant };
}

/**
 * How the second person is related to the first, following one family for adopted people. Both people must be in the
 * graph. The caller decides what to do with placeholders (they are never a result).
 */
export function findRelationship(graph: RelGraph, a: string, b: string, view: LineageView): RelationshipFacts {
  return findIn(graph, a, b, view);
}

/** The view that is not this one. */
export const otherLineage = (view: LineageView): LineageView => (view === 'adoptive' ? 'birth' : 'adoptive');

/**
 * As `findRelationship`, plus whether a relationship exists only in the other family's view: "No relationship found"
 * with "Related through adoption" (`kinship-adoption.md`).
 */
export function findWithAdoptionHint(
  graph: RelGraph,
  a: string,
  b: string,
  view: LineageView,
): { facts: RelationshipFacts; other: 'adoption' | null } {
  const facts = findIn(graph, a, b, view);
  if (facts.kind !== 'none') return { facts, other: null };
  const elsewhere = findIn(graph, a, b, otherLineage(view));
  return { facts, other: elsewhere.kind === 'none' ? null : 'adoption' };
}

// ---------------------------------------------------------------------------
// The API response
// ---------------------------------------------------------------------------

/** A person as the finder shows them: names, gender and years. Nothing private. */
export type RelPerson = Pick<
  Person,
  | 'id'
  | 'givenName'
  | 'surname'
  | 'secondSurname'
  | 'marriedSurname'
  | 'namePrefix'
  | 'nameSuffix'
  | 'surnameParticle'
  | 'gender'
  | 'birth'
  | 'deceased'
  | 'death'
  | 'isPlaceholder'
>;

/** A custom label between the pair, from the first person's side (ADR 0009). */
export interface RelationshipPairLabel {
  /** `from`: the second person IS the first person's `label`. `to`: the first person is. */
  direction: 'from' | 'to';
  label: string;
  reverseLabel: string | null;
}

export interface RelationshipResponse extends Omit<RelationshipFacts, 'blood' | 'chain'> {
  /** The family the answer follows for adopted people. */
  lineage: LineageView;
  a: string;
  b: string;
  blood: BloodDetail | null;
  chain: ChainDetail | null;
  /** "adoption": no relationship in this view, but one exists in the other family's view. */
  other: 'adoption' | null;
  /** Everyone the answer names. */
  people: Record<string, RelPerson>;
  labels: RelationshipPairLabel[];
}
