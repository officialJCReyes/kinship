// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AuthUser, Role } from '@kinship/shared';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../db.js';

/**
 * Everything the API does with accounts before anyone is signed in goes
 * through the SECURITY DEFINER functions in schema kinship_auth (migration
 * 0002). The app role cannot read password hashes or sessions directly.
 */

export type { Role };
export type SessionUser = AuthUser;

export interface ResolvedSession {
  user: SessionUser;
  expiresAt: Date;
  renewed: boolean;
}

/** SQLSTATEs raised by kinship_auth.complete_setup. */
export const SETUP_ALREADY_DONE = 'KS001';
export const SETUP_INVALID_TOKEN = 'KS002';

export async function needsSetup(db: Kysely<Database>): Promise<boolean> {
  const result = await sql<{ needs: boolean }>`select kinship_auth.needs_setup() as needs`.execute(db);
  return result.rows[0]?.needs === true;
}

export async function setSetupToken(db: Kysely<Database>, tokenHash: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`select kinship_auth.set_setup_token(${tokenHash}) as ok`.execute(db);
  return result.rows[0]?.ok === true;
}

export async function checkSetupToken(db: Kysely<Database>, tokenHash: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`select kinship_auth.check_setup_token(${tokenHash}) as ok`.execute(db);
  return result.rows[0]?.ok === true;
}

export async function completeSetup(
  db: Kysely<Database>,
  input: { tokenHash: string; email: string; displayName: string; passwordHash: string; treeName: string },
): Promise<string> {
  const result = await sql<{ id: string }>`
    select kinship_auth.complete_setup(
      ${input.tokenHash}, ${input.email}, ${input.displayName}, ${input.passwordHash}, ${input.treeName}
    ) as id`.execute(db);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('complete_setup returned no user');
  return id;
}

export async function findLogin(
  db: Kysely<Database>,
  email: string,
): Promise<{ userId: string; passwordHash: string } | undefined> {
  const result = await sql<{ user_id: string; password_hash: string }>`
    select user_id, password_hash from kinship_auth.find_login(${email})`.execute(db);
  const row = result.rows[0];
  return row ? { userId: row.user_id, passwordHash: row.password_hash } : undefined;
}

export async function updatePasswordHash(db: Kysely<Database>, userId: string, passwordHash: string): Promise<void> {
  await sql`select kinship_auth.update_password_hash(${userId}, ${passwordHash})`.execute(db);
}

export async function createSession(
  db: Kysely<Database>,
  input: { userId: string; tokenHash: string; idleSeconds: number; maxSeconds: number },
): Promise<Date> {
  const result = await sql<{ expires_at: Date }>`
    select expires_at from kinship_auth.create_session(
      ${input.userId}, ${input.tokenHash}, ${input.idleSeconds}, ${input.maxSeconds})`.execute(db);
  const row = result.rows[0];
  if (!row) throw new Error('create_session returned nothing');
  return row.expires_at;
}

export async function resolveSession(
  db: Kysely<Database>,
  tokenHash: string,
  idleSeconds: number,
): Promise<ResolvedSession | undefined> {
  const result = await sql<{
    user_id: string;
    email: string;
    display_name: string;
    role: Role;
    expires_at: Date;
    renewed: boolean;
  }>`select * from kinship_auth.resolve_session(${tokenHash}, ${idleSeconds})`.execute(db);
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    user: { id: row.user_id, email: row.email, displayName: row.display_name, role: row.role },
    expiresAt: row.expires_at,
    renewed: row.renewed,
  };
}

export async function deleteSession(db: Kysely<Database>, tokenHash: string): Promise<void> {
  await sql`select kinship_auth.delete_session(${tokenHash})`.execute(db);
}

export async function deleteExpiredSessions(db: Kysely<Database>): Promise<number> {
  const result = await sql<{ n: number }>`select kinship_auth.delete_expired_sessions() as n`.execute(db);
  return result.rows[0]?.n ?? 0;
}
