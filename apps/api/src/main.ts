// SPDX-License-Identifier: AGPL-3.0-or-later
import { buildApp } from './app.js';
import { ConfigError, loadConfig, scrubSecretsFromEnv } from './config.js';
import { passphraseProblem } from './backup/crypto.js';
import { prepareSetupToken, scheduleSessionCleanup } from './auth/startup.js';
import { createAppDb } from './db.js';
import { migrateWithSafetyCopy, SafetyCopyError } from './backup/upgrade.js';
import { readVersion } from './version.js';
import { backupHousekeeping, createScheduler } from './backup/scheduler.js';
import { createRestoreService, lastRestoreOf, reconcileRestores } from './backup/restore-service.js';
import { createMaintenance } from './maintenance.js';
import { createJobRunner } from './jobs/runner.js';
import { createUpdateChecker } from './updates/checker.js';
import { loadBundledDocs } from './updates/docs.js';
import { useProxyFromEnv } from './updates/proxy.js';
import { toolsFromEnv } from './backup/tools.js';
import { createFilesService, FILES_FIX_LONG } from './files/state.js';
import { createObjectStore } from './files/objects.js';
import { readRestoreMarker } from './files/restore-marker.js';
import { reconcileFiles } from './backup/restore-files.js';
import { mediaRowsExist, storedKeyIds } from './media/store.js';
import { createSweeperJob } from './media/sweeper.js';
import { createMailService } from './mail/outbox.js';

function log(message: string): void {
  console.log(JSON.stringify({ level: 'info', time: Date.now(), msg: message }));
}

async function main(): Promise<void> {
  const config = loadConfig();
  scrubSecretsFromEnv();
  const version = readVersion(config.gitCommit, config.buildDate);
  log(`KinShip API ${version.version} (${version.commit}, built ${version.buildDate}) starting`);

  if (config.mail.provider === 'smtp' && config.mail.smtp.security === 'none') {
    console.log(
      JSON.stringify({
        level: 'warn',
        time: Date.now(),
        msg: 'SMTP_SECURE=none: email goes to the SMTP server without encryption. Use this only for a relay on a network you trust.',
      }),
    );
  }

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

  // Stored files (ADR 0033). The key is optional: without it, or without the folder, KinShip runs and photos are off. The two
  // checks that need the media table are answered once the database is up (below).
  const dbHolder: { db?: ReturnType<typeof createAppDb> } = {};
  const files = createFilesService(config.files, {
    mediaRowsExist: () => (dbHolder.db ? mediaRowsExist(dbHolder.db) : Promise.resolve(false)),
    sampleKeyIds: () => (dbHolder.db ? storedKeyIds(dbHolder.db) : Promise.resolve([])),
  });

  // 1. As the owner role: create/refresh the app role, make the safety copy if a database change is pending, then migrate.
  try {
    const result = await migrateWithSafetyCopy({
      config,
      tools: toolsFromEnv(),
      appVersion: version.version,
      log: (level, message, fields) =>
        console.log(JSON.stringify({ level, time: Date.now(), msg: message, ...fields })),
    });
    log(result.applied.length === 0 ? 'database is up to date' : `applied ${result.applied.length} migration(s)`);
  } catch (error) {
    if (error instanceof SafetyCopyError) {
      console.error(`KinShip did not start: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  // 2. As the app role: serve requests.
  const db = createAppDb(config.db);
  dbHolder.db = db;
  // A restore that put photo files back and was cut short between the database commit and the file swap is finished (or its
  // staged files thrown away) here, before anything else looks at the files folder (ADR 0035).
  try {
    const reconciled = await reconcileFiles(config.files.dir, () => readRestoreMarker(db));
    if (reconciled.action === 'completed')
      log('a restore was cut short after the database committed; its photo files are now in place');
    if (reconciled.action === 'discarded')
      log(
        'a restore was cut short before the database committed; its unpacked photo files were removed and nothing changed',
      );
  } catch (error) {
    console.log(
      JSON.stringify({
        level: 'error',
        time: Date.now(),
        msg: 'could not finish a cut-short restore of the photo files',
        reason: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  const filesStatus = await files.refresh();
  if (filesStatus.state === 'key_missing') {
    log('photos are off: no FILE_ENCRYPTION_KEY is set (see UPGRADE.md or INSTALL.md)');
  } else if (filesStatus.state === 'files_unavailable') {
    console.log(
      JSON.stringify({
        level: 'warn',
        time: Date.now(),
        msg: `photos are off: the files folder ${config.files.dir} cannot be used.\n${FILES_FIX_LONG}`,
      }),
    );
  } else if (filesStatus.state === 'key_mismatch') {
    console.log(
      JSON.stringify({
        level: 'warn',
        time: Date.now(),
        msg: 'the file encryption key does not match your stored photos: new uploads are refused. Put back the key you used before.',
      }),
    );
  }
  await prepareSetupToken(db, config.publicUrl, (text) => console.log(text));
  let stopCleanup = scheduleSessionCleanup(db, log);
  // Built-in backups: the schedule runs in this process. It needs a usable passphrase; without one it stays off (see above).
  const backupCtx = {
    config,
    tools: toolsFromEnv(),
    appVersion: version.version,
    log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) =>
      console.log(JSON.stringify({ level, time: Date.now(), msg: message, ...fields })),
  };
  void backupHousekeeping(backupCtx);
  // A restore that was started and never ended (the api was killed) left the data as it was; say so.
  await reconcileRestores(config.backup.dir, backupCtx.log);
  const scheduler = createScheduler(backupCtx);
  // The api's own periodic jobs share one runner: the backup schedule and the daily update check. The update check reads GitHub's
  // public release list through HTTPS_PROXY when that is set (ADR 0015), and sends nothing about this installation.
  const viaProxy = useProxyFromEnv();
  const checker = createUpdateChecker({ db: config.db, version: version.version, log: backupCtx.log, viaProxy });
  const jobs = createJobRunner(backupCtx.log);
  jobs.register({ name: 'backups', run: (now) => scheduler.tick(now) });
  jobs.register(checker.job);
  jobs.register(
    createSweeperJob({
      db,
      files,
      objects: createObjectStore(config.files.dir, () => files.keys()),
      log: backupCtx.log,
    }),
  );
  // Email (ADR 0041): the outbox is sent by a job in this runner, and right away when something is queued (kick).
  const mail = createMailService({ config: config.mail, db: config.db, log: backupCtx.log });
  jobs.register(mail.job);
  log(
    config.mail.provider === 'off'
      ? 'email is not set up (no MAIL_PROVIDER, RESEND_API_KEY or SMTP_HOST); KinShip works as before, without sending email'
      : `email is set up: ${config.mail.provider === 'resend' ? 'Resend' : 'SMTP'}, from ${config.mail.from}`,
  );
  jobs.start();

  // In-app restore (ADR 0031): the maintenance gate, and the service that pauses everything, replaces the database and exits so
  // Docker starts a fresh api. `app` is created below; the service reaches it through this holder.
  const maintenance = createMaintenance({ lastRestore: () => lastRestoreOf(config.backup.dir) });
  const holder: { app?: ReturnType<typeof buildApp> } = {};
  const restore = createRestoreService({
    ctx: backupCtx,
    maintenance,
    scheduler,
    async pause() {
      jobs.pause();
      mail.pause();
      stopCleanup();
      return jobs.idle(30_000);
    },
    resume() {
      jobs.resume();
      mail.resume();
      stopCleanup = scheduleSessionCleanup(db, log);
    },
    closePool: () => db.destroy(),
    closeIdle: () => holder.app?.server.closeIdleConnections(),
    exit: (code) => {
      // Let the last log lines and the answer to the page's poll go out, then end the process.
      setTimeout(() => process.exit(code), 500).unref();
    },
  });

  const app = buildApp({
    db,
    version,
    logLevel: config.logLevel,
    trustProxy: config.trustProxy,
    maintenance,
    backups: { scheduler, dir: config.backup.dir, restore },
    files,
    mail,
    publicUrl: config.publicUrl,
    updates: { checker, docs: loadBundledDocs() },
    sessions: { idleSeconds: config.sessionIdleSeconds, maxSeconds: config.sessionMaxSeconds },
  });

  holder.app = app;

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    jobs.stop();
    stopCleanup();
    await app.close();
    await mail.close();
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
