// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox (ADR 0041). Every email is a row in mail_outbox first, written in the same transaction as the change that asked
// for it; this service sends the rows, so a slow or down provider never slows a request and a restart loses nothing.
//
//   * Claims: a sender takes up to 10 due rows at a time with FOR UPDATE SKIP LOCKED, marks them `sending` and holds them for
//     5 minutes (`locked_until`). Two api containers each take different rows; a sender that dies mid-send leaves its rows to
//     run out, and the next claim takes them back. Delivery is therefore at least once: a duplicate is possible in that rare
//     case (Resend's idempotency key, the outbox id, removes it there).
//   * Retries: 7 attempts in all, waiting 1 min, 5 min, 15 min, 1 h, 3 h and 6 h between them (about 10 hours). A permanent
//     refusal (the provider says this message can never go) fails at once. A message whose link stops working (`expires_at`)
//     is cancelled, never sent late.
//   * Privacy: the subject and body are cleared the moment a row is sent, given up or cancelled (the table's CHECK insists);
//     finished rows are deleted after 30 days. Errors are cleaned (clean-error.ts) before they are stored.
//   * Waking: callers `kick()` after their transaction commits, so a message goes within a second or two; the job runner's
//     minute tick picks up retries and anything a kick missed.
//
// The sending side connects as the owner role (the app role cannot read the table); queueing goes through
// kinship_mail_enqueue() as the app role, inside the caller's transaction.
import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import type { DbConfig, MailConfig } from '../config.js';
import { isMailAddress } from '../config.js';
import { createDb } from '../db.js';
import type { AnySchema, Database, UntypedDb } from '../db.js';
import type { Job, JobLog } from '../jobs/runner.js';
import { cleanError, secretForms } from './clean-error.js';
import { createResendTransport } from './resend.js';
import { createSmtpTransport } from './smtp.js';
import { MailSendError } from './transport.js';
import type { MailTransport } from './transport.js';

export const BATCH = 10;
export const MAX_PER_DRAIN = 50;
export const MAX_ATTEMPTS = 7;
/** The wait after attempt n (1-based) fails, for n = 1..6. */
export const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
] as const;
export const HOLD_MS = 5 * 60_000;
export const KEEP_FINISHED_DAYS = 30;

/** A message to queue. The subject and the two bodies are already rendered. */
export interface QueuedMail {
  template: string;
  to: string;
  toUserId: string | null;
  subject: string;
  text: string;
  html: string | null;
  /** When the link inside stops working: the message is cancelled rather than sent after this. */
  expiresAt?: Date | null;
}

export class MailNotConfigured extends Error {
  override name = 'MailNotConfigured';
}

export interface DrainResult {
  sent: number;
  retried: number;
  failed: number;
  cancelled: number;
}

export interface MailService {
  /** Is a provider set up? Step 54 asks this before offering "Send by email" or "Forgot password?". */
  isConfigured(): boolean;
  readonly config: MailConfig;
  /** Queues one message in the caller's transaction (as the app role). Call `kick()` after the transaction commits. */
  enqueue(db: Kysely<Database> | Transaction<Database>, mail: QueuedMail): Promise<string>;
  /** Send what is due soon, in the background. Does nothing while paused or when mail is not set up. */
  kick(): void;
  /** One pass: cancel expired rows, take back abandoned ones, send what is due (up to MAX_PER_DRAIN). */
  drain(now?: Date): Promise<DrainResult>;
  /** Deletes finished rows older than KEEP_FINISHED_DAYS. */
  prune(now?: Date): Promise<number>;
  /** For the job runner: a drain and a prune every tick. */
  readonly job: Job;
  /** A restore is replacing the database: nothing is sent until `resume()`. */
  pause(): void;
  resume(): void;
  /** Resolves when no background drain is running (tests, shutdown). */
  idle(): Promise<void>;
  close(): Promise<void>;
}

export interface MailServiceOptions {
  config: MailConfig;
  /** The database settings; the sender connects as the owner role. */
  db?: DbConfig;
  /** Tests: an owner connection to use instead (or a function that returns it, for an app built before the database). */
  ownerDb?: UntypedDb | (() => UntypedDb);
  /** Tests: a fake transport instead of the configured provider. */
  transport?: MailTransport;
  log: JobLog;
  now?: () => Date;
}

/** The transport the settings describe, or null when mail is not set up. */
export function transportFor(config: MailConfig): MailTransport | null {
  if (config.provider === 'resend') return createResendTransport({ apiKey: config.resendApiKey });
  if (config.provider === 'smtp') return createSmtpTransport(config.smtp);
  return null;
}

/** The secrets whose every form must be removed from a stored error. */
function secretsOf(config: MailConfig): string[] {
  if (config.provider === 'resend') return secretForms({ key: config.resendApiKey });
  if (config.provider === 'smtp') return secretForms({ user: config.smtp.user, password: config.smtp.password });
  return [];
}

interface ClaimedRow {
  id: string;
  template: string;
  to_address: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  attempts: number;
  expires_at: Date | null;
}

/** The checks the database also makes, with a clear message instead of a constraint name. */
export function checkQueuedMail(mail: QueuedMail): void {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(mail.template)) throw new Error('mail template id is not valid');
  if (!isMailAddress(mail.to)) throw new Error('mail recipient is not one plain address');
  // eslint-disable-next-line no-control-regex
  if (mail.subject === '' || mail.subject.length > 400 || /[\u0000-\u001f\u007f]/.test(mail.subject)) {
    throw new Error('mail subject is empty, too long or has a line break');
  }
}

export function createMailService(options: MailServiceOptions): MailService {
  const { config, log } = options;
  const clock = () => options.now?.() ?? new Date();
  const transport = options.transport ?? transportFor(config);
  const secrets = secretsOf(config);
  const given = options.ownerDb;
  let owner: UntypedDb | undefined;
  const ownerDb = (): UntypedDb => {
    if (given) return typeof given === 'function' ? given() : given;
    if (!owner) {
      if (!options.db) throw new Error('the mail service needs database settings');
      owner = createDb<AnySchema>(options.db, options.db.ownerUser, options.db.ownerPassword, 2);
    }
    return owner;
  };
  let paused = false;
  let running: Promise<void> | null = null;
  let again = false;

  async function finish(
    db: UntypedDb,
    id: string,
    status: 'sent' | 'failed' | 'cancelled',
    now: Date,
    fields: { error?: string | null; providerId?: string | null } = {},
  ): Promise<void> {
    await sql`
      update mail_outbox
         set status = ${status}, subject = null, body_text = null, body_html = null, locked_until = null,
             finished_at = ${now}, sent_at = ${status === 'sent' ? now : null},
             provider_id = ${fields.providerId ?? null},
             last_error = ${status === 'sent' ? null : (fields.error ?? null)}
       where id = ${id}`.execute(db);
  }

  async function sendOne(db: UntypedDb, row: ClaimedRow, now: Date, result: DrainResult): Promise<void> {
    if (!transport) return;
    if (row.expires_at !== null && row.expires_at.getTime() <= now.getTime()) {
      await finish(db, row.id, 'cancelled', now, { error: 'The link in this email expired before it could be sent.' });
      result.cancelled += 1;
      return;
    }
    try {
      const sent = await transport.send({
        id: row.id,
        from: config.provider === 'off' ? '' : config.from,
        to: row.to_address,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html,
      });
      await finish(db, row.id, 'sent', clock(), { providerId: sent.providerId });
      result.sent += 1;
      log('info', 'an email was sent', { mail: row.id, template: row.template, attempt: row.attempts });
    } catch (error) {
      const permanent = error instanceof MailSendError && error.permanent;
      const raw = error instanceof Error ? error.message : 'unknown error';
      const cleaned = cleanError(raw, secrets);
      const at = clock();
      const delay = RETRY_DELAYS_MS[row.attempts - 1];
      if (permanent || row.attempts >= MAX_ATTEMPTS || delay === undefined) {
        await finish(db, row.id, 'failed', at, { error: cleaned });
        result.failed += 1;
        log('warn', 'an email could not be sent and was given up', {
          mail: row.id,
          template: row.template,
          attempt: row.attempts,
          reason: cleaned,
        });
      } else {
        await sql`
          update mail_outbox
             set status = 'queued', locked_until = null, last_error = ${cleaned},
                 next_attempt_at = ${new Date(at.getTime() + delay)}
           where id = ${row.id}`.execute(db);
        result.retried += 1;
        log('warn', 'an email could not be sent yet; it will be tried again', {
          mail: row.id,
          template: row.template,
          attempt: row.attempts,
          reason: cleaned,
        });
      }
    }
  }

  async function drain(now = clock()): Promise<DrainResult> {
    const result: DrainResult = { sent: 0, retried: 0, failed: 0, cancelled: 0 };
    if (!transport || paused) return result;
    const db = ownerDb();
    // Expired messages are cancelled (never sent late), and rows a dead sender held after their last attempt are given up.
    const expired = await sql<{ id: string }>`
      update mail_outbox
         set status = 'cancelled', subject = null, body_text = null, body_html = null, locked_until = null,
             finished_at = ${now}, last_error = 'The link in this email expired before it could be sent.'
       where status in ('queued', 'sending') and expires_at <= ${now}
         and (status = 'queued' or locked_until < ${now})
      returning id`.execute(db);
    result.cancelled += expired.rows.length;
    const abandoned = await sql<{ id: string }>`
      update mail_outbox
         set status = 'failed', subject = null, body_text = null, body_html = null, locked_until = null,
             finished_at = ${now}, last_error = coalesce(last_error, 'The sender stopped while sending this email.')
       where status = 'sending' and locked_until < ${now} and attempts >= ${MAX_ATTEMPTS}
      returning id`.execute(db);
    result.failed += abandoned.rows.length;

    let taken = 0;
    while (taken < MAX_PER_DRAIN && !paused) {
      const claimed = await sql<ClaimedRow>`
        update mail_outbox o
           set status = 'sending', attempts = o.attempts + 1, locked_until = ${new Date(now.getTime() + HOLD_MS)}
         where o.id in (
           select id from mail_outbox
            where (status = 'queued' and next_attempt_at <= ${now})
               or (status = 'sending' and locked_until < ${now})
            order by next_attempt_at, created_at
            limit ${Math.min(BATCH, MAX_PER_DRAIN - taken)}
            for update skip locked)
        returning o.id, o.template, o.to_address, o.subject, o.body_text, o.body_html, o.attempts, o.expires_at`.execute(
        db,
      );
      if (claimed.rows.length === 0) break;
      taken += claimed.rows.length;
      for (const row of claimed.rows) await sendOne(db, row, clock(), result);
    }
    return result;
  }

  async function prune(now = clock()): Promise<number> {
    const cutoff = new Date(now.getTime() - KEEP_FINISHED_DAYS * 86_400_000);
    const removed = await sql`delete from mail_outbox where finished_at < ${cutoff}`.execute(ownerDb());
    return Number(removed.numAffectedRows ?? 0);
  }

  function kick(): void {
    if (!transport || paused) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await drain();
        } while (again && !paused);
      } catch (error) {
        log('error', 'sending email failed', { reason: error instanceof Error ? error.name : 'unknown' });
      } finally {
        running = null;
      }
    })();
  }

  return {
    config,
    isConfigured: () => config.provider !== 'off',
    async enqueue(db, mail) {
      if (config.provider === 'off') throw new MailNotConfigured('email is not set up');
      checkQueuedMail(mail);
      const result = await sql<{ id: string }>`
        select public.kinship_mail_enqueue(${mail.template}, ${mail.to}, ${mail.toUserId}, ${mail.subject}, ${mail.text},
                                           ${mail.html}, ${mail.expiresAt ?? null}) as id`.execute(db);
      const id = result.rows[0]?.id;
      if (!id) throw new Error('the outbox did not return an id');
      return id;
    },
    kick,
    drain,
    prune,
    job: {
      name: 'mail',
      async run(now) {
        if (!transport) return;
        await drain(now);
        await prune(now);
      },
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    async idle() {
      while (running) await running;
    },
    async close() {
      paused = true;
      while (running) await running;
      if (owner) await owner.destroy();
      owner = undefined;
    },
  };
}
