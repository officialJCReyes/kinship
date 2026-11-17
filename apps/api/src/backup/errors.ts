// SPDX-License-Identifier: AGPL-3.0-or-later
export type BackupErrorKind =
  | 'passphrase' // none, too short, or the placeholder
  | 'dir_not_writable'
  | 'owner_cannot_read_all' // the owner role would miss rows under row-level security
  | 'busy' // a backup or restore is already running
  | 'disk_space'
  | 'tool' // pg_dump, tar or another tool failed
  | 'archive' // the archive is not good (see the message)
  | 'manifest';

/** A problem with a backup that a person can act on. The message is safe to show: it never contains a secret. */
export class BackupError extends Error {
  override name = 'BackupError';
  constructor(
    readonly kind: BackupErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
