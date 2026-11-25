// SPDX-License-Identifier: AGPL-3.0-or-later
import { Kysely, PostgresDialect } from 'kysely';
import type { ColumnType, Generated } from 'kysely';
import pg from 'pg';
import type { DatePrecision, UnionStatus } from '@kinship/shared';
import type { DbConfig } from './config.js';

/**
 * Tables as the app role sees them. Hand-written for now; generating these
 * from the real schema is planned (ADR 0001) once there are more tables.
 */
/**
 * For code that works with tables it has no types for (the migration runner,
 * test setup). Kysely's own migration API is typed this way.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySchema = any;
export type UntypedDb = Kysely<AnySchema>;

type DatePrecisionCode = DatePrecision;
type UnionStatusCode = UnionStatus;

export interface Database {
  schema_info: {
    id: boolean;
    schema_number: number;
    /** The version of the app that last started (0013). */
    app_version: string | null;
    updated_at: Date;
  };
  /** Not secret settings, SuperAdmin only (0013). */
  app_settings: {
    key: string;
    value: unknown;
    updated_by: string | null;
    updated_at: Generated<Date>;
  };
  /** One row per database change or restore. Admins read it; only the owner writes it (0013). */
  upgrade_log: {
    id: Generated<string>;
    event: 'migrate' | 'restore';
    from_schema: number | null;
    to_schema: number;
    from_version: string | null;
    to_version: string;
    safety_copy: string | null;
    safety_note: string | null;
    /** For a restore: the version of the backup that was restored (0014). from_version is the version running before. */
    backup_version: string | null;
    created_at: ColumnType<Date, never, never>;
  };
  /** The state of the daily update check: one row, SuperAdmin reads, the owner writes (0014). */
  update_check: {
    id: boolean;
    status: 'never' | 'ok' | 'unchanged' | 'offline' | 'rate_limited' | 'bad_response';
    last_attempt_at: Date | null;
    last_success_at: Date | null;
    next_check_at: Date | null;
    failures: number;
    etag: string | null;
    releases: unknown;
    updated_at: Date;
  };
  /** The app role can read these columns, and only the signed-in person's own row (row-level security). */
  users: {
    id: string;
    email: string;
    display_name: string;
    role: 'superadmin' | 'familyadmin' | 'member' | 'user';
    /** The person this account is linked to (0005). */
    person_id: string | null;
    /** Which family this account's charts follow for an adopted person (0006). */
    lineage_view: Generated<'adoptive' | 'birth'>;
    /** This account's own display settings (0010). They change nothing for anyone else. */
    color_scheme: Generated<'forest' | 'sand' | 'slate' | 'graphite'>;
    theme: Generated<'device' | 'light' | 'dark'>;
    date_format: Generated<'mdy' | 'dmy' | 'dmy2' | 'long' | 'iso' | 'us' | 'eu'>;
    /** How a married woman's name is shown, and whether prefixes and suffixes show (0017). */
    name_form: Generated<'maiden_married' | 'married_born' | 'married' | 'maiden'>;
    show_prefix: Generated<boolean>;
    show_suffix: Generated<boolean>;
    /** The chart's own settings (0018). */
    tree_wheel: Generated<'zoom' | 'scroll'>;
    tree_default_view: Generated<'family' | 'pedigree' | 'fan' | 'descendants'>;
    show_extended_relatives: Generated<boolean>;
    show_deceased_mark: Generated<boolean>;
    /** The first day of the week in the date picker (0020). */
    week_start: Generated<'sunday' | 'monday' | 'saturday'>;
    /** When the account last signed in, and how its password last changed (0011). null: unknown (older than 0011). */
    last_sign_in_at: Date | null;
    password_changed_at: Date | null;
    password_changed_via: 'setup' | 'self' | 'admin_link' | 'cli' | 'invitation' | null;
    /** Null while the account is active (migration 0019). Set by kinship_auth.disable_account only. */
    disabled_at: Date | null;
    /** What this account last saw of What's new, and the SuperAdmin's banner and backup ticks per version (0014). */
    last_seen_version: string | null;
    last_seen_at: Date | null;
    update_dismissed_version: string | null;
    update_backup_ack_version: string | null;
    created_at: Date;
    updated_at: Date;
  };
  people: {
    id: Generated<string>;
    given_name: string;
    surname: string;
    /** The second (maternal) surname, optional (0007). */
    second_surname: string | null;
    /** The surname taken at marriage, optional (0007). */
    married_surname: string | null;
    /** Dr., Sir; Jr., II; a nickname (0017). All optional. */
    name_prefix: string | null;
    name_suffix: string | null;
    nickname: string | null;
    gender: 'male' | 'female' | 'other' | null;
    /** As typed: YYYY, YYYY-MM or YYYY-MM-DD. The generated *_from and *_to columns exist but are only used in SQL. */
    birth_date: string | null;
    birth_precision: Generated<DatePrecisionCode>;
    deceased: Generated<boolean>;
    death_date: string | null;
    death_precision: Generated<DatePrecisionCode>;
    /** True for an "Unknown father/mother" stand-in (0015): no name, no dates. Naming it clears the flag. */
    is_placeholder: Generated<boolean>;
    /** Search text over every part of the name (0007, rebuilt by 0017). The old search_name was dropped by 0023. */
    search_names: ColumnType<string, never, never>;
    /** The profile photo (0021): a media_files row linked to this person, or null. */
    photo_media_id: string | null;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, never, never>;
  };
  /** An uploaded photo (0021). The bytes are encrypted files on the files volume, named by storage_id and avatar_storage_id. */
  media_files: {
    id: Generated<string>;
    storage_id: string;
    avatar_storage_id: string;
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    size: number | string;
    avatar_size: number | string;
    width: number;
    height: number;
    /** The date taken, as typed: YYYY, YYYY-MM or YYYY-MM-DD, or null. */
    taken_on: string | null;
    key_id: string;
    uploaded_by: string | null;
    created_at: ColumnType<Date, never, never>;
  };
  /** Which people a photo shows (0021). */
  media_people: {
    media_id: string;
    person_id: string;
  };
  unions: {
    id: Generated<string>;
    partner_a_id: string;
    partner_b_id: string;
    status: UnionStatusCode;
    start_date: string | null;
    start_precision: Generated<DatePrecisionCode>;
    end_date: string | null;
    end_precision: Generated<DatePrecisionCode>;
    /** True when the database set Widowed itself (0007). Only the triggers write it. */
    status_auto: ColumnType<boolean, never, never>;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
    updated_at: ColumnType<Date, never, never>;
  };
  relationship_labels: {
    id: Generated<string>;
    from_id: string;
    to_id: string;
    label: string;
    reverse_label: string | null;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
  };
  person_parents: {
    child_id: string;
    /** Birth or adoptive (0006). A child has at most one set of each kind. */
    kind: Generated<'birth' | 'adoptive'>;
    union_id: string | null;
    parent_id: string | null;
    link_date: string | null;
    link_precision: Generated<DatePrecisionCode>;
    created_by: string | null;
    created_at: ColumnType<Date, never, never>;
  };
  /** Readable only when someone is signed in. */
  family_tree: {
    name: string;
    created_at: Date;
  };
}

/**
 * A Kysely instance connected as one of the two roles.
 *
 * An idle pooled connection can be dropped by the server (a Postgres restart,
 * a network blip). `pg` reports that as an "error" event on the pool, and an
 * unhandled one would crash the process. We log it instead; the pool discards
 * the dead connection and opens a new one when needed.
 *
 * `onNotice` receives the text of every NOTICE the server sends on these connections (a migration's RAISE NOTICE, for
 * example 0024 naming the rows it left alone). Without it notices are dropped, as before.
 */
export function createDb<T = Database>(
  db: Pick<DbConfig, 'host' | 'port' | 'name'>,
  user: string,
  password: string,
  max = 10,
  onNotice?: (message: string) => void,
): Kysely<T> {
  const pool = new pg.Pool({ host: db.host, port: db.port, database: db.name, user, password, max });
  pool.on('error', (error) => {
    console.error(
      JSON.stringify({ level: 'warn', time: Date.now(), msg: 'idle database connection dropped', err: error.message }),
    );
  });
  if (onNotice) {
    pool.on('connect', (client) => {
      client.on('notice', (notice) => onNotice(notice.message ?? ''));
    });
  }
  return new Kysely<T>({ dialect: new PostgresDialect({ pool }) });
}

/** Owner role: migrations and role setup only. Never used for requests. */
export function createOwnerDb(db: DbConfig): UntypedDb {
  return createDb<AnySchema>(db, db.ownerUser, db.ownerPassword, 2);
}

/** App role (not the owner, no BYPASSRLS): every request runs as this. */
export function createAppDb(db: DbConfig): Kysely<Database> {
  return createDb<Database>(db, db.appUser, db.appPassword);
}
