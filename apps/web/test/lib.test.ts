// SPDX-License-Identifier: AGPL-3.0-or-later
import { GENDERS, UNION_STATUSES, en } from '@kinship/shared';
import type { Gender } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api.js';
import { draftToInput, formatDate, isValidDateText } from '../src/lib/dates.js';
import { errorMessage, warningTexts } from '../src/lib/errors.js';
import { relativeLabel, unionLabel, unionLabelKey } from '../src/lib/labels.js';
import { siblingsOf } from '../src/lib/people.js';
import { treeFor } from './family.js';

describe('dates', () => {
  it.each(['1955', '1955-02', '1955-02-28', '2024-02-29', '0001'])('accepts %s', (value) => {
    expect(isValidDateText(value)).toBe(true);
  });
  it.each(['', '55', '1955-13', '1955-00', '1955-02-29', '1955-04-31', '1955-2-3', '0000', 'abcd', '1955-02-28x'])(
    'rejects %s',
    (value) => {
      expect(isValidDateText(value)).toBe(false);
    },
  );

  it('turns a draft into what the API takes: empty is null, nonsense is undefined', () => {
    expect(draftToInput({ text: ' ', precision: 'exactly' })).toBeNull();
    expect(draftToInput({ text: '1955-02', precision: 'about' })).toEqual({ value: '1955-02', precision: 'about' });
    expect(draftToInput({ text: '1955-99', precision: 'exactly' })).toBeUndefined();
  });

  it('formats every precision and length in one place', () => {
    expect(formatDate({ value: '1955', precision: 'exactly' })).toBe('1955');
    expect(formatDate({ value: '1955-03', precision: 'exactly' })).toBe('Mar 1955');
    expect(formatDate({ value: '1955-03-09', precision: 'exactly' })).toBe('Mar 9, 1955');
    expect(formatDate({ value: '1955', precision: 'about' })).toBe('about 1955');
    expect(formatDate({ value: '1955-03', precision: 'before' })).toBe('before Mar 1955');
    expect(formatDate({ value: '1955-03-09', precision: 'after' })).toBe('after Mar 9, 1955');
    expect(formatDate(null)).toBe('');
  });
});

describe('unionLabel', () => {
  const genders: (Gender | null)[] = [...GENDERS, null];

  it('has a message for every status, gender and deceased combination', () => {
    for (const status of UNION_STATUSES) {
      for (const gender of genders) {
        for (const deceased of [false, true]) {
          const key = unionLabelKey(status, gender, deceased);
          expect(key in en, `${status} ${String(gender)} ${deceased}`).toBe(true);
          expect(unionLabel(status, gender, deceased).trim()).not.toBe('');
        }
      }
    }
  });

  it.each([
    ['married', 'female', false, 'Wife'],
    ['married', 'male', false, 'Husband'],
    ['divorced', 'female', false, 'Ex-wife'],
    ['divorced', 'male', false, 'Ex-husband'],
    ['separated', 'female', false, 'Wife (separated)'],
    ['engaged', 'female', false, 'Fiancée'],
    ['engaged', 'male', false, 'Fiancé'],
    ['widowed', 'female', true, 'Late wife'],
    ['widowed', 'male', true, 'Late husband'],
    ['widowed', 'female', false, 'Wife (widow)'],
    ['widowed', 'male', false, 'Husband (widower)'],
    ['annulment', 'female', false, 'Former wife (annulled)'],
    ['partner', 'female', false, 'Partner'],
    ['friends', 'male', false, 'Friend'],
    ['unknown', 'male', false, 'Partner (status unknown)'],
    ['other', 'female', false, 'Partner (other)'],
  ] as const)('%s, %s, deceased %s is "%s"', (status, gender, deceased, expected) => {
    expect(unionLabel(status, gender, deceased)).toBe(expected);
  });

  it('uses neutral words when gender is other or not known', () => {
    for (const gender of ['other', null] as const) {
      expect(unionLabel('married', gender, false)).toBe('Spouse');
      expect(unionLabel('divorced', gender, false)).toBe('Ex-partner');
      expect(unionLabel('widowed', gender, true)).toBe('Late partner');
      expect(unionLabel('partner', gender, false)).toBe('Partner');
    }
  });

  it('names relatives by gender', () => {
    expect(relativeLabel('child', 'female')).toBe('Daughter');
    expect(relativeLabel('halfSibling', 'male')).toBe('Half-brother');
    expect(relativeLabel('parent', null)).toBe('Parent');
  });
});

describe('errorMessage', () => {
  it('maps a 429 to the friendly rate limit message, whatever the body says', () => {
    expect(errorMessage(new ApiError('x', 429, 'rate_limited', { retryAfterSeconds: 12 }))).toBe(
      'Too many requests. Wait about 12 seconds and try again.',
    );
    expect(errorMessage(new ApiError('x', 429))).toContain('Too many requests');
  });
  it('maps API codes to their error.<code> message', () => {
    expect(errorMessage(new ApiError('x', 403, 'forbidden'))).toBe(en['error.forbidden']);
    expect(errorMessage(new ApiError('x', 409, 'union_has_children'))).toBe(en['error.union_has_children']);
  });
  it('says the server cannot be reached for a network failure or a dead proxy, and is generic otherwise', () => {
    expect(errorMessage(new ApiError('x'))).toBe(en['common.cannotReachApi']);
    expect(errorMessage(new ApiError('x', 502))).toBe(en['common.cannotReachApi']);
    expect(errorMessage(new ApiError('x', 400))).toBe(en['common.unexpectedError']);
    expect(errorMessage(new Error('boom'))).toBe(en['common.unexpectedError']);
  });
  it('writes warnings', () => {
    expect(warningTexts([{ code: 'parent_too_young', childId: 'a', parentId: 'b', yearsDifference: 9 }])[0]).toContain(
      '9 years',
    );
  });
});

describe('siblingsOf', () => {
  it('separates full siblings from half-siblings', () => {
    const siblings = siblingsOf(treeFor('marcus', { up: 1, down: 1, collateral: true }), 'marcus');
    expect(siblings.full.map((p) => p.id)).toEqual(['sofia']);
    expect(siblings.half.map((p) => p.id).sort()).toEqual(['ben', 'carla']);
  });
  it('treats two children of the same single parent as full siblings, and nobody as a sibling without parents', () => {
    const tree = treeFor('ben', { up: 1, down: 1, collateral: true });
    tree.parentage['x'] = { unionId: null, parentId: 'daniel', kind: 'birth', link: null };
    tree.people.push({ ...tree.people[0]!, id: 'x', hasParents: true });
    expect(siblingsOf(tree, 'ben').full.map((p) => p.id)).toEqual(['x']);
    expect(siblingsOf(tree, 'walter')).toEqual({ full: [], half: [] });
  });
});
