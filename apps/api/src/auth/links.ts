// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Role } from '@kinship/shared';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db.js';

/**
 * Invitations and set-password links (migration 0011). The app role has no access to the account_links table;
 * everything goes through the SECURITY DEFINER functions in kinship_auth. The admin functions check who is asking
 * themselves, so they must run inside a user transaction (request.withTransaction). The public ones do not.
 */
type Db = Kysely<Database> | Transaction<Database>;

export interface Created {
  id: string;
  expiresAt: Date;
}

export async function createInvitation(
  trx: Db,
  input: { email: string; role: Role; personId: string | null; note: string | null; tokenHash: string },
): Promise<Created> {
  const result = await sql<{ id: string; expires_at: Date }>`
    select id, expires_at from kinship_auth.create_invitation(
      ${input.email}, ${input.role}, ${input.personId}::uuid, ${input.note}, ${input.tokenHash})`.execute(trx);
  const row = result.rows[0];
  if (!row) throw new Error('create_invitation returned nothing');
  return { id: row.id, expiresAt: row.expires_at };
}

export async function createResetLink(trx: Db, userId: string, tokenHash: string): Promise<Created> {
  const result = await sql<{ id: string; expires_at: Date }>`
    select id, expires_at from kinship_auth.create_reset_link(${userId}::uuid, ${tokenHash})`.execute(trx);
  const row = result.rows[0];
  if (!row) throw new Error('create_reset_link returned nothing');
  return { id: row.id, expiresAt: row.expires_at };
}

export async function regenerateLink(
  trx: Db,
  linkId: string,
  tokenHash: string,
): Promise<Created & { kind: 'invite' | 'reset' }> {
  const result = await sql<{ id: string; expires_at: Date; kind: 'invite' | 'reset' }>`
    select id, expires_at, kind from kinship_auth.regenerate_link(${linkId}::uuid, ${tokenHash})`.execute(trx);
  const row = result.rows[0];
  if (!row) throw new Error('regenerate_link returned nothing');
  return { id: row.id, expiresAt: row.expires_at, kind: row.kind };
}

export async function revokeLink(trx: Db, linkId: string): Promise<void> {
  await sql`select kinship_auth.revoke_link(${linkId}::uuid)`.execute(trx);
}

export interface OpenLinkRow {
  id: string;
  kind: 'invite' | 'reset';
  email: string | null;
  role: Role;
  person_id: string | null;
  note: string | null;
  user_id: string | null;
  created_at: Date;
  expires_at: Date;
  expired: boolean;
  created_by: string | null;
  created_by_name: string | null;
  can_manage: boolean;
}

export async function listOpenLinks(trx: Db): Promise<OpenLinkRow[]> {
  return (await sql<OpenLinkRow>`select * from kinship_auth.list_open_links()`.execute(trx)).rows;
}

export async function listInviters(trx: Db): Promise<Map<string, string | null>> {
  const result = await sql<{ user_id: string; invited_by_name: string | null }>`
    select user_id, invited_by_name from kinship_auth.list_inviters()`.execute(trx);
  return new Map(result.rows.map((row) => [row.user_id, row.invited_by_name]));
}

export type LinkRow =
  | {
      kind: 'invite';
      treeName: string | null;
      email: string;
      role: Role;
      personName: string | null;
      note: string | null;
      invitedBy: string | null;
      expiresAt: Date;
    }
  | { kind: 'reset'; treeName: string | null; displayName: string; expiresAt: Date };

/** What a link is, if it is still open. One indexed lookup; any bad link gives undefined. */
export async function lookupLink(db: Db, tokenHash: string): Promise<LinkRow | undefined> {
  const result = await sql<{
    kind: 'invite' | 'reset';
    tree_name: string | null;
    email: string | null;
    role: Role | null;
    person_given_name: string | null;
    person_surname: string | null;
    note: string | null;
    invited_by_name: string | null;
    display_name: string | null;
    expires_at: Date;
  }>`select * from kinship_auth.lookup_link(${tokenHash})`.execute(db);
  const row = result.rows[0];
  if (!row) return undefined;
  if (row.kind === 'reset') {
    return { kind: 'reset', treeName: row.tree_name, displayName: row.display_name ?? '', expiresAt: row.expires_at };
  }
  const personName =
    row.person_given_name === null ? null : `${row.person_given_name} ${row.person_surname ?? ''}`.trim();
  return {
    kind: 'invite',
    treeName: row.tree_name,
    email: row.email ?? '',
    role: row.role ?? 'user',
    personName,
    note: row.note,
    invitedBy: row.invited_by_name,
    expiresAt: row.expires_at,
  };
}

export async function acceptInvitation(
  db: Db,
  input: { tokenHash: string; displayName: string | null; passwordHash: string },
): Promise<string> {
  const result = await sql<{ id: string }>`
    select kinship_auth.accept_invitation(${input.tokenHash}, ${input.displayName}, ${input.passwordHash}) as id`.execute(
    db,
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error('accept_invitation returned nothing');
  return id;
}

export async function acceptReset(db: Db, tokenHash: string, passwordHash: string): Promise<string> {
  const result = await sql<{ id: string }>`
    select kinship_auth.accept_reset(${tokenHash}, ${passwordHash}) as id`.execute(db);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('accept_reset returned nothing');
  return id;
}
