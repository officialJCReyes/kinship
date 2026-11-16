// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Types, error codes and the route table for people, relationships and the tree.
// The API and the web app both import this file; a contract test in apps/api checks that the
// API registers exactly these routes and only ever answers with these error codes.

/** How to read a date: the event was exactly then, about then, before it or after it. */
export const DATE_PRECISIONS = ['exactly', 'about', 'before', 'after'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** A date as typed: `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, with how to read it. */
export interface PartialDate {
  value: string;
  precision: DatePrecision;
}
/** What a client sends: the precision may be left out and then means "exactly". */
export interface PartialDateInput {
  value: string;
  precision?: DatePrecision;
}

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const UNION_STATUSES = [
  'married',
  'divorced',
  'separated',
  'widowed',
  'engaged',
  'partner',
  'friends',
  'annulment',
  'unknown',
  'other',
] as const;
export type UnionStatus = (typeof UNION_STATUSES)[number];

/** Only these statuses have an end date (divorce, separation or annulment date). */
export const UNION_END_STATUSES = ['divorced', 'separated', 'annulment'] as const satisfies readonly UnionStatus[];

/** A parent-child link is a birth link (the default) or an adoptive link. A child has at most one set of each kind. */
export const LINK_KINDS = ['birth', 'adoptive'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Which family a viewer's charts follow for an adopted person. Each account chooses its own; new accounts start on adoptive. */
export const LINEAGE_VIEWS = ['adoptive', 'birth'] as const;
export type LineageView = (typeof LINEAGE_VIEWS)[number];
export const DEFAULT_LINEAGE_VIEW: LineageView = 'adoptive';

export const NAME_MAX_LENGTH = 100;
export const SEARCH_MAX_LENGTH = 100;
export const PEOPLE_PAGE_DEFAULT = 50;
export const PEOPLE_PAGE_MAX = 100;
export const TREE_MAX_GENERATIONS = 10;
/** A parent should be at least about this many years older than the child; otherwise the API warns (never blocks). */
export const MIN_PARENT_AGE_YEARS = 12;

/** What a client sends to create a person, and (every field optional) to change one. */
export interface PersonInput {
  givenName: string;
  surname: string;
  gender?: Gender | null;
  birth?: PartialDateInput | null;
  deceased?: boolean;
  death?: PartialDateInput | null;
}
export type PersonPatch = Partial<PersonInput>;

export interface Person {
  id: string;
  givenName: string;
  surname: string;
  gender: Gender | null;
  birth: PartialDate | null;
  deceased: boolean;
  death: PartialDate | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Where a child hangs from: a union (two parents) or a single parent. Exactly one of the two is set.
 * `kind` says whether this is the birth set or the adoptive set, and `link` is the optional date of the link
 * (for example the year of the adoption).
 */
export interface Parentage {
  unionId: string | null;
  parentId: string | null;
  kind: LinkKind;
  link: PartialDate | null;
}

/** Both sets of a person's parents. A person with no adoptive set simply has `adoptive: null`. */
export interface ParentSets {
  birth: Parentage | null;
  adoptive: Parentage | null;
}

/** A child, and which kind of link they hang from this parent (or union) by. */
export interface ChildLink {
  id: string;
  kind: LinkKind;
  link: PartialDate | null;
  /** True when the child has an adoptive set (so a birth link to a parent reads "birth son", not just "son"). */
  adopted: boolean;
}

/** A partner relationship ("union"). `partnerIds` is sorted, so the same couple always looks the same. */
export interface Union {
  id: string;
  partnerIds: [string, string];
  status: UnionStatus;
  start: PartialDate | null;
  end: PartialDate | null;
  createdAt: string;
  updatedAt: string;
}

export interface UnionInput {
  partnerIds: [string, string];
  status: UnionStatus;
  start?: PartialDateInput | null;
  end?: PartialDateInput | null;
}
export interface UnionPatch {
  status?: UnionStatus;
  start?: PartialDateInput | null;
  end?: PartialDateInput | null;
}

/** What the signed-in account may do with one person (for showing or hiding buttons; the API checks again). */
export interface PersonPermissions {
  edit: boolean;
  delete: boolean;
  /** Add a child under this person (new child, from this person alone or from a union they are in). */
  addChild: boolean;
}

export interface UnionWithChildren extends Union {
  /** Everyone hanging from this relationship, birth and adoptive. */
  children: ChildLink[];
}

export interface PersonDetail {
  person: Person;
  /** Both sets of parents, whatever the viewer's lineage view (the profile always lists both families). */
  parents: ParentSets;
  /** Every union this person is a partner in, with the children hanging from it. */
  unions: UnionWithChildren[];
  /** Children who hang from this person alone. */
  singleParentChildren: ChildLink[];
  permissions: PersonPermissions;
  /** True when an account is linked to this person. */
  hasAccount: boolean;
}

export interface PeoplePage {
  items: Person[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface TreePerson extends Person {
  /** True when this person has parents on the tree (so a chart can offer to open their family). */
  hasParents: boolean;
  /**
   * The family behind a second leaf: set when this person has a parent set that this response does NOT follow.
   * `kind` is the family it opens ("birth" or "adoptive") and `count` the people in it with their ancestors.
   * In the adoptive view that is the birth set of an adopted person. In the birth view it is their adoptive
   * set, even when no birth set is recorded.
   */
  otherFamily?: { kind: LinkKind; count: number };
  /**
   * How many known blood ancestors this person has, at any depth. Set only for a person who has parents that
   * are not in this response (the people a chart offers a leaf to), so "Show Priya's family (4 people)" can say 4.
   */
  ancestorCount?: number;
}

/** Response of GET /api/tree/:personId. Parentage is keyed by child id. */
export interface TreeResponse {
  /** The family this response follows for adopted people: the viewer's own setting, or the `lineage` override. */
  lineage: LineageView;
  focalId: string;
  people: TreePerson[];
  unions: Union[];
  parentage: Record<string, Parentage>;
}

/** Things worth a second look that never block a save. */
export const WARNING_CODES = ['parent_too_young'] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
export interface ApiWarning {
  code: WarningCode;
  childId: string;
  parentId: string;
  /** Years between the two birth years. */
  yearsDifference: number;
}

/** Response of POST /api/people and PATCH /api/people/:id. */
export interface PersonResponse {
  person: Person;
  warnings: ApiWarning[];
}
/** Response of POST /api/people/:id/children. */
export interface ChildResponse {
  person: Person;
  parentage: Parentage;
  warnings: ApiWarning[];
}
/** Response of POST and DELETE /api/people/:id/parents. `parentage` is null when no parent is left. */
export interface ParentageResponse {
  parentage: Parentage | null;
  warnings: ApiWarning[];
}
/** Response of POST and PATCH /api/unions, and GET /api/unions/:id. */
export interface UnionResponse {
  union: UnionWithChildren;
}

/** Body of PATCH /api/people/:id/parents/:kind: the date of the link (null clears it). */
export interface UpdateParentLinkRequest {
  link: PartialDateInput | null;
}

export interface DeletePreview {
  /** Unions that would be deleted with the person. */
  unions: number;
  /** Children who would keep one parent instead of two, or lose their only parent. */
  children: number;
}

export interface AddParentRequest {
  parentId: string;
  /** Birth by default. Adoptive is for admins only. */
  kind?: LinkKind;
  /** The date of the link (for an adoption, its year or decree date). Optional. */
  link?: PartialDateInput | null;
  /** Needed only when the child would have two parents who have more than one union together. */
  unionId?: string;
}
export interface AddChildRequest {
  child: PersonInput;
  /** Birth by default. A Member can only add birth links. */
  kind?: LinkKind;
  /** The date of the link, optional. */
  link?: PartialDateInput | null;
  /** A union that includes the person the child is added under. Omit to hang the child from that person alone. */
  unionId?: string;
}

/** Error codes for people, relationships and the tree. Every one has an `error.<code>` message. */
export const PEOPLE_ERROR_CODES = [
  'forbidden',
  'person_not_found',
  'union_not_found',
  'invalid_given_name',
  'invalid_surname',
  'invalid_gender',
  'invalid_date',
  'invalid_precision',
  'invalid_union_status',
  'invalid_cursor',
  'partners_identical',
  'duplicate_relationship',
  'end_date_not_allowed',
  'union_has_children',
  'parent_is_self',
  'child_is_partner',
  'too_many_parents',
  'parent_already_linked',
  'would_create_cycle',
  'union_ambiguous',
  'union_parent_mismatch',
  'parent_not_found',
  'person_has_account',
  'confirm_required',
  'same_person_both_kinds',
  'invalid_link_kind',
  'invalid_lineage',
] as const;
export type PeopleErrorCode = (typeof PEOPLE_ERROR_CODES)[number];

/** Permission rules, in words, for the route table below. */
export type RouteAccess =
  | 'signed-in' // any signed-in account
  | 'admin' // SuperAdmin and Family Admin
  | 'admin-or-own-person' // admins, and a Member for their own person (and people they added in their line)
  | 'admin-or-own-line' // admins, and a Member under themselves or their descendants
  | 'admin-or-own-union'; // admins, and a Member for a union they are a partner in

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  access: RouteAccess;
}

/** Every people, relationship and tree route. The API registers exactly these (checked by a test). */
export const PEOPLE_ROUTES = [
  { method: 'GET', path: '/api/people', access: 'signed-in' },
  { method: 'POST', path: '/api/people', access: 'admin' },
  { method: 'GET', path: '/api/people/:id', access: 'signed-in' },
  { method: 'PATCH', path: '/api/people/:id', access: 'admin-or-own-person' },
  { method: 'DELETE', path: '/api/people/:id', access: 'admin' },
  { method: 'POST', path: '/api/people/:id/children', access: 'admin-or-own-line' },
  { method: 'POST', path: '/api/people/:id/parents', access: 'admin' },
  { method: 'DELETE', path: '/api/people/:id/parents/:parentId', access: 'admin' },
  { method: 'PATCH', path: '/api/people/:id/parents/:kind', access: 'admin' },
  { method: 'POST', path: '/api/unions', access: 'admin' },
  { method: 'GET', path: '/api/unions/:id', access: 'signed-in' },
  { method: 'PATCH', path: '/api/unions/:id', access: 'admin-or-own-union' },
  { method: 'DELETE', path: '/api/unions/:id', access: 'admin' },
  { method: 'GET', path: '/api/tree/:personId', access: 'signed-in' },
] as const satisfies readonly RouteSpec[];
