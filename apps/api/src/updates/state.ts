// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The state of the update check (table update_check, one row). The scheduled job and the Check now route write it as the OWNER
// role (ADR 0014: maintenance jobs); a SuperAdmin's request reads it as the app role under row-level security.
import { UPDATE_CHECK_STATUSES } from '@kinship/shared';
import type { KnownRelease, UpdateCheckStatus } from '@kinship/shared';
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';

/** A release as stored: what the app shows, plus what the next check needs to decide whether to read its manifest again. */
export interface StoredRelease extends KnownRelease {
  /** GitHub's own "updated_at" of the release; a changed value means the manifest is read again. */
  githubUpdatedAt: string;
  /** The release has a release-manifest.json asset (so a failed read is tried again at the next check). */
  hasManifest?: boolean;
}

export interface CheckState {
  status: UpdateCheckStatus;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  nextCheckAt: Date | null;
  failures: number;
  etag: string | null;
  releases: StoredRelease[];
}

const isStatus = (value: string): value is UpdateCheckStatus =>
  (UPDATE_CHECK_STATUSES as readonly string[]).includes(value);

function storedReleases(value: unknown): StoredRelease[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is StoredRelease =>
      typeof r === 'object' &&
      r !== null &&
      typeof (r as StoredRelease).version === 'string' &&
      typeof (r as StoredRelease).notes === 'string',
  );
}

/** The state of the check; an empty "never checked" state when the row or the table is missing. */
export async function readCheckState(db: QueryExecutorProvider): Promise<CheckState> {
  const empty: CheckState = {
    status: 'never',
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextCheckAt: null,
    failures: 0,
    etag: null,
    releases: [],
  };
  const present = await sql<{ p: boolean }>`select to_regclass('public.update_check') is not null as p`.execute(db);
  if (!present.rows[0]?.p) return empty;
  const result = await sql<{
    status: string;
    last_attempt_at: Date | null;
    last_success_at: Date | null;
    next_check_at: Date | null;
    failures: number;
    etag: string | null;
    releases: unknown;
  }>`select status, last_attempt_at, last_success_at, next_check_at, failures, etag, releases from update_check`.execute(
    db,
  );
  const row = result.rows[0];
  if (!row) return empty;
  return {
    status: isStatus(row.status) ? row.status : 'never',
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    nextCheckAt: row.next_check_at,
    failures: row.failures,
    etag: row.etag,
    releases: storedReleases(row.releases),
  };
}

/** Saves the whole state (owner connection). */
export async function writeCheckState(db: QueryExecutorProvider, state: CheckState): Promise<void> {
  await sql`
    update update_check set
      status = ${state.status},
      last_attempt_at = ${state.lastAttemptAt},
      last_success_at = ${state.lastSuccessAt},
      next_check_at = ${state.nextCheckAt},
      failures = ${state.failures},
      etag = ${state.etag},
      releases = ${JSON.stringify(state.releases)}::jsonb,
      updated_at = now()`.execute(db);
}
