// SPDX-License-Identifier: AGPL-3.0-or-later
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilesService, MARKER } from '../src/files/state.js';

let root: string;
const key = randomBytes(32);
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kinship-files-'));
});
afterEach(() => {
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
});

describe('the files service', () => {
  it('without a key: key_missing, and nothing is created', async () => {
    const dir = join(root, 'files');
    const service = createFilesService({ dir, key: undefined });
    expect(await service.refresh()).toEqual({ state: 'key_missing', keyId: null });
    expect(service.usable()).toBe(false);
    expect(service.acceptsUploads()).toBe(false);
    expect(service.keys()).toBeNull();
    expect(existsSync(dir)).toBe(false);
  });

  it('with a key and a writable folder: sets the folder up once and is ready', async () => {
    const dir = join(root, 'files');
    const service = createFilesService({ dir, key });
    const status = await service.refresh();
    expect(status.state).toBe('ready');
    expect(status.keyId).toMatch(/^[0-9a-f]{16}$/);
    for (const name of [MARKER, 'objects', 'tmp', 'staging']) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(service.acceptsUploads()).toBe(true);
    expect((await service.refresh()).state).toBe('ready');
  });

  it('never gives the key away in the status', async () => {
    const service = createFilesService({ dir: join(root, 'f'), key });
    const text = JSON.stringify(await service.refresh());
    expect(text).not.toContain(key.toString('hex'));
    expect(text).not.toContain(key.toString('base64'));
  });

  it('a folder that cannot be written is files_unavailable, not an empty folder', async () => {
    chmodSync(root, 0o500);
    if (process.getuid?.() === 0) return; // root writes anywhere
    const service = createFilesService({ dir: join(root, 'files'), key });
    expect((await service.refresh()).state).toBe('files_unavailable');
    expect(service.usable()).toBe(false);
  });

  it('a missing marker while photos exist is files_unavailable and nothing is created', async () => {
    const dir = join(root, 'files');
    const service = createFilesService({ dir, key }, { mediaRowsExist: () => Promise.resolve(true) });
    expect((await service.refresh()).state).toBe('files_unavailable');
    expect(existsSync(join(dir, MARKER))).toBe(false);
    // The marker present: fine again.
    writeFileSync(join(dir, MARKER), '{}');
    expect((await service.refresh()).state).toBe('ready');
  });

  it('a stored key id that is not this key is key_mismatch: uploads refused, the api still usable', async () => {
    const dir = join(root, 'files');
    const service = createFilesService({ dir, key }, { sampleKeyIds: () => Promise.resolve(['0011223344556677']) });
    expect((await service.refresh()).state).toBe('key_mismatch');
    expect(service.acceptsUploads()).toBe(false);
    expect(service.usable()).toBe(true);
  });

  it('the same key id as the stored rows is ready', async () => {
    const dir = join(root, 'files');
    const first = createFilesService({ dir, key });
    const { keyId } = await first.refresh();
    const second = createFilesService({ dir, key }, { sampleKeyIds: () => Promise.resolve([keyId as string]) });
    expect((await second.refresh()).state).toBe('ready');
  });
});
