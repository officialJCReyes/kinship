// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MessageKey } from './messages/en.js';

export type MessageParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Builds a translate function over one set of messages. Every UI string is a
 * key; `{name}` placeholders are filled from `params`, and a placeholder with
 * no matching param is left as written so the gap is visible.
 */
export function createTranslator(messages: Readonly<Record<MessageKey, string>>): Translate {
  return (key, params) =>
    messages[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name];
      return value === undefined ? placeholder : String(value);
    });
}
