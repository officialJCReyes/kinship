// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The stored file format, version 1 (ADR 0033). One file holds one image variant, so a file is small (at most a few MB) and is
// sealed and opened in memory; a tag failure therefore never leaves half a file behind.
//
//   "KSFL" | version (1 byte) | key id (8 bytes) | salt (16 random bytes)          <- the 29-byte preamble, in the clear
//   then chunks of 64 KiB (the same framing as backups, see ../crypto/chunks.ts): len (u32) | ciphertext | 16-byte tag
//
// Per-file key = HKDF(master file key, salt). Counter nonce. The preamble and a "final chunk" flag are the AAD of every chunk,
// so chunks cannot be reordered, dropped from the end or moved to another file. The key id lets a reader say "this is not your
// key" without trying every chunk.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CHUNK_SIZE, TAG_LENGTH, openChunk, sealChunk } from '../crypto/chunks.js';
import { KEY_ID_BYTES, fileKey } from './key.js';
import type { FileKeys } from './key.js';

export const FILE_MAGIC = Buffer.from('KSFL', 'ascii');
export const FILE_VERSION = 1;
const SALT_BYTES = 16;
export const FILE_PREAMBLE_LENGTH = FILE_MAGIC.length + 1 + KEY_ID_BYTES + SALT_BYTES;

export type FileCryptoErrorCode =
  | 'not_a_file' // does not start with the magic, or is shorter than the preamble
  | 'unsupported_version'
  | 'wrong_key' // the key id in the header is not this key's
  | 'corrupt' // a tag failed, or a length is impossible, or there are extra bytes
  | 'truncated'; // the last chunk is missing

export class FileCryptoError extends Error {
  override name = 'FileCryptoError';
  constructor(
    readonly code: FileCryptoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function encryptFile(keys: FileKeys, plain: Buffer): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const preamble = Buffer.concat([FILE_MAGIC, Buffer.from([FILE_VERSION]), keys.keyId, salt]);
  const key = fileKey(keys.master, salt);
  const count = Math.max(1, Math.ceil(plain.length / CHUNK_SIZE));
  const parts: Buffer[] = [preamble];
  for (let i = 0; i < count; i++) {
    parts.push(sealChunk(key, i, preamble, plain.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE), i === count - 1));
  }
  return Buffer.concat(parts);
}

/** The key id (8 bytes) a stored file says it was sealed with. Reads only the preamble; trusts nothing until a chunk opens. */
export function readFileKeyId(head: Buffer): Buffer {
  if (head.length < FILE_PREAMBLE_LENGTH || !head.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
    throw new FileCryptoError('not_a_file', 'This is not a KinShip stored file.');
  }
  if (head[FILE_MAGIC.length] !== FILE_VERSION) {
    throw new FileCryptoError('unsupported_version', 'This file was written by a newer KinShip.');
  }
  const at = FILE_MAGIC.length + 1;
  return head.subarray(at, at + KEY_ID_BYTES);
}

/** All of a file's plaintext, or a FileCryptoError. Nothing is returned unless every chunk authenticated. */
export function decryptFile(keys: FileKeys, data: Buffer): Buffer {
  const keyId = readFileKeyId(data);
  if (!timingSafeEqual(keyId, keys.keyId)) {
    throw new FileCryptoError('wrong_key', 'This file was encrypted with a different key.');
  }
  const preamble = data.subarray(0, FILE_PREAMBLE_LENGTH);
  const key = fileKey(keys.master, preamble.subarray(FILE_PREAMBLE_LENGTH - SALT_BYTES));
  const frames: { body: Buffer; tag: Buffer }[] = [];
  let at = FILE_PREAMBLE_LENGTH;
  while (at < data.length) {
    if (data.length - at < 4) throw new FileCryptoError('truncated', 'The file ends in the middle of a block.');
    const length = data.readUInt32BE(at);
    if (length > CHUNK_SIZE) throw new FileCryptoError('corrupt', 'The file has a block of impossible length.');
    const end = at + 4 + length + TAG_LENGTH;
    if (end > data.length) throw new FileCryptoError('truncated', 'The file ends in the middle of a block.');
    frames.push({ body: data.subarray(at + 4, at + 4 + length), tag: data.subarray(at + 4 + length, end) });
    at = end;
  }
  if (frames.length === 0) throw new FileCryptoError('truncated', 'The file has no blocks.');
  const out: Buffer[] = [];
  for (let i = 0; i < frames.length; i++) {
    const { body, tag } = frames[i] as { body: Buffer; tag: Buffer };
    const final = i === frames.length - 1;
    const plain = openChunk(key, i, preamble, body, tag, final);
    if (plain === null) {
      // A last block that only authenticates as "not the last" means blocks were cut off the end.
      if (final && openChunk(key, i, preamble, body, tag, false) !== null) {
        throw new FileCryptoError('truncated', 'The file was cut short: its final block is missing.');
      }
      throw new FileCryptoError('corrupt', 'The file is damaged: a block failed its integrity check.');
    }
    out.push(plain);
  }
  return Buffer.concat(out);
}
