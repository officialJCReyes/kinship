// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The outbox against a real database and a fake transport: queueing in the caller's transaction, sending, the retry curve,
// giving up, expiry, claims shared by two senders, a sender that died, pruning, and the privacy rules the table enforces.
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MailConfig } from '../src/config.js';
import { withUserTransaction } from '../src/request-context.js';
import {
  createMailService,
  HOLD_MS,
  KEEP_FINISHED_DAYS,
  MailNotConfigured,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from '../src/mail/outbox.js';
import type { QueuedMail } from '../src/mail/outbox.js';
import { createTestApp, insertUser } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';
import { memoryTransport, permanent, temporary } from './helpers/fake-mail.js';

const CONFIG: MailConfig = {
  provider: 'resend',
  from: 'Hale Family Tree <tree@hale.example>',
  resendApiKey: 're_testkey_1',
};
const T0 = new Date('2026-11-28T12:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

let t: TestApp;
let superId: string;
let memberId: string;
const logs: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
const log = (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) =>
  void logs.push({ level, message, ...(fields ? { fields } : {}) });

const message = (overrides: Partial<QueuedMail> = {}): QueuedMail => ({
  template: 'test',
  to: 'sofia@hale.example',
  toUserId: null,
  subject: 'KinShip test email',
  text: 'Hello Sofia',
  html: '<p>Hello Sofia</p>',
  ...overrides,
});

beforeAll(async () => {
  t = await createTestApp();
  superId = await insertUser(t.owner, { email: 'marcus@hale.example', displayName: 'Marcus Hale', role: 'superadmin' });
  memberId = await insertUser(t.owner, { email: 'sofia@hale.example', displayName: 'Sofia Hale', role: 'member' });
}, 60_000);
afterAll(() => t.close());
beforeEach(async () => {
  await sql`delete from mail_outbox`.execute(t.owner);
  logs.length = 0;
});

const rows = async () =>
  (
    await sql<{
      id: string;
      status: string;
      attempts: number;
      subject: string | null;
      body_text: string | null;
      body_html: string | null;
      last_error: string | null;
      next_attempt_at: Date;
      finished_at: Date | null;
      sent_at: Date | null;
      provider_id: string | null;
      created_by: string | null;
    }>`select * from mail_outbox order by created_at, id`.execute(t.owner)
  ).rows;

function service(now: () => Date = () => T0) {
  const transport = memoryTransport();
  const mail = createMailService({ config: CONFIG, ownerDb: t.owner, transport, log, now });
  return { mail, transport };
}

describe('queueing', () => {
  it('goes through the app role, in the caller’s transaction, and records who asked', async () => {
    const { mail } = service();
    const id = await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    const [row] = await rows();
    expect(row).toMatchObject({
      id,
      status: 'queued',
      attempts: 0,
      subject: 'KinShip test email',
      created_by: superId,
    });
  });

  it('is undone with the transaction that asked for it', async () => {
    const { mail } = service();
    await expect(
      withUserTransaction(t.db, superId, async (trx) => {
        await mail.enqueue(trx, message());
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    expect(await rows()).toEqual([]);
  });

  it('works with nobody signed in (a reset request in step 54)', async () => {
    const { mail } = service();
    await withUserTransaction(t.db, null, (trx) => mail.enqueue(trx, message()));
    expect((await rows())[0]?.created_by).toBeNull();
  });

  it('refuses a second recipient, a header in the subject and an unknown template id, in the api and in the database', async () => {
    const { mail } = service();
    for (const bad of [
      message({ to: 'sofia@hale.example, daniel@hale.example' }),
      message({ to: 'sofia@hale.example\r\nBcc: x@y.example' }),
      message({ subject: 'Hello\r\nBcc: x@y.example' }),
      message({ template: 'Bad Template' }),
    ]) {
      await expect(withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, bad))).rejects.toThrow();
    }
    // The database says no on its own too (the function is the only way in, and the table checks the shape).
    for (const [to, subject] of [
      ['a@hale.example,b@hale.example', 'Hi'],
      ['a@hale.example', 'Hi\nBcc: b@hale.example'],
    ]) {
      await expect(
        withUserTransaction(t.db, superId, (trx) =>
          sql`select public.kinship_mail_enqueue('test', ${to}, null, ${subject}, 'x', null, null)`.execute(trx),
        ),
      ).rejects.toThrow();
    }
    expect(await rows()).toEqual([]);
  });

  it('is refused when mail is not set up', async () => {
    const off = createMailService({ config: { provider: 'off' }, ownerDb: t.owner, log });
    expect(off.isConfigured()).toBe(false);
    await expect(withUserTransaction(t.db, superId, (trx) => off.enqueue(trx, message()))).rejects.toBeInstanceOf(
      MailNotConfigured,
    );
    // And it never sends or prunes anything.
    await off.job.run(T0);
    expect(await off.drain()).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
  });
});

describe('the app role', () => {
  it('cannot read, change or delete the outbox, whatever its role', async () => {
    const { mail } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    for (const who of [superId, memberId, null]) {
      await expect(
        withUserTransaction(t.db, who, (trx) => sql`select * from mail_outbox`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withUserTransaction(t.db, who, (trx) => sql`update mail_outbox set status = 'sent'`.execute(trx)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withUserTransaction(t.db, who, (trx) =>
          sql`insert into mail_outbox (template, to_address, subject, body_text) values ('test', 'a@hale.example', 's', 'b')`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('reads the status counts only as the SuperAdmin, and they hold no address, subject or body', async () => {
    const { mail } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    await expect(
      withUserTransaction(t.db, memberId, (trx) => sql`select public.kinship_mail_status()`.execute(trx)),
    ).rejects.toThrow(/only a SuperAdmin/);
    const status = await withUserTransaction(t.db, superId, (trx) =>
      sql<{ s: Record<string, unknown> }>`select public.kinship_mail_status() as s`.execute(trx),
    );
    const s = status.rows[0]!.s;
    expect(s).toMatchObject({ queued: 1, failedLastWeek: 0, lastFailure: null, lastTest: { status: 'queued' } });
    expect(JSON.stringify(s)).not.toMatch(/sofia|Hello|KinShip test email/);
  });
});

describe('sending', () => {
  it('sends a due message and clears its subject and body at once', async () => {
    const { mail, transport } = service();
    const id = await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    expect(await mail.drain(T0)).toEqual({ sent: 1, retried: 0, failed: 0, cancelled: 0 });
    expect(transport.sent).toEqual([
      {
        id,
        from: CONFIG.provider === 'resend' ? CONFIG.from : '',
        to: 'sofia@hale.example',
        subject: 'KinShip test email',
        text: 'Hello Sofia',
        html: '<p>Hello Sofia</p>',
      },
    ]);
    expect((await rows())[0]).toMatchObject({
      status: 'sent',
      attempts: 1,
      subject: null,
      body_text: null,
      body_html: null,
      provider_id: 'fake-1',
      last_error: null,
    });
    // Nothing is sent twice.
    expect(await mail.drain(at(60_000))).toEqual({ sent: 0, retried: 0, failed: 0, cancelled: 0 });
    // The log names the message and its kind, never the address, the subject or the body.
    expect(JSON.stringify(logs)).not.toMatch(/sofia|Hello|KinShip test email/);
  });

  it('follows the retry curve, keeps the cleaned error, and gives up after the last attempt', async () => {
    let now = T0;
    const { mail, transport } = service(() => now);
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    transport.failNext(
      ...Array.from({ length: MAX_ATTEMPTS }, () => temporary('Resend answered 503: re_testkey_1 down')),
    );
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await mail.drain(now);
      const [row] = await rows();
      expect(row?.attempts).toBe(attempt);
      // The key never reaches the stored error.
      expect(row?.last_error).toBe('Resend answered 503: [redacted] down');
      if (attempt < MAX_ATTEMPTS) {
        expect(result.retried).toBe(1);
        expect(row?.status).toBe('queued');
        const wait = RETRY_DELAYS_MS[attempt - 1]!;
        expect(row?.next_attempt_at.getTime()).toBe(now.getTime() + wait);
        // Not due a moment before the wait is over.
        expect((await mail.drain(new Date(now.getTime() + wait - 1000))).retried).toBe(0);
        now = new Date(now.getTime() + wait);
      } else {
        expect(result.failed).toBe(1);
        expect(row).toMatchObject({ status: 'failed', subject: null, body_text: null, body_html: null });
      }
    }
    expect(transport.sent).toEqual([]);
    expect(RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0)).toBe((60 + 300 + 900 + 3600 + 10_800 + 21_600) * 1000);
  });

  it('gives up at once on a permanent refusal', async () => {
    const { mail, transport } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    transport.failNext(permanent('SMTP EENVELOPE 550: <sofia@hale.example> mailbox unavailable'));
    expect(await mail.drain(T0)).toMatchObject({ failed: 1 });
    expect((await rows())[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'SMTP EENVELOPE 550: <…@hale.example> mailbox unavailable',
    });
  });

  it('cancels a message whose link expired instead of sending it late', async () => {
    const { mail, transport } = service();
    await withUserTransaction(t.db, superId, (trx) =>
      mail.enqueue(trx, message({ template: 'password_reset', expiresAt: at(60 * 60_000) })),
    );
    transport.failNext(temporary());
    await mail.drain(T0);
    // The retry would come after the link stopped working.
    expect(await mail.drain(at(2 * 60 * 60_000))).toMatchObject({ cancelled: 1, sent: 0 });
    expect((await rows())[0]).toMatchObject({ status: 'cancelled', body_text: null, subject: null });
    expect(transport.sent).toEqual([]);
  });

  it('lets two senders share the work without sending anything twice', async () => {
    const one = service();
    const two = service();
    await withUserTransaction(t.db, superId, async (trx) => {
      for (let i = 0; i < 25; i++) await one.mail.enqueue(trx, message({ to: `person${i}@hale.example` }));
    });
    const [a, b] = await Promise.all([one.mail.drain(T0), two.mail.drain(T0)]);
    expect(a.sent + b.sent).toBe(25);
    const sentTo = [...one.transport.sent, ...two.transport.sent].map((m) => m.to).sort();
    expect(new Set(sentTo).size).toBe(25);
    expect((await rows()).every((r) => r.status === 'sent' && r.attempts === 1)).toBe(true);
  });

  it('takes back a message from a sender that died, after the hold runs out', async () => {
    const { mail, transport } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    // A sender claimed it and died before answering.
    await sql`update mail_outbox set status = 'sending', attempts = 1, locked_until = ${at(HOLD_MS)}`.execute(t.owner);
    expect(await mail.drain(at(HOLD_MS - 1000))).toMatchObject({ sent: 0 });
    expect(await mail.drain(at(HOLD_MS + 1000))).toMatchObject({ sent: 1 });
    expect(transport.sent).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('gives up a message a dead sender held on its last attempt', async () => {
    const { mail, transport } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    await sql`update mail_outbox set status = 'sending', attempts = ${MAX_ATTEMPTS}, locked_until = ${T0}`.execute(
      t.owner,
    );
    expect(await mail.drain(at(1000))).toMatchObject({ failed: 1, sent: 0 });
    expect(transport.sent).toEqual([]);
    expect((await rows())[0]).toMatchObject({ status: 'failed', body_text: null });
  });

  it('sends nothing while paused (a restore), and again after resume', async () => {
    const { mail, transport } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    mail.pause();
    mail.kick();
    await mail.idle();
    expect(await mail.drain(T0)).toMatchObject({ sent: 0 });
    mail.resume();
    mail.kick();
    await mail.idle();
    expect(transport.sent).toHaveLength(1);
  });

  it('a kick sends what is queued without waiting for the job tick', async () => {
    const { mail, transport } = service(() => new Date());
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    mail.kick();
    mail.kick();
    await mail.idle();
    expect(transport.sent).toHaveLength(1);
  });
});

describe('keeping and pruning', () => {
  it('deletes finished rows after 30 days and keeps the rest', async () => {
    const { mail } = service();
    await withUserTransaction(t.db, superId, async (trx) => {
      await mail.enqueue(trx, message({ to: 'old@hale.example' }));
      await mail.enqueue(trx, message({ to: 'new@hale.example' }));
      await mail.enqueue(trx, message({ to: 'waiting@hale.example' }));
    });
    await mail.drain(T0);
    const finished = (await rows()).map((r) => r.id);
    await sql`update mail_outbox set finished_at = ${at(-(KEEP_FINISHED_DAYS + 1) * 86_400_000)} where id = ${finished[0]}`.execute(
      t.owner,
    );
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message({ to: 'later@hale.example' })));
    expect(await mail.prune(T0)).toBe(1);
    expect((await rows()).map((r) => r.id)).not.toContain(finished[0]);
    expect(await rows()).toHaveLength(3);
  });

  it('the database refuses a finished row that still has its content', async () => {
    const { mail } = service();
    await withUserTransaction(t.db, superId, (trx) => mail.enqueue(trx, message()));
    await expect(sql`update mail_outbox set status = 'sent', finished_at = now()`.execute(t.owner)).rejects.toThrow(
      /mail_outbox_content/,
    );
  });
});
