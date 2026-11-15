// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Kysely } from 'kysely';
import type { Database } from '../db.js';
import { deleteExpiredSessions, needsSetup, setSetupToken } from './store.js';
import { generateSetupToken, hashToken } from './tokens.js';

/**
 * On a start with no accounts: make a one-time setup token, store only its
 * hash, and print the token once. Whoever can read the logs (the person who
 * runs the server) can finish setup; a stranger who reaches the site first
 * cannot. Restarting before setup makes a new token and forgets the old one.
 * Returns true when a token was made.
 */
export async function prepareSetupToken(
  db: Kysely<Database>,
  publicUrl: string,
  print: (text: string) => void,
): Promise<boolean> {
  if (!(await needsSetup(db))) return false;
  const token = generateSetupToken();
  if (!(await setSetupToken(db, hashToken(token)))) return false;
  const rule = '='.repeat(66);
  print(
    [
      '',
      rule,
      'KinShip is not set up yet.',
      '',
      `Open ${publicUrl}/setup and enter this one-time setup token:`,
      '',
      `    ${token}`,
      '',
      'It is shown only now and only its hash is stored. It stops working once',
      'setup is done. If you restart before finishing, a new token is made.',
      rule,
      '',
    ].join('\n'),
  );
  return true;
}

/** Removes expired sessions now and then. The timer does not keep the process alive. */
export function scheduleSessionCleanup(
  db: Kysely<Database>,
  log: (message: string) => void,
  everyMs = 60 * 60 * 1000,
): () => void {
  const run = () => {
    deleteExpiredSessions(db).then(
      (n) => {
        if (n > 0) log(`removed ${n} expired session(s)`);
      },
      (error: unknown) => log(`could not remove expired sessions: ${String(error)}`),
    );
  };
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
