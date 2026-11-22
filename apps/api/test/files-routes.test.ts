// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILES_ROUTES } from '@kinship/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { ACCOUNTS, buildFamily, signInAll } from './helpers/family.js';
import type { Who } from './helpers/family.js';
import { createFilesService } from '../src/files/state.js';

let t: TestApp;
let root: string;
let as: Awaited<ReturnType<typeof signInAll>>;
const key = randomBytes(32);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kinship-files-routes-'));
  t = await createTestApp({ files: createFilesService({ dir: join(root, 'files'), key }) });
  as = await signInAll(t.app, await buildFamily(t.owner));
}, 90_000);

afterAll(async () => {
  await t.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/admin/files', () => {
  it('is for the SuperAdmin only', async () => {
    const route = FILES_ROUTES[0];
    for (const who of ['anonymous', ...ACCOUNTS] as Who[]) {
      if (who === 'superadmin') continue;
      expect((await as(who, route.method, route.path)).status, who).toBe(who === 'anonymous' ? 401 : 403);
    }
  });

  it('says ready with the key id, and never the key', async () => {
    const response = await as('superadmin', 'GET', '/api/admin/files');
    expect(response.status).toBe(200);
    const body = response.body as { state: string; keyId: string };
    expect(body.state).toBe('ready');
    expect(body.keyId).toMatch(/^[0-9a-f]{16}$/);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(key.toString('hex'));
    expect(text).not.toContain(key.toString('base64'));
  });
});

describe('without a key', () => {
  it('says key_missing', async () => {
    const bare = await createTestApp({ files: createFilesService({ dir: join(root, 'none'), key: undefined }) });
    try {
      const as2 = await signInAll(bare.app, await buildFamily(bare.owner));
      expect((await as2('superadmin', 'GET', '/api/admin/files')).body).toEqual({
        state: 'key_missing',
        keyId: null,
      });
    } finally {
      await bare.close();
    }
  });
});
