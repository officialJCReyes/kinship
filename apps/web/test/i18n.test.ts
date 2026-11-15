// SPDX-License-Identifier: AGPL-3.0-or-later
import { createTranslator, en } from '@kinship/shared';
import { describe, expect, it } from 'vitest';

describe('translations', () => {
  it('has a non-empty English string for every key', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('fills {placeholders} from params and leaves unknown ones visible', () => {
    const messages = { ...en, 'about.title': 'Hello {name}, you have {count} and {missing}' };
    const translate = createTranslator(messages);
    expect(translate('about.title', { name: 'Marcus', count: 3 })).toBe('Hello Marcus, you have 3 and {missing}');
  });
});
