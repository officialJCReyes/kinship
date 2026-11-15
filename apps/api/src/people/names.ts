// SPDX-License-Identifier: AGPL-3.0-or-later
import { NAME_MAX_LENGTH } from '@kinship/shared';
import { badRequest } from '../errors.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** A name: Unicode-normalized (NFC), trimmed, 1 to 100 characters, no control characters. */
export function cleanName(raw: unknown, code: 'invalid_given_name' | 'invalid_surname'): string {
  if (typeof raw !== 'string') throw badRequest(code);
  const name = raw.normalize('NFC').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > NAME_MAX_LENGTH || CONTROL_CHARACTERS.test(name)) {
    throw badRequest(code);
  }
  return name;
}
