// SPDX-License-Identifier: AGPL-3.0-or-later
// The request log keeps one-time secrets out (#74): the backup download ticket is a query parameter.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACTED, redactUrl } from '../src/log-redact.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

describe('redactUrl', () => {
  it('replaces the value of ticket and token, and nothing else', () => {
    expect(redactUrl('/api/admin/backups/download?ticket=abc_DEF-123')).toBe(
      `/api/admin/backups/download?ticket=${REDACTED}`,
    );
    expect(redactUrl('/x?a=1&Ticket=s3cret&b=2&token=t0k')).toBe(`/x?a=1&Ticket=${REDACTED}&b=2&token=${REDACTED}`);
    expect(redactUrl('/x?tick%65t=s3cret')).toBe(`/x?tick%65t=${REDACTED}`); // an encoded name is still the name
    expect(redactUrl('/x?ticket')).toBe(`/x?ticket=${REDACTED}`);
    expect(redactUrl('/x?ticket=a&ticket=b')).toBe(`/x?ticket=${REDACTED}&ticket=${REDACTED}`);
  });

  it('leaves URLs without a secret as they are', () => {
    for (const url of ['/api/people', '/api/people?q=rosa&limit=50', '/x?tickets=1', '/x?%E0%A4%A=1', '/x?']) {
      expect(redactUrl(url)).toBe(url);
    }
  });
});

describe('the request log', () => {
  const logged: string[] = [];
  let t: TestApp;
  beforeAll(async () => {
    const logStream = new Writable({ write: (chunk: Buffer, _enc, done) => (logged.push(chunk.toString()), done()) });
    t = await createTestApp({ logLevel: 'info', logStream });
  });
  afterAll(() => t.close());

  it('shows the download route with the ticket redacted, and never the ticket', async () => {
    const secret = 'SECRET-ticket-value_0123456789abcdefABCDEF';
    const response = await t.app.inject({ method: 'GET', url: `/api/admin/backups/download?ticket=${secret}` });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const text = logged.join('');
    expect(text).toContain(`/api/admin/backups/download?ticket=${REDACTED}`);
    expect(text).not.toContain(secret);
    // The rest of the request line is still there.
    const line = logged.map((l) => JSON.parse(l) as { req?: Record<string, unknown> }).find((l) => l.req)!;
    expect(line.req).toMatchObject({ method: 'GET', url: `/api/admin/backups/download?ticket=${REDACTED}` });
  });
});
