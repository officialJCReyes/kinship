// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  DEFAULT_COLOR_SCHEME,
  MIN_PARENT_AGE_YEARS,
  MIN_PASSWORD_LENGTH,
  NAME_MAX_LENGTH,
  SETUP_MAX_CHILDREN,
  SETUP_STEPS,
} from '@kinship/shared';
import type {
  ColorScheme,
  Gender,
  MessageKey,
  SetupChild,
  SetupRequest,
  SetupStepId,
  SetupUnionStatus,
} from '@kinship/shared';
import { t } from '../i18n.js';
import { draftToInput, emptyDateDraft } from './dates.js';
import type { DateDraft } from './dates.js';

/**
 * The first-run wizard's state (ADR 0013). It lives in React state only: a refresh restarts the wizard, and nothing here
 * (the token, the password, the names, the dates) is ever written to localStorage or sessionStorage.
 */
export interface WizardState {
  // Step 1, Account.
  token: string;
  displayName: string;
  email: string;
  password: string;
  confirm: string;
  // Step 2, Tree. The name follows the account name ("Hale Family") until it is typed over.
  treeName: string;
  treeNameEdited: boolean;
  colorScheme: ColorScheme;
  // Step 3, You. The names follow the account name until one of them is typed over.
  youGiven: string;
  youSurname: string;
  youEdited: boolean;
  youBirth: DateDraft;
  /** Empty is "Not specified": nothing is preselected and nothing is stored. */
  youGender: '' | Gender;
  // Step 4, Partner. Nothing typed (no names) means no partner.
  partner: PartnerDraft;
  // Step 5, Parents. A parent with no names is not entered.
  father: ParentDraft;
  mother: ParentDraft;
  parentsStatus: SetupUnionStatus;
  // Step 6, Children. A row with no name, birth date or gender is ignored.
  children: ChildDraft[];
  nextChildKey: number;
}

export interface PartnerDraft {
  status: SetupUnionStatus;
  given: string;
  surname: string;
  marriedSurname: string;
  /** Optional. Empty means no date; it never blocks the step. */
  birth: DateDraft;
  deceased: boolean;
  gender: '' | Gender;
}

/** A parent. The father's surname follows yours until it is typed over; the mother's starts empty. */
export interface ParentDraft {
  given: string;
  surname: string;
  surnameEdited: boolean;
  deceased: boolean;
}

export interface ChildDraft {
  /** A stable id for the row (the list can shrink), not the position in the request. */
  key: number;
  given: string;
  surname: string;
  surnameEdited: boolean;
  birth: DateDraft;
  gender: '' | Gender;
  /** null follows the default: the partner when there is one, otherwise "Not on the tree". */
  otherParent: 'partner' | 'none' | null;
}

export const emptyPartner: PartnerDraft = {
  status: 'married',
  given: '',
  surname: '',
  marriedSurname: '',
  birth: emptyDateDraft,
  deceased: false,
  gender: '',
};
export const emptyFather: ParentDraft = { given: '', surname: '', surnameEdited: false, deceased: false };
export const emptyMother: ParentDraft = { given: '', surname: '', surnameEdited: true, deceased: false };

export function newChild(key: number): ChildDraft {
  return { key, given: '', surname: '', surnameEdited: false, birth: emptyDateDraft, gender: '', otherParent: null };
}

export const initialWizardState: WizardState = {
  token: '',
  displayName: '',
  email: '',
  password: '',
  confirm: '',
  treeName: '',
  treeNameEdited: false,
  colorScheme: DEFAULT_COLOR_SCHEME,
  youGiven: '',
  youSurname: '',
  youEdited: false,
  youBirth: emptyDateDraft,
  youGender: '',
  partner: emptyPartner,
  father: emptyFather,
  mother: emptyMother,
  parentsStatus: 'married',
  children: [newChild(1)],
  nextChildKey: 2,
};

/** The request field each piece of state is shown in, so an answer from the server can be put next to the right input. */
export const FIELD_OF: Record<keyof WizardState, string> = {
  token: 'token',
  displayName: 'displayName',
  email: 'email',
  password: 'password',
  confirm: 'confirm',
  treeName: 'treeName',
  treeNameEdited: 'treeName',
  colorScheme: 'settings.colorScheme',
  youGiven: 'family.you.givenName',
  youSurname: 'family.you.surname',
  youEdited: 'family.you.givenName',
  youBirth: 'family.you.birth',
  youGender: 'family.you.gender',
  partner: 'family.partner',
  father: 'family.parents.father',
  mother: 'family.parents.mother',
  parentsStatus: 'family.parents.status',
  children: 'family.children',
  nextChildKey: 'family.children',
};

/**
 * "Marcus Hale" gives Marcus and Hale; "Mary Ann Smith" gives "Mary Ann" and Smith. The last word is the surname, which is
 * a guess the person corrects (Spanish and many other names do not work this way). One word is a given name only.
 */
export function splitName(full: string): { given: string; surname: string } {
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { given: '', surname: '' };
  if (words.length === 1) return { given: words[0] ?? '', surname: '' };
  return { given: words.slice(0, -1).join(' '), surname: words.at(-1) ?? '' };
}

/** The tree name shown and sent: the typed one, or "{surname} Family" from the account name until one is typed. */
export function treeNameOf(state: WizardState): string {
  if (state.treeNameEdited) return state.treeName;
  const { surname } = splitName(state.displayName.trim());
  return surname ? `${surname} Family` : '';
}

/** Your names as shown and sent: the typed ones, or the account name split in two until one is typed over. */
export function youNamesOf(state: WizardState): { given: string; surname: string } {
  if (state.youEdited) return { given: state.youGiven, surname: state.youSurname };
  return splitName(state.displayName.trim());
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A name as the API wants it: 1 to 100 characters once trimmed, no control characters. */
export function isValidName(value: string): boolean {
  const name = value.normalize('NFC').trim();
  const length = Array.from(name).length;
  return length >= 1 && length <= NAME_MAX_LENGTH && !CONTROL.test(name);
}

const blank = (value: string): boolean => value.trim() === '';

/** The partner step has something in it. An untouched step means no partner. */
export function partnerEntered(state: WizardState): boolean {
  const p = state.partner;
  return !blank(p.given) || !blank(p.surname) || !blank(p.marriedSurname);
}

/** A parent has a name typed. A father's surname that only follows yours does not count. */
export function parentEntered(parent: ParentDraft): boolean {
  return !blank(parent.given) || (parent.surnameEdited && !blank(parent.surname));
}

export function fatherSurnameOf(state: WizardState): string {
  return state.father.surnameEdited ? state.father.surname : youNamesOf(state).surname;
}

export function childSurnameOf(state: WizardState, child: ChildDraft): string {
  return child.surnameEdited ? child.surname : youNamesOf(state).surname;
}

/** A row counts when something other than the suggested surname is in it. */
export function childEntered(child: ChildDraft): boolean {
  return (
    !blank(child.given) ||
    !blank(child.birth.text) ||
    child.gender !== '' ||
    (child.surnameEdited && !blank(child.surname))
  );
}

export function enteredChildren(state: WizardState): ChildDraft[] {
  return state.children.filter(childEntered);
}

/** The other parent that will be sent: the partner (by default) when there is one, otherwise nobody. */
export function otherParentOf(state: WizardState, child: ChildDraft): 'partner' | 'none' {
  return partnerEntered(state) ? (child.otherParent ?? 'partner') : 'none';
}

/** A Married relationship with someone deceased is recorded as Widowed by the database (set automatically). */
export function recordedStatus(status: SetupUnionStatus, anyDeceased: boolean): SetupUnionStatus {
  return status === 'married' && anyDeceased ? 'widowed' : status;
}

/** The text of a child's row in the request: where in the request it will be, so errors can name it. */
function childIndexes(state: WizardState): Map<number, number> {
  return new Map(enteredChildren(state).map((child, index) => [child.key, index]));
}

/** The index a child row will have in the request (rows that are not entered are left out). */
export function requestIndexOfChild(state: WizardState, child: ChildDraft): number | undefined {
  return childIndexes(state).get(child.key);
}

/** The problems on one step, by request field. Only this step is checked; the server checks everything again. */
export function validateStep(step: SetupStepId, state: WizardState): Record<string, string> {
  const errors: Record<string, string> = {};
  const checkNames = (path: string, given: string, surname: string) => {
    if (!isValidName(given)) errors[`${path}.givenName`] = t('error.invalid_given_name');
    if (!isValidName(surname)) errors[`${path}.surname`] = t('error.invalid_surname');
  };
  if (step === 'account') {
    if (state.token.trim() === '') errors['token'] = t('setup.tokenRequired');
    if (state.displayName.trim() === '') errors['displayName'] = t('setup.displayNameRequired');
    if (!EMAIL.test(state.email.trim())) errors['email'] = t('setup.invalidEmail');
    if (state.password.length < MIN_PASSWORD_LENGTH) {
      errors['password'] = t('setup.passwordTooShort', { min: MIN_PASSWORD_LENGTH });
    }
    if (state.confirm !== state.password) errors['confirm'] = t('setup.passwordMismatch');
  } else if (step === 'tree') {
    if (treeNameOf(state).trim() === '') errors['treeName'] = t('setup.treeNameRequired');
  } else if (step === 'you') {
    const you = youNamesOf(state);
    checkNames('family.you', you.given, you.surname);
    if (draftToInput(state.youBirth) === undefined) errors['family.you.birth'] = t('error.invalid_date');
  } else if (step === 'partner' && partnerEntered(state)) {
    const p = state.partner;
    checkNames('family.partner', p.given, p.surname);
    const showsMarried = p.status === 'married' || p.status === 'widowed';
    if (showsMarried && !blank(p.marriedSurname) && !isValidName(p.marriedSurname)) {
      errors['family.partner.marriedSurname'] = t('error.invalid_married_surname');
    }
    if (p.status === 'widowed' && !p.deceased)
      errors['family.partner.deceased'] = t('setup.partner.widowedNeedsDeceased');
    if (draftToInput(p.birth) === undefined) errors['family.partner.birth'] = t('error.invalid_date');
  } else if (step === 'parents') {
    const { father, mother } = state;
    if (parentEntered(father)) checkNames('family.parents.father', father.given, fatherSurnameOf(state));
    if (parentEntered(mother)) checkNames('family.parents.mother', mother.given, mother.surname);
    if (
      parentEntered(father) &&
      parentEntered(mother) &&
      state.parentsStatus === 'widowed' &&
      !father.deceased &&
      !mother.deceased
    ) {
      errors['family.parents.status'] = t('setup.parents.widowedNeedsDeceased');
    }
  } else if (step === 'children') {
    for (const child of enteredChildren(state)) {
      const index = requestIndexOfChild(state, child);
      const path = `family.children.${index}`;
      checkNames(path, child.given, childSurnameOf(state, child));
      if (draftToInput(child.birth) === undefined) errors[`${path}.birth`] = t('error.invalid_date');
    }
  }
  return errors;
}

/** What POST /api/setup gets. Built only when the person chooses "Create my tree". */
export function buildSetupRequest(state: WizardState): SetupRequest {
  const you = youNamesOf(state);
  const birth = draftToInput(state.youBirth);
  const hasPartner = partnerEntered(state);
  const p = state.partner;
  const partnerBirth = draftToInput(p.birth);
  const showsMarried = p.status === 'married' || p.status === 'widowed';
  const father = parentEntered(state.father);
  const mother = parentEntered(state.mother);
  const children: SetupChild[] = enteredChildren(state).map((child) => {
    const childBirth = draftToInput(child.birth);
    return {
      givenName: child.given.trim(),
      surname: childSurnameOf(state, child).trim(),
      ...(childBirth ? { birth: childBirth } : {}),
      ...(child.gender ? { gender: child.gender } : {}),
      otherParent: otherParentOf(state, child),
    };
  });
  return {
    token: state.token.trim(),
    displayName: state.displayName.trim(),
    email: state.email.trim(),
    password: state.password,
    treeName: treeNameOf(state).trim(),
    settings: { colorScheme: state.colorScheme },
    family: {
      you: {
        givenName: you.given.trim(),
        surname: you.surname.trim(),
        ...(birth ? { birth } : {}),
        ...(state.youGender ? { gender: state.youGender } : {}),
      },
      ...(hasPartner
        ? {
            partner: {
              status: p.status,
              givenName: p.given.trim(),
              surname: p.surname.trim(),
              ...(showsMarried && !blank(p.marriedSurname) ? { marriedSurname: p.marriedSurname.trim() } : {}),
              ...(partnerBirth ? { birth: partnerBirth } : {}),
              ...(p.deceased ? { deceased: true } : {}),
              ...(p.gender ? { gender: p.gender } : {}),
            },
          }
        : {}),
      ...(father || mother
        ? {
            parents: {
              ...(father
                ? {
                    father: {
                      givenName: state.father.given.trim(),
                      surname: fatherSurnameOf(state).trim(),
                      ...(state.father.deceased ? { deceased: true } : {}),
                    },
                  }
                : {}),
              ...(mother
                ? {
                    mother: {
                      givenName: state.mother.given.trim(),
                      surname: state.mother.surname.trim(),
                      ...(state.mother.deceased ? { deceased: true } : {}),
                    },
                  }
                : {}),
              ...(father && mother ? { status: state.parentsStatus } : {}),
            },
          }
        : {}),
      ...(children.length > 0 ? { children } : {}),
    },
  };
}

/** Skipping a step clears what was typed on it (silently), and nothing else. */
export function clearStep(state: WizardState, step: SetupStepId): WizardState {
  if (step === 'partner') return { ...state, partner: emptyPartner };
  if (step === 'parents') return { ...state, father: emptyFather, mother: emptyMother, parentsStatus: 'married' };
  if (step === 'children')
    return { ...state, children: [newChild(state.nextChildKey)], nextChildKey: state.nextChildKey + 1 };
  return state;
}

// --- Review: who will be on the tree, in words ---

export interface ReviewPerson {
  /** Matches the keys of `duplicateNotes`: you, partner, father, mother, child:<key>. */
  key: string;
  name: string;
  /** "you", "your wife", "your father", "your son". */
  relation: string;
  deceased: boolean;
  birth: string | null;
  /** The other parent of a child: "with Priya Nair", or that they are not on the tree. */
  detail: string | null;
}

export interface ReviewRelationship {
  kind: 'partner' | 'parents';
  names: string;
  /** How it will be recorded, for example "Widowed". */
  status: SetupUnionStatus;
  /** True when the database will make it Widowed itself (Married with someone deceased). */
  automatic: boolean;
}

const fullName = (given: string, surname: string) => `${given.trim()} ${surname.trim()}`.trim();
const genderKey = (gender: '' | Gender) => (gender === 'male' || gender === 'female' ? gender : 'neutral');

export function reviewPeople(
  state: WizardState,
  formatBirth: (value: string, precision: string) => string,
): ReviewPerson[] {
  const people: ReviewPerson[] = [];
  const you = youNamesOf(state);
  const yourBirth = draftToInput(state.youBirth);
  people.push({
    key: 'you',
    name: fullName(you.given, you.surname),
    relation: t('setup.relation.you'),
    deceased: false,
    birth: yourBirth ? formatBirth(yourBirth.value, yourBirth.precision ?? 'exactly') : null,
    detail: null,
  });
  const partnerName = partnerEntered(state) ? fullName(state.partner.given, state.partner.surname) : '';
  const partnerBirth = draftToInput(state.partner.birth);
  if (partnerEntered(state)) {
    const recorded = recordedStatus(state.partner.status, state.partner.deceased);
    people.push({
      key: 'partner',
      name: partnerName,
      relation: t(`setup.relation.partner.${recorded}.${genderKey(state.partner.gender)}` as MessageKey),
      deceased: state.partner.deceased,
      birth: partnerBirth ? formatBirth(partnerBirth.value, partnerBirth.precision ?? 'exactly') : null,
      detail: null,
    });
  }
  if (parentEntered(state.father)) {
    people.push({
      key: 'father',
      name: fullName(state.father.given, fatherSurnameOf(state)),
      relation: t('setup.relation.father'),
      deceased: state.father.deceased,
      birth: null,
      detail: null,
    });
  }
  if (parentEntered(state.mother)) {
    people.push({
      key: 'mother',
      name: fullName(state.mother.given, state.mother.surname),
      relation: t('setup.relation.mother'),
      deceased: state.mother.deceased,
      birth: null,
      detail: null,
    });
  }
  for (const child of enteredChildren(state)) {
    const birth = draftToInput(child.birth);
    people.push({
      key: `child:${child.key}`,
      name: fullName(child.given, childSurnameOf(state, child)),
      relation: t(`setup.relation.child.${genderKey(child.gender)}` as MessageKey),
      deceased: false,
      birth: birth ? formatBirth(birth.value, birth.precision ?? 'exactly') : null,
      detail:
        otherParentOf(state, child) === 'partner'
          ? t('setup.review.with', { name: partnerName })
          : t('setup.review.alone'),
    });
  }
  return people;
}

/** The relationships that will be created, with the status each will be recorded as. */
export function reviewRelationships(state: WizardState): ReviewRelationship[] {
  const out: ReviewRelationship[] = [];
  const you = youNamesOf(state);
  if (partnerEntered(state)) {
    const recorded = recordedStatus(state.partner.status, state.partner.deceased);
    out.push({
      kind: 'partner',
      names: `${fullName(you.given, you.surname)} and ${fullName(state.partner.given, state.partner.surname)}`,
      status: recorded,
      automatic: recorded !== state.partner.status,
    });
  }
  if (parentEntered(state.father) && parentEntered(state.mother)) {
    const recorded = recordedStatus(state.parentsStatus, state.father.deceased || state.mother.deceased);
    out.push({
      kind: 'parents',
      names: `${fullName(state.father.given, fatherSurnameOf(state))} and ${fullName(state.mother.given, state.mother.surname)}`,
      status: recorded,
      automatic: recorded !== state.parentsStatus,
    });
  }
  return out;
}

export interface SetupWarning {
  kind: 'tooYoung' | 'bornBefore';
  childKey: number;
  child: string;
  parent: string;
  years: number;
}

/**
 * The soft check from the API (parent_too_young), run here so the wizard can warn without a round trip. Only birth years are
 * compared and only when both are known, which in the wizard means you and each child. A child born before you counts.
 * Never blocks and is never stored.
 */
export function parentAgeWarnings(state: WizardState): SetupWarning[] {
  const yourBirth = draftToInput(state.youBirth);
  if (!yourBirth) return [];
  const you = youNamesOf(state);
  const out: SetupWarning[] = [];
  for (const child of enteredChildren(state)) {
    const birth = draftToInput(child.birth);
    if (!birth) continue;
    const years = Number(birth.value.slice(0, 4)) - Number(yourBirth.value.slice(0, 4));
    if (years < MIN_PARENT_AGE_YEARS) {
      out.push({
        kind: years < 0 ? 'bornBefore' : 'tooYoung',
        childKey: child.key,
        child: fullName(child.given, childSurnameOf(state, child)) || t('setup.review.child'),
        parent: fullName(you.given, you.surname),
        years,
      });
    }
  }
  return out;
}

/**
 * Two people entered with the same given name, surname and birth date (both empty counts): a soft note on the second one,
 * as it may be the same person typed twice. Keys are those of ReviewPerson; the value is the earlier person's name.
 */
export function duplicateNotes(state: WizardState): Map<string, string> {
  const seen = new Map<string, string>();
  const notes = new Map<string, string>();
  const people = reviewPeople(state, (value) => value);
  for (const person of people) {
    const birth =
      person.key === 'you'
        ? state.youBirth.text.trim()
        : person.key === 'partner'
          ? state.partner.birth.text.trim()
          : person.key.startsWith('child:')
            ? (state.children.find((c) => `child:${c.key}` === person.key)?.birth.text.trim() ?? '')
            : '';
    const id = `${person.name.toLowerCase().replace(/\s+/g, ' ')}|${birth}`;
    const earlier = seen.get(id);
    if (earlier) notes.set(person.key, earlier);
    else seen.set(id, person.name);
  }
  return notes;
}

/** Everything that is soft-wrong on the way: texts for Review (and the children step). */
export function warningTexts(state: WizardState): string[] {
  const texts = parentAgeWarnings(state).map((w) =>
    w.kind === 'bornBefore'
      ? t('setup.warn.bornBefore', { child: w.child, parent: w.parent })
      : t('setup.warn.tooYoung', { parent: w.parent, child: w.child, years: w.years }),
  );
  for (const [key, other] of duplicateNotes(state)) {
    const person = reviewPeople(state, (value) => value).find((p) => p.key === key);
    texts.push(`${person?.name ?? ''}: ${t('setup.warn.duplicate', { other })}`);
  }
  return texts;
}

export const MAX_CHILDREN = SETUP_MAX_CHILDREN;

/** The 1-based position of a step in the whole list of seven (the progress text counts all seven). */
export function stepNumber(step: SetupStepId): number {
  return SETUP_STEPS.findIndex((s) => s.id === step) + 1;
}
