// SPDX-License-Identifier: AGPL-3.0-or-later
import { NAME_MAX_LENGTH } from '@kinship/shared';
import { badRequest } from '../errors.js';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** A name: Unicode-normalized (NFC), trimmed, 1 to 100 characters, no control characters. */
type NameCode = 'invalid_given_name' | 'invalid_surname' | 'invalid_second_surname' | 'invalid_married_surname';

export function cleanName(raw: unknown, code: NameCode): string {
  if (typeof raw !== 'string') throw badRequest(code);
  const name = raw.normalize('NFC').trim();
  if (Array.from(name).length < 1 || Array.from(name).length > NAME_MAX_LENGTH || CONTROL_CHARACTERS.test(name)) {
    throw badRequest(code);
  }
  return name;
}

/** An optional name (second or married surname): null, undefined or blank means "none"; anything else is cleaned like a name. */
export function cleanOptionalName(raw: unknown, code: NameCode): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  return cleanName(raw, code);
}
