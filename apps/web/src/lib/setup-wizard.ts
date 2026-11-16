// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_COLOR_SCHEME, MIN_PASSWORD_LENGTH, NAME_MAX_LENGTH, SETUP_STEPS } from '@kinship/shared';
import type { ColorScheme, Gender, SetupRequest, SetupStepId } from '@kinship/shared';
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

/** The problems on one step, by request field. Only this step is checked; the server checks everything again. */
export function validateStep(step: SetupStepId, state: WizardState): Record<string, string> {
  const errors: Record<string, string> = {};
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
    if (!isValidName(you.given)) errors['family.you.givenName'] = t('error.invalid_given_name');
    if (!isValidName(you.surname)) errors['family.you.surname'] = t('error.invalid_surname');
    if (draftToInput(state.youBirth) === undefined) errors['family.you.birth'] = t('error.invalid_date');
  }
  return errors;
}

/** What POST /api/setup gets. Built only when the person chooses "Create my tree". */
export function buildSetupRequest(state: WizardState): SetupRequest {
  const you = youNamesOf(state);
  const birth = draftToInput(state.youBirth);
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
    },
  };
}

/** The 1-based position of a step in the whole list of seven (the progress text counts all seven). */
export function stepNumber(step: SetupStepId): number {
  return SETUP_STEPS.findIndex((s) => s.id === step) + 1;
}
