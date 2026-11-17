// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The first-run wizard (release 0.2, ADR 0013): the seven steps, and the optional `family` object that POST /api/setup
// takes so the account, the tree and the closest relatives are created in one transaction. The API and the web app both
// import this file.
import type { Gender, PartialDateInput, UnionStatus } from './people.js';

/** The wizard's steps in order. `skippable` steps may be left out; the others cannot. */
export const SETUP_STEPS = [
  { id: 'account', skippable: false },
  { id: 'tree', skippable: false },
  { id: 'you', skippable: false },
  { id: 'partner', skippable: true },
  { id: 'parents', skippable: true },
  { id: 'children', skippable: true },
  { id: 'review', skippable: false },
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number]['id'];

/** The relationship statuses the wizard offers for a partner, and for two parents who are both entered. */
export const SETUP_UNION_STATUSES = [
  'married',
  'engaged',
  'partner',
  'separated',
  'divorced',
  'widowed',
] as const satisfies readonly UnionStatus[];
export type SetupUnionStatus = (typeof SETUP_UNION_STATUSES)[number];

/** The most children the wizard takes. More are added from the tree afterwards. */
export const SETUP_MAX_CHILDREN = 30;

/** The person who is signing up. Both names are required; the account is linked to this person. */
export interface SetupYou {
  givenName: string;
  surname: string;
  birth?: PartialDateInput | null;
  /** Null or left out means "Not specified". */
  gender?: Gender | null;
}

/** The partner, with the status of the one relationship between you. The relationship's own dates are not collected. */
export interface SetupPartner {
  status: SetupUnionStatus;
  givenName: string;
  surname: string;
  /** Used for Married and Widowed. */
  marriedSurname?: string | null;
  /** Optional; partial and approximate dates are allowed, like yours and your children's. */
  birth?: PartialDateInput | null;
  deceased?: boolean;
  gender?: Gender | null;
}

/** A parent. Their gender follows the label (father male, mother female). There is no death date. */
export interface SetupParent {
  givenName: string;
  surname: string;
  deceased?: boolean;
}

/**
 * One or two parents. With both entered they get one relationship between them (`status`, default Married) and you hang
 * from it; with one, you hang from that parent alone.
 */
export interface SetupParents {
  father?: SetupParent | null;
  mother?: SetupParent | null;
  /** Only meaningful when both parents are entered. */
  status?: SetupUnionStatus;
}

export interface SetupChild {
  givenName: string;
  surname: string;
  birth?: PartialDateInput | null;
  gender?: Gender | null;
  /** `partner`: the child hangs from your relationship with the partner. `none`: from you alone. */
  otherParent: 'partner' | 'none';
}

/** Everything the wizard collects about the family. Every link it creates is a birth link. */
export interface SetupFamily {
  you: SetupYou;
  partner?: SetupPartner | null;
  parents?: SetupParents | null;
  children?: SetupChild[];
}

/** Body of POST /api/setup/check: is this the setup token? (204 if so, 403 invalid_setup_token if not.) */
export interface SetupCheckRequest {
  token: string;
}

/** The error codes only the wizard's checks raise. The people codes (invalid_given_name, invalid_date, ...) are reused. */
export const SETUP_ERROR_CODES = ['widowed_needs_deceased', 'too_many_children', 'other_parent_needs_partner'] as const;
export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[number];

/**
 * A setup error names the field it is about, as a path into the request body: `email`, `settings.theme`, `family.you.birth`,
 * `family.children.1.birth`. The wizard maps the path to a step and a field.
 */
export interface SetupErrorBody {
  error: string;
  field?: string;
}

/** Which wizard step a field path belongs to (null for a path the wizard has no field for). */
export function setupStepOfField(field: string): SetupStepId | null {
  if (field === 'token') return 'account';
  if (field === 'email' || field === 'displayName' || field === 'password') return 'account';
  if (field === 'treeName' || field.startsWith('settings')) return 'tree';
  if (field.startsWith('family.you')) return 'you';
  if (field.startsWith('family.partner')) return 'partner';
  if (field.startsWith('family.parents')) return 'parents';
  if (field.startsWith('family.children')) return 'children';
  return null;
}
