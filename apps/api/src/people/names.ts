// SPDX-License-Identifier: AGPL-3.0-or-later
import { LABEL_MAX_LENGTH, NAME_MAX_LENGTH } from '@kinship/shared';
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

/** A custom relationship label: Unicode-normalized, trimmed, 1 to 60 characters, no control characters. */
export function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') throw badRequest('invalid_label');
  const label = raw.normalize('NFC').trim();
  if (Array.from(label).length < 1 || Array.from(label).length > LABEL_MAX_LENGTH || CONTROL_CHARACTERS.test(label)) {
    throw badRequest('invalid_label');
  }
  return label;
}

/** The optional reverse label: null, undefined or blank means none. */
export function cleanOptionalLabel(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  return cleanLabel(raw);
}
