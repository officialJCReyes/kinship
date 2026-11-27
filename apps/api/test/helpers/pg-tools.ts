// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../src/config.js';
import type { Tools } from '../../src/backup/tools.js';
import { toolsFromEnv } from '../../src/backup/tools.js';
import type { TestDatabase } from './db.js';
import { server } from './db.js';

/** A PostgreSQL client of major 18 or newer on the path, when there is one. */
function localClientOk(): boolean {
  try {
    const out = execFileSync('pg_dump', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    return Number(/(\d+)/.exec(out.replace(/^.*\(PostgreSQL\)\s*/, ''))?.[1] ?? 0) >= 18;
  } catch {
    return false;
  }
}

let cached: Tools | undefined;

/**
 * The tools the backup code runs. PG_DUMP, PG_RESTORE and PSQL win when set. Otherwise a PostgreSQL 18 client on the path
 * is used (CI installs one). Failing that (a laptop with Docker and no client), wrappers run the tools inside the dev
 * database container, which works because the code only talks to them through stdin and stdout.
 */
export function testTools(): Tools {
  if (cached) return cached;
  const fromEnv = toolsFromEnv();
  if (process.env['PG_DUMP'] || localClientOk()) return (cached = fromEnv);
  const container = execFileSync('docker', ['ps', '--filter', `publish=${server.port}`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  })
    .split('\n')[0]
    ?.trim();
  if (!container) throw new Error('No PostgreSQL 18 client and no dev database container to borrow one from.');
  const dir = mkdtempSync(join(tmpdir(), 'kinship-pgtools-'));
  const wrap = (tool: string): string => {
    const path = join(dir, tool);
    writeFileSync(
      path,
      `#!/bin/sh\nexec docker exec -i -e PGPASSWORD -e PGUSER -e PGDATABASE -e PGOPTIONS -e PGAPPNAME -e LC_ALL -e PGCONNECT_TIMEOUT ` +
        `-e PGHOST=127.0.0.1 -e PGPORT=5432 ${container} ${tool} "$@"\n`,
    );
    chmodSync(path, 0o755);
    return path;
  };
  return (cached = { ...fromEnv, pgDump: wrap('pg_dump'), pgRestore: wrap('pg_restore'), psql: wrap('psql') });
}

/** A Config for the backup code, around a test database. */
export function testConfig(test: TestDatabase, dir: string, passphrase: string | undefined): Config {
  return {
    publicUrl: 'http://localhost:8080',
    trustProxy: false,
    sessionIdleSeconds: 3600,
    sessionMaxSeconds: 86_400,
    logLevel: 'silent',
    host: '127.0.0.1',
    port: 3000,
    migrationsDir: '',
    gitCommit: 'test',
    buildDate: 'unknown',
    db: test.config,
    backup: { enabled: true, dir, passphrase, skipSafetyCopy: false },
    files: { dir: `${dir}-files`, key: undefined },
    mail: { provider: 'off' },
  };
}

/**
 * How far two pg_database_size readings of the same, idle database may be apart (#230). The size counts the relation cache file
 * pg_internal.init (about 160 KB on Postgres 18), which Postgres deletes on a cache invalidation and the next new connection
 * writes again, so one reading can have it and the next not; on a test database of about 10 MB that alone is 1.6 %. Allowed:
 * 1 % of the size plus 256 KB.
 */
export const sizeSlack = (bytes: number): number => Math.ceil(bytes * 0.01) + 256 * 1024;
