// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  buildSetupRequest,
  initialWizardState,
  isValidName,
  splitName,
  stepNumber,
  treeNameOf,
  validateStep,
  youNamesOf,
} from '../src/lib/setup-wizard.js';
import type { WizardState } from '../src/lib/setup-wizard.js';

const filled: WizardState = {
  ...initialWizardState,
  token: ' tok ',
  displayName: ' Marcus Hale ',
  email: ' marcus@example.com ',
  password: 'correct horse battery staple',
  confirm: 'correct horse battery staple',
};

describe('splitName', () => {
  it('takes the last word as the surname', () => {
    expect(splitName('Marcus Hale')).toEqual({ given: 'Marcus', surname: 'Hale' });
    expect(splitName('  Mary   Ann  Smith ')).toEqual({ given: 'Mary Ann', surname: 'Smith' });
  });
  it('leaves one word as a given name and nothing as nothing', () => {
    expect(splitName('Marcus')).toEqual({ given: 'Marcus', surname: '' });
    expect(splitName('   ')).toEqual({ given: '', surname: '' });
  });
});

describe('what follows the account name until it is typed over', () => {
  it('suggests "{surname} Family" and your two names', () => {
    expect(treeNameOf(filled)).toBe('Hale Family');
    expect(youNamesOf(filled)).toEqual({ given: 'Marcus', surname: 'Hale' });
    expect(treeNameOf({ ...filled, displayName: 'Marcus' })).toBe('');
  });
  it('uses what was typed once it is typed, even when it is empty', () => {
    expect(treeNameOf({ ...filled, treeNameEdited: true, treeName: '' })).toBe('');
    expect(youNamesOf({ ...filled, youEdited: true, youGiven: 'Marc', youSurname: '' })).toEqual({
      given: 'Marc',
      surname: '',
    });
  });
});

describe('isValidName', () => {
  it('is the API rule: 1 to 100 characters, trimmed, no control characters', () => {
    expect(isValidName('Marcus')).toBe(true);
    expect(isValidName('  ')).toBe(false);
    expect(isValidName('x'.repeat(100))).toBe(true);
    expect(isValidName('x'.repeat(101))).toBe(false);
    expect(isValidName('Mar\u0007cus')).toBe(false);
    expect(isValidName('Zoë 李')).toBe(true);
  });
});

describe('validateStep checks only its own step, by request field', () => {
  it('account', () => {
    expect(Object.keys(validateStep('account', initialWizardState)).sort()).toEqual([
      'displayName',
      'email',
      'password',
      'token',
    ]);
    expect(validateStep('account', filled)).toEqual({});
    expect(Object.keys(validateStep('account', { ...filled, confirm: 'x' }))).toEqual(['confirm']);
    expect(Object.keys(validateStep('account', { ...filled, email: 'a@b' }))).toEqual(['email']);
  });
  it('tree and you', () => {
    expect(Object.keys(validateStep('tree', initialWizardState))).toEqual(['treeName']);
    expect(validateStep('tree', filled)).toEqual({});
    expect(Object.keys(validateStep('you', initialWizardState)).sort()).toEqual([
      'family.you.givenName',
      'family.you.surname',
    ]);
    expect(
      Object.keys(validateStep('you', { ...filled, youBirth: { text: '1986-13', precision: 'exactly' } })),
    ).toEqual(['family.you.birth']);
    expect(validateStep('you', filled)).toEqual({});
  });
  it('does not look at the other steps', () => {
    expect(validateStep('review', initialWizardState)).toEqual({});
  });
});

describe('buildSetupRequest', () => {
  it('trims, leaves out an empty birth date and gender, and carries the color scheme', () => {
    expect(buildSetupRequest({ ...filled, colorScheme: 'slate' })).toEqual({
      token: 'tok',
      displayName: 'Marcus Hale',
      email: 'marcus@example.com',
      password: 'correct horse battery staple',
      treeName: 'Hale Family',
      settings: { colorScheme: 'slate' },
      family: { you: { givenName: 'Marcus', surname: 'Hale' } },
    });
  });
  it('sends a birth date with its precision, and the gender when one is chosen', () => {
    const request = buildSetupRequest({
      ...filled,
      youBirth: { text: '1986', precision: 'about' },
      youGender: 'other',
    });
    expect(request.family?.you).toEqual({
      givenName: 'Marcus',
      surname: 'Hale',
      birth: { value: '1986', precision: 'about' },
      gender: 'other',
    });
  });
});

describe('stepNumber', () => {
  it('counts all seven steps', () => {
    expect(
      ['account', 'tree', 'you', 'partner', 'parents', 'children', 'review'].map((s) => stepNumber(s as never)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
