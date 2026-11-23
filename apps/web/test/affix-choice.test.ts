// SPDX-License-Identifier: AGPL-3.0-or-later
import { affixChoice, NAME_PREFIXES, NAME_SUFFIXES } from '@kinship/shared';
import { describe, expect, it } from 'vitest';

describe('affixChoice: how a stored prefix or suffix shows in its list (backlog 12)', () => {
  it('reads none, a listed entry (exact match only) and anything else as Other with the text unchanged', () => {
    expect(affixChoice(null, NAME_PREFIXES)).toEqual({ kind: 'none' });
    expect(affixChoice('  ', NAME_PREFIXES)).toEqual({ kind: 'none' });
    expect(affixChoice('Dra.', NAME_PREFIXES)).toEqual({ kind: 'listed', value: 'Dra.' });
    expect(affixChoice('dra.', NAME_PREFIXES)).toEqual({ kind: 'other', text: 'dra.' });
    expect(affixChoice('Sgt.', NAME_PREFIXES)).toEqual({ kind: 'other', text: 'Sgt.' });
    expect(affixChoice('III', NAME_SUFFIXES)).toEqual({ kind: 'listed', value: 'III' });
  });

  it('has the agreed lists: plain "Sr." once in each, and Dra., Lic., Ing. and Sir among the prefixes', () => {
    for (const list of [NAME_PREFIXES, NAME_SUFFIXES]) {
      expect(new Set(list).size).toBe(list.length);
      expect(list.filter((entry) => entry.startsWith('Sr.'))).toEqual(['Sr.']);
      for (const entry of list) expect(entry.length).toBeLessThanOrEqual(30);
    }
    for (const added of ['Dra.', 'Lic.', 'Ing.', 'Sir']) expect(NAME_PREFIXES).toContain(added);
  });
});
