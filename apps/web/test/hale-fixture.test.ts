// SPDX-License-Identifier: AGPL-3.0-or-later
import { findRelationship, createTranslator, en, renderRelName } from '@kinship/shared';
import { describe, expect, it } from 'vitest';
import { HALE_PEOPLE, haleGraph } from './fixtures/hale.js';

describe('the Hale fixture for the finder’s web tests', () => {
  it('has the 31 people of the sample family and names a cousin', () => {
    expect(HALE_PEOPLE).toHaveLength(31);
    const facts = findRelationship(haleGraph(), 'marcus', 'naomi', 'adoptive');
    expect(facts.name && renderRelName(facts.name, createTranslator(en))).toBe('First cousin');
  });
});
