// SPDX-License-Identifier: AGPL-3.0-or-later
import { BACKUP_SETTING_KEYS, DEFAULT_BACKUP_SETTINGS, SAFETY_COPY_KEY, backupSettingValueOk } from '@kinship/shared';
import type { BackupSettings } from '@kinship/shared';
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';

/**
 * The backup settings, with the defaults for anything not set (or set to something the parsers would refuse). Reads
 * app_settings, so call it with the owner connection (the scheduler) or inside a SuperAdmin's request transaction.
 */
export async function readBackupSettings(db: QueryExecutorProvider): Promise<BackupSettings> {
  const keys = Object.values(BACKUP_SETTING_KEYS);
  const rows = await sql<{
    key: string;
    value: unknown;
  }>`select key, value from app_settings where key = any(${keys})`.execute(db);
  const byKey = new Map(rows.rows.map((row) => [row.key, row.value]));
  const settings: BackupSettings = { ...DEFAULT_BACKUP_SETTINGS };
  for (const name of Object.keys(BACKUP_SETTING_KEYS) as Array<keyof BackupSettings>) {
    const value = byKey.get(BACKUP_SETTING_KEYS[name]);
    if (value !== undefined && backupSettingValueOk(name, value))
      (settings as unknown as Record<string, unknown>)[name] = value;
  }
  return settings;
}

/**
 * The safety copy switch (on by default). Safe on a database that has not been migrated to 0013 yet: no table means "on".
 */
export async function readSafetyCopySetting(db: QueryExecutorProvider): Promise<boolean> {
  const present = await sql<{
    present: boolean;
  }>`select to_regclass('public.app_settings') is not null as present`.execute(db);
  if (!present.rows[0]?.present) return true;
  const row = await sql<{ value: unknown }>`select value from app_settings where key = ${SAFETY_COPY_KEY}`.execute(db);
  const value = row.rows[0]?.value;
  return typeof value === 'boolean' ? value : true;
}

/** Saves some backup settings (the keys come from the allow-list, the values were checked by parseBackupSettings). */
export async function writeBackupSettings(
  db: QueryExecutorProvider,
  patch: Partial<BackupSettings>,
  userId: string | null,
): Promise<void> {
  for (const [name, value] of Object.entries(patch)) {
    const key = BACKUP_SETTING_KEYS[name as keyof BackupSettings];
    await sql`
      insert into app_settings (key, value, updated_by) values (${key}, ${JSON.stringify(value)}::jsonb, ${userId})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`.execute(
      db,
    );
  }
}
