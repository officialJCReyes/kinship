// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The file encryption key (ADR 0033). The configured value is 32 random bytes as base64 (`openssl rand -base64 32`) or as 64
// hex characters. Nothing is used directly: HKDF derives the file master key from it, and a non-secret key id (so a file
// and the install can tell "same key" without revealing it).
import { hkdfSync } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const KEY_BYTES = 32;
export const KEY_ID_BYTES = 8;

const HEX = /^[0-9a-fA-F]{64}$/;
const BASE64_32 = /^[A-Za-z0-9+/]{43}=$/;

/** The 32 key bytes, or null when the text is not a base64 or hex encoding of exactly 32 bytes. */
export function parseFileKey(text: string): Buffer | null {
  const value = text.trim();
  if (HEX.test(value)) return Buffer.from(value, 'hex');
  if (BASE64_32.test(value)) {
    const bytes = Buffer.from(value, 'base64');
    // Rejects spare bits in the last character: the text must be exactly what base64 of these bytes looks like.
    if (bytes.length === KEY_BYTES && bytes.toString('base64') === value) return bytes;
  }
  return null;
}

export interface FileKeys {
  /** HKDF(configured key, "kinship-file v1"). Per-file keys come from this. */
  master: Buffer;
  /** 8 bytes derived from the key: written in every file's header, shown (as hex) in Admin. Not secret. */
  keyId: Buffer;
}

export function deriveFileKeys(configured: Buffer): FileKeys {
  const expand = (info: string, length: number) =>
    Buffer.from(hkdfSync('sha256', configured, Buffer.alloc(0), Buffer.from(info, 'utf8'), length));
  return { master: expand('kinship-file v1', KEY_BYTES), keyId: expand('kinship-file v1 key id', KEY_ID_BYTES) };
}

/** The per-file key: HKDF(master, salt = the 16 random bytes in the file's header). */
export function fileKey(master: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', master, salt, Buffer.from('kinship-file v1 object', 'utf8'), KEY_BYTES));
}
