// SPDX-License-Identifier: AGPL-3.0-or-later
import { buildApp } from './app.js';
import { ConfigError, loadConfig, scrubSecretsFromEnv } from './config.js';
import { passphraseProblem } from './backup/crypto.js';
import { prepareSetupToken, scheduleSessionCleanup } from './auth/startup.js';
import { createAppDb, createOwnerDb } from './db.js';
import { runMigrations } from './migrations/runner.js';
import { ensureAppRole } from './migrations/roles.js';
import { readVersion } from './version.js';
import { backupHousekeeping, createScheduler } from './backup/scheduler.js';
import { toolsFromEnv } from './backup/tools.js';

function log(message: string): void {
  console.log(JSON.stringify({ level: 'info', time: Date.now(), msg: message }));
}

async function main(): Promise<void> {
  const config = loadConfig();
  scrubSecretsFromEnv();
  const version = readVersion(config.gitCommit, config.buildDate);
  log(`KinShip API ${version.version} (${version.commit}, built ${version.buildDate}) starting`);

  const backupProblem = passphraseProblem(config.backup.passphrase);
  if (backupProblem !== null) {
    console.log(
      JSON.stringify({
        level: 'warn',
        time: Date.now(),
        msg: `backups are not available: ${backupProblem}. Set BACKUP_PASSPHRASE in .env (see INSTALL.md).`,
      }),
    );
  }

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

  // Built-in backups: the schedule runs in this process. It needs a usable passphrase; without one it stays off (see above).
  const backupCtx = {
    config,
    tools: toolsFromEnv(),
    appVersion: version.version,
    log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) =>
      console.log(JSON.stringify({ level, time: Date.now(), msg: message, ...fields })),
  };
  void backupHousekeeping(backupCtx);
  const scheduler = createScheduler(backupCtx);
  scheduler.start();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    scheduler.stop();
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
