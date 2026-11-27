// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Queue a templated email (ADR 0041, 53b): read the family's overrides in the caller's transaction, render, and put the
// result in the outbox. Step 54 calls `enqueueTemplate(trx, …)` inside the transaction that creates the invitation or reset,
// then `mail.kick()` after it commits.
//
// The overrides are readable by any signed-in user (row-level security), so this works as the app role for whoever's
// request it is. The stored text is checked again here: a field the current code no longer has is ignored.
import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';
import type { MailTemplateId } from '@kinship/shared';
import type { Database } from '../db.js';
import type { MailService } from './outbox.js';
import { render } from './render.js';
import type { RenderedMail } from './render.js';
import { TEMPLATES, templateDef } from './templates/index.js';
import type { TemplateParams } from './templates/index.js';

type Db = Kysely<Database> | Transaction<Database>;

/** The saved overrides of one template: key -> text ("subject" included). Empty when there are none. */
export async function loadOverrides(db: Db, id: MailTemplateId): Promise<Record<string, string>> {
  const result = await sql<{ subject: string | null; blocks: Record<string, unknown> }>`
    select subject, blocks from mail_template_overrides where template = ${id}`.execute(db);
  const row = result.rows[0];
  if (!row) return {};
  const keys = new Set(templateDef(id).fields.map((field) => field.key));
  const out: Record<string, string> = {};
  if (row.subject !== null) out.subject = row.subject;
  for (const [key, value] of Object.entries(row.blocks ?? {})) {
    if (key !== 'subject' && keys.has(key) && typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Renders a template with the saved overrides. */
export async function renderSaved<K extends MailTemplateId>(
  db: Db,
  id: K,
  params: TemplateParams[K],
  publicUrl: string,
): Promise<RenderedMail> {
  return render(TEMPLATES[id], params, await loadOverrides(db, id), publicUrl);
}

export interface TemplatedMail<K extends MailTemplateId> {
  template: K;
  to: string;
  toUserId: string | null;
  params: TemplateParams[K];
  /** When the link inside stops working: the message is cancelled rather than sent after this. */
  expiresAt?: Date | null;
}

/** Renders with the overrides and queues the message in the caller's transaction. Returns the outbox id. */
export async function enqueueTemplate<K extends MailTemplateId>(
  db: Db,
  mail: MailService,
  publicUrl: string,
  message: TemplatedMail<K>,
): Promise<string> {
  const rendered = await renderSaved(db, message.template, message.params, publicUrl);
  return mail.enqueue(db, {
    template: message.template,
    to: message.to,
    toUserId: message.toUserId,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    expiresAt: message.expiresAt ?? null,
  });
}
