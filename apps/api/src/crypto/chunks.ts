// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The chunk core shared by the backup archive (KSBK) and the stored media files (KSFL): AES-256-GCM over 64 KiB chunks,
// a counter nonce, and the preamble plus a "final chunk" flag as the AAD of every chunk. Each chunk is framed as
//   length n (u32 big endian, 0 to the chunk size) | n bytes of ciphertext | 16-byte GCM tag
// The output of backups must not change by a byte when this file changes (backup-format.test.ts pins it).
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const CHUNK_SIZE = 64 * 1024;
export const TAG_LENGTH = 16;

/** 12 bytes: four zero bytes, then the chunk counter as a 64-bit big-endian number. */
export function nonce(counter: number): Buffer {
  const out = Buffer.alloc(12);
  out.writeBigUInt64BE(BigInt(counter), 4);
  return out;
}

export const aad = (preamble: Buffer, final: boolean): Buffer =>
  Buffer.concat([preamble, Buffer.from([final ? 1 : 0])]);

/** One framed chunk: length, ciphertext, tag. */
export function sealChunk(key: Buffer, counter: number, preamble: Buffer, plain: Buffer, final: boolean): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonce(counter), { authTagLength: TAG_LENGTH });
  cipher.setAAD(aad(preamble, final));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body, cipher.getAuthTag()]);
}

/** The plaintext of one chunk, or null when it does not authenticate (wrong key, changed bytes, wrong position or flag). */
export function openChunk(
  key: Buffer,
  counter: number,
  preamble: Buffer,
  body: Buffer,
  tag: Buffer,
  final: boolean,
): Buffer | null {
  const decipher = createDecipheriv('aes-256-gcm', key, nonce(counter), { authTagLength: TAG_LENGTH });
  decipher.setAAD(aad(preamble, final));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null;
  }
}
