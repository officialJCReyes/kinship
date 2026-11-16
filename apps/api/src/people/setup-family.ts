// SPDX-License-Identifier: AGPL-3.0-or-later
import { SETUP_MAX_CHILDREN, SETUP_UNION_STATUSES } from '@kinship/shared';
import type { SetupUnionStatus } from '@kinship/shared';
import { ApiError } from '../errors.js';
import { parseGender, parsePersonInput } from '../routes/people.js';
import { parseDateInput } from './dates.js';
import { cleanName, cleanOptionalName } from './names.js';

/**
 * The first-run wizard's `family`, checked and cleaned (ADR 0013). Everything is validated here, before any write and before
 * the password is hashed, with the same rules as adding a person by hand (cleanName, parseDateInput, parsePersonInput).
 * An error carries `field`, the path into the request body (`family.children.1.birth`), which the wizard maps to a step.
 *
 * The result is what kinship_auth.complete_setup_family reads (migration 0012).
 */

export interface SetupPersonRow {
  given_name: string;
  surname: string;
  married_surname: string | null;
  gender: 'male' | 'female' | 'other' | null;
  birth: { value: string; precision: string } | null;
  deceased: boolean;
}

export interface SetupFamilyRows {
  you: SetupPersonRow;
  partner: (SetupPersonRow & { status: SetupUnionStatus }) | null;
  father: SetupPersonRow | null;
  mother: SetupPersonRow | null;
  parents_status: SetupUnionStatus | null;
  children: Array<SetupPersonRow & { other_parent: 'partner' | 'none' }>;
}

type Obj = Record<string, unknown>;

/** Runs a check; an ApiError it throws names `field`. */
function at<T>(field: string, check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(error.status, error.code, { ...error.extra, field });
    throw error;
  }
}

const invalid = (field: string, code: 'invalid_request' | 'invalid_union_status' = 'invalid_request') =>
  new ApiError(400, code, { field });

/** An object with only the listed keys (a missing key is fine; an unknown one is not). */
function objectAt(raw: unknown, field: string, keys: readonly string[]): Obj {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid(field);
  for (const key of Object.keys(raw)) if (!keys.includes(key)) throw invalid(`${field}.${key}`);
  return raw as Obj;
}

function optionalObject(raw: unknown, field: string, keys: readonly string[]): Obj | null {
  return raw === null || raw === undefined ? null : objectAt(raw, field, keys);
}

function booleanAt(raw: unknown, field: string): boolean {
  if (raw === undefined) return false;
  if (typeof raw !== 'boolean') throw invalid(field);
  return raw;
}

function statusAt(raw: unknown, field: string): SetupUnionStatus {
  if (typeof raw === 'string' && (SETUP_UNION_STATUSES as readonly string[]).includes(raw))
    return raw as SetupUnionStatus;
  throw invalid(field, 'invalid_union_status');
}

/** One person: each field is checked on its own (so the error names it), then the whole by parsePersonInput. */
function personAt(
  obj: Obj,
  path: string,
  options: { gender?: 'male' | 'female' | null; marriedSurname?: boolean; birth?: boolean },
): SetupPersonRow {
  const givenName = at(`${path}.givenName`, () => cleanName(obj['givenName'], 'invalid_given_name'));
  const surname = at(`${path}.surname`, () => cleanName(obj['surname'], 'invalid_surname'));
  const marriedSurname = options.marriedSurname
    ? at(`${path}.marriedSurname`, () => cleanOptionalName(obj['marriedSurname'], 'invalid_married_surname'))
    : null;
  const gender =
    options.gender === undefined ? at(`${path}.gender`, () => parseGender(obj['gender'] ?? null)) : options.gender;
  const birthRaw = options.birth ? (obj['birth'] ?? null) : null;
  at(`${path}.birth`, () => parseDateInput(birthRaw as never));
  const deceased = booleanAt(obj['deceased'], `${path}.deceased`);
  const values = at(path, () =>
    parsePersonInput({
      givenName,
      surname,
      marriedSurname,
      gender,
      birth: birthRaw as never,
      deceased,
    }),
  );
  return {
    given_name: values.given_name,
    surname: values.surname,
    married_surname: values.married_surname,
    gender: values.gender,
    birth: values.birth_date === null ? null : { value: values.birth_date, precision: values.birth_precision },
    deceased: values.deceased,
  };
}

export function parseSetupFamily(raw: unknown): SetupFamilyRows {
  const family = objectAt(raw, 'family', ['you', 'partner', 'parents', 'children']);

  const youObj = objectAt(family['you'], 'family.you', ['givenName', 'surname', 'birth', 'gender']);
  // Nobody can be deceased on the page that creates their own account.
  const you = personAt(youObj, 'family.you', { birth: true });

  let partner: SetupFamilyRows['partner'] = null;
  const partnerObj = optionalObject(family['partner'], 'family.partner', [
    'status',
    'givenName',
    'surname',
    'marriedSurname',
    'deceased',
    'gender',
  ]);
  if (partnerObj) {
    const status = statusAt(partnerObj['status'], 'family.partner.status');
    const row = personAt(partnerObj, 'family.partner', { marriedSurname: true });
    if (status === 'widowed' && !row.deceased) {
      throw new ApiError(400, 'widowed_needs_deceased', { field: 'family.partner.deceased' });
    }
    // A married surname only means something for Married and Widowed.
    partner = {
      ...row,
      married_surname: status === 'married' || status === 'widowed' ? row.married_surname : null,
      status,
    };
  }

  let father: SetupPersonRow | null = null;
  let mother: SetupPersonRow | null = null;
  let parentsStatus: SetupUnionStatus | null = null;
  const parentsObj = optionalObject(family['parents'], 'family.parents', ['father', 'mother', 'status']);
  if (parentsObj) {
    const keys = ['givenName', 'surname', 'deceased'];
    const fatherObj = optionalObject(parentsObj['father'], 'family.parents.father', keys);
    const motherObj = optionalObject(parentsObj['mother'], 'family.parents.mother', keys);
    // A father is male and a mother female, by their label.
    if (fatherObj) father = personAt(fatherObj, 'family.parents.father', { gender: 'male' });
    if (motherObj) mother = personAt(motherObj, 'family.parents.mother', { gender: 'female' });
    if (father && mother) {
      parentsStatus =
        parentsObj['status'] === undefined ? 'married' : statusAt(parentsObj['status'], 'family.parents.status');
      if (parentsStatus === 'widowed' && !father.deceased && !mother.deceased) {
        throw new ApiError(400, 'widowed_needs_deceased', { field: 'family.parents.status' });
      }
    } else if (parentsObj['status'] !== undefined) {
      statusAt(parentsObj['status'], 'family.parents.status');
    }
  }

  const children: SetupFamilyRows['children'] = [];
  const list = family['children'];
  if (list !== undefined && list !== null) {
    if (!Array.isArray(list)) throw invalid('family.children');
    if (list.length > SETUP_MAX_CHILDREN) throw new ApiError(400, 'too_many_children', { field: 'family.children' });
    list.forEach((item: unknown, index) => {
      const path = `family.children.${index}`;
      const obj = objectAt(item, path, ['givenName', 'surname', 'birth', 'gender', 'otherParent']);
      const row = personAt(obj, path, { birth: true });
      const other = obj['otherParent'];
      if (other !== 'partner' && other !== 'none') throw invalid(`${path}.otherParent`);
      if (other === 'partner' && !partner) {
        throw new ApiError(400, 'other_parent_needs_partner', { field: `${path}.otherParent` });
      }
      children.push({ ...row, other_parent: other });
    });
  }

  return { you, partner, father, mother, parents_status: parentsStatus, children };
}
