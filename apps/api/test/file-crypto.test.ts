// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, TAG_LENGTH } from '../src/crypto/chunks.js';
import { FILE_PREAMBLE_LENGTH, FileCryptoError, decryptFile, encryptFile, readFileKeyId } from '../src/files/crypto.js';
import type { FileCryptoErrorCode } from '../src/files/crypto.js';
import { deriveFileKeys, fileKey, parseFileKey } from '../src/files/key.js';

const keys = deriveFileKeys(randomBytes(32));
const otherKeys = deriveFileKeys(randomBytes(32));
const FRAME = 4 + CHUNK_SIZE + TAG_LENGTH;

function code(fn: () => unknown): FileCryptoErrorCode | 'no error' {
  try {
    fn();
    return 'no error';
  } catch (error) {
    if (error instanceof FileCryptoError) return error.code;
    throw error;
  }
}

describe('file encryption', () => {
  it.each([
    0,
    1,
    100,
    CHUNK_SIZE - 1,
    CHUNK_SIZE,
    CHUNK_SIZE + 1,
    2 * CHUNK_SIZE,
    2 * CHUNK_SIZE + 5,
    5 * CHUNK_SIZE + 17,
  ])('round-trips %i bytes', (size) => {
    const plain = randomBytes(size);
    const sealed = encryptFile(keys, plain);
    expect(decryptFile(keys, sealed).equals(plain)).toBe(true);
    // Overhead: the preamble, then 20 bytes (length and tag) for each chunk, at least one chunk.
    const chunks = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    expect(sealed.length).toBe(FILE_PREAMBLE_LENGTH + size + chunks * 20);
  });

  it('writes a fresh salt for every file, so the same bytes never give the same file', () => {
    const plain = Buffer.from('same');
    const a = encryptFile(keys, plain);
    const b = encryptFile(keys, plain);
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, 5).toString('latin1')).toBe('KSFL\u0001');
    expect(readFileKeyId(a).equals(keys.keyId)).toBe(true);
  });

  it('does not contain the plaintext', () => {
    const plain = Buffer.from('a recognisable sentence about the Hale family '.repeat(10));
    expect(encryptFile(keys, plain).includes(Buffer.from('Hale family'))).toBe(false);
  });

  it('derives a different per-file key for a different salt', () => {
    expect(fileKey(keys.master, Buffer.alloc(16, 1)).equals(fileKey(keys.master, Buffer.alloc(16, 2)))).toBe(false);
  });

  it('refuses another key by its key id', () => {
    expect(code(() => decryptFile(otherKeys, encryptFile(keys, Buffer.from('x'))))).toBe('wrong_key');
  });

  it('refuses a changed byte in every chunk and in the preamble', () => {
    const sealed = encryptFile(keys, randomBytes(2 * CHUNK_SIZE + 10));
    // Preamble: the magic, the version, the salt (the key id is checked on its own, above).
    for (const at of [0, 4, FILE_PREAMBLE_LENGTH - 1]) {
      const copy = Buffer.from(sealed);
      copy[at] = (copy[at] ?? 0) ^ 1;
      expect(['not_a_file', 'unsupported_version', 'corrupt']).toContain(code(() => decryptFile(keys, copy)));
    }
    for (let chunk = 0; chunk < 3; chunk++) {
      const start = FILE_PREAMBLE_LENGTH + chunk * FRAME;
      // The length field aside (checked below), a flipped bit in the ciphertext or in the tag fails.
      for (const at of [start + 4, start + 4 + 3]) {
        const copy = Buffer.from(sealed);
        copy[at] = (copy[at] ?? 0) ^ 1;
        expect(
          code(() => decryptFile(keys, copy)),
          `chunk ${chunk} byte ${at}`,
        ).toBe('corrupt');
      }
    }
    const tagged = Buffer.from(sealed);
    tagged[tagged.length - 1] = (tagged[tagged.length - 1] ?? 0) ^ 1;
    expect(code(() => decryptFile(keys, tagged))).toBe('corrupt');
  });

  it('refuses a file cut short, at a block boundary or inside a block', () => {
    const sealed = encryptFile(keys, randomBytes(3 * CHUNK_SIZE));
    expect(code(() => decryptFile(keys, sealed.subarray(0, FILE_PREAMBLE_LENGTH + FRAME)))).toBe('truncated');
    expect(code(() => decryptFile(keys, sealed.subarray(0, FILE_PREAMBLE_LENGTH + 2 * FRAME)))).toBe('truncated');
    expect(code(() => decryptFile(keys, sealed.subarray(0, sealed.length - 5)))).toBe('truncated');
    expect(code(() => decryptFile(keys, sealed.subarray(0, FILE_PREAMBLE_LENGTH)))).toBe('truncated');
    expect(code(() => decryptFile(keys, sealed.subarray(0, 10)))).toBe('not_a_file');
  });

  it('refuses blocks that are swapped, repeated or appended', () => {
    const sealed = encryptFile(keys, randomBytes(3 * CHUNK_SIZE));
    const frame = (i: number) =>
      sealed.subarray(FILE_PREAMBLE_LENGTH + i * FRAME, FILE_PREAMBLE_LENGTH + (i + 1) * FRAME);
    const head = sealed.subarray(0, FILE_PREAMBLE_LENGTH);
    expect(code(() => decryptFile(keys, Buffer.concat([head, frame(1), frame(0), frame(2)])))).toBe('corrupt');
    expect(code(() => decryptFile(keys, Buffer.concat([head, frame(0), frame(0), frame(1), frame(2)])))).toBe(
      'corrupt',
    );
    expect(code(() => decryptFile(keys, Buffer.concat([sealed, frame(0)])))).toBe('corrupt');
    expect(code(() => decryptFile(keys, Buffer.concat([sealed, Buffer.from([1])])))).toBe('truncated');
  });

  it('refuses a block moved into another file', () => {
    const a = encryptFile(keys, Buffer.from('first'));
    const b = encryptFile(keys, Buffer.from('second'));
    const spliced = Buffer.concat([a.subarray(0, FILE_PREAMBLE_LENGTH), b.subarray(FILE_PREAMBLE_LENGTH)]);
    expect(code(() => decryptFile(keys, spliced))).toBe('corrupt');
  });

  it('refuses an impossible block length, a wrong magic and a newer version', () => {
    const sealed = encryptFile(keys, Buffer.from('x'));
    const long = Buffer.from(sealed);
    long.writeUInt32BE(CHUNK_SIZE + 1, FILE_PREAMBLE_LENGTH);
    expect(code(() => decryptFile(keys, long))).toBe('corrupt');
    const wrong = Buffer.from(sealed);
    wrong[0] = 0x58;
    expect(code(() => decryptFile(keys, wrong))).toBe('not_a_file');
    const newer = Buffer.from(sealed);
    newer[4] = 2;
    expect(code(() => decryptFile(keys, newer))).toBe('unsupported_version');
  });
});

describe('the file key', () => {
  const bytes = randomBytes(32);
  it('accepts base64 of 32 bytes and 64 hex characters', () => {
    expect(parseFileKey(bytes.toString('base64'))?.equals(bytes)).toBe(true);
    expect(parseFileKey(`${bytes.toString('base64')}\n`)?.equals(bytes)).toBe(true);
    expect(parseFileKey(bytes.toString('hex'))?.equals(bytes)).toBe(true);
    expect(parseFileKey(bytes.toString('hex').toUpperCase())?.equals(bytes)).toBe(true);
  });

  it('refuses everything else', () => {
    for (const bad of [
      '',
      'hunter2',
      randomBytes(16).toString('base64'),
      randomBytes(33).toString('base64'),
      randomBytes(31).toString('hex'),
      `${bytes.toString('hex').slice(0, 63)}g`,
      bytes.toString('base64').replace('=', ''),
      bytes.toString('base64url'),
      'change-me-files',
    ]) {
      // base64url differs from base64 only when the bytes happen to contain - or _, so only check the ones that do.
      if (bad === bytes.toString('base64url') && bad === bytes.toString('base64')) continue;
      expect(parseFileKey(bad), bad).toBeNull();
    }
  });

  it('gives the same key id for the same key and a different one for another', () => {
    const a = deriveFileKeys(bytes);
    expect(deriveFileKeys(bytes).keyId.equals(a.keyId)).toBe(true);
    expect(a.keyId.length).toBe(8);
    expect(a.keyId.equals(otherKeys.keyId)).toBe(false);
    // The id and the master key are not the configured bytes.
    expect(a.master.equals(bytes)).toBe(false);
  });
});
