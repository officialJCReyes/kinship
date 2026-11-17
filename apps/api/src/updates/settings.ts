// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_UPDATE_SETTINGS, UPDATE_SETTING_KEYS } from '@kinship/shared';
import type { UpdateSettings } from '@kinship/shared';
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';

/**
 * The three switches, with the defaults for anything not set (or set to something that is not true or false). Reads
 * app_settings, so call it with the owner connection (the scheduled check) or inside a SuperAdmin's request transaction.
 * Safe on a database without app_settings: no table means the defaults.
 */
export async function readUpdateSettings(db: QueryExecutorProvider): Promise<UpdateSettings> {
  const present = await sql<{ p: boolean }>`select to_regclass('public.app_settings') is not null as p`.execute(db);
  if (!present.rows[0]?.p) return { ...DEFAULT_UPDATE_SETTINGS };
  const keys = Object.values(UPDATE_SETTING_KEYS);
  const rows = await sql<{
    key: string;
    value: unknown;
  }>`select key, value from app_settings where key = any(${keys})`.execute(db);
  const byKey = new Map(rows.rows.map((row) => [row.key, row.value]));
  const settings: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS };
  for (const name of Object.keys(UPDATE_SETTING_KEYS) as Array<keyof UpdateSettings>) {
    const value = byKey.get(UPDATE_SETTING_KEYS[name]);
    if (typeof value === 'boolean') settings[name] = value;
  }
  return settings;
}

/** Saves some of the switches (the keys come from the allow-list, the values were checked by parseUpdateSettings). */
export async function writeUpdateSettings(
  db: QueryExecutorProvider,
  patch: Partial<UpdateSettings>,
  userId: string | null,
): Promise<void> {
  for (const [name, value] of Object.entries(patch)) {
    const key = UPDATE_SETTING_KEYS[name as keyof UpdateSettings];
    await sql`
      insert into app_settings (key, value, updated_by) values (${key}, ${JSON.stringify(value)}::jsonb, ${userId})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`.execute(
      db,
    );
  }
}
