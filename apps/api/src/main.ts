// SPDX-License-Identifier: AGPL-3.0-or-later
import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { prepareSetupToken, scheduleSessionCleanup } from './auth/startup.js';
import { createAppDb, createOwnerDb } from './db.js';
import { runMigrations } from './migrations/runner.js';
import { ensureAppRole } from './migrations/roles.js';
import { readVersion } from './version.js';

function log(message: string): void {
  console.log(JSON.stringify({ level: 'info', time: Date.now(), msg: message }));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const version = readVersion(config.gitCommit);
  log(`KinShip API ${version.version} (${version.commit}) starting`);

  // 1. As the owner role: create/refresh the app role, then migrate. Then let go of the owner.
  const owner = createOwnerDb(config.db);
  try {
    await ensureAppRole(owner, config.db.appUser, config.db.appPassword);
    const { applied } = await runMigrations(owner, { dir: config.migrationsDir, appRole: config.db.appUser, log });
    log(applied.length === 0 ? 'database is up to date' : `applied ${applied.length} migration(s)`);
  } finally {
    await owner.destroy();
  }

  // 2. As the app role: serve requests.
  const db = createAppDb(config.db);
  await prepareSetupToken(db, config.publicUrl, (text) => console.log(text));
  const stopCleanup = scheduleSessionCleanup(db, log);
  const app = buildApp({
    db,
    version,
    logLevel: config.logLevel,
    trustProxy: config.trustProxy,
    sessions: { idleSeconds: config.sessionIdleSeconds, maxSeconds: config.sessionMaxSeconds },
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    stopCleanup();
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`);
  } else {
    console.error('KinShip API failed to start:', error);
  }
  process.exit(1);
});
