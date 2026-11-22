// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Keeps apps/api and packages/shared from drifting apart:
//  * the API registers exactly the people routes the shared package lists,
//  * every error code has an English message,
//  * the hand-written database types match the real tables.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  BACKUP_ERROR_CODES,
  BACKUP_ROUTES,
  en,
  PEOPLE_ERROR_CODES,
  PEOPLE_ROUTES,
  WARNING_CODES,
} from '@kinship/shared';
import type { Database } from '../src/db.js';
import { createTestApp } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

let t: TestApp;
const registered: string[] = [];

beforeAll(async () => {
  t = await createTestApp({}, (app) => {
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) registered.push(`${method} ${route.url}`);
    });
  });
});
afterAll(() => t.close());

describe('routes', () => {
  it('registers exactly the people, relationship and tree routes the shared package lists', () => {
    const mine = registered
      .filter((r) => /^\w+ \/api\/(people|unions|labels|tree|relationship)/.test(r) && !r.startsWith('HEAD '))
      .sort();
    const declared = PEOPLE_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
    expect(mine).toEqual(declared);
  });

  it('registers exactly the backup routes the shared package lists', () => {
    const mine = registered.filter((r) => /^\w+ \/api\/admin\/backups/.test(r) && !r.startsWith('HEAD ')).sort();
    expect(mine).toEqual(BACKUP_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  });

  it('lists every route once', () => {
    const keys = PEOPLE_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('error codes and messages', () => {
  it('has an English message for every people error code and every warning', () => {
    for (const code of PEOPLE_ERROR_CODES) expect(en, code).toHaveProperty(`error.${code}`);
    for (const code of BACKUP_ERROR_CODES) expect(en, code).toHaveProperty(`error.${code}`);
    for (const code of WARNING_CODES) expect(en, code).toHaveProperty(`warning.${code}`);
  });

  it('has no error code twice', () => {
    expect(new Set(API_ERROR_CODES).size).toBe(API_ERROR_CODES.length);
  });

  it('only ever answers a request the API cannot handle with a declared code', async () => {
    for (const [method, url] of [
      ['GET', '/api/people'],
      ['POST', '/api/people'],
      ['PATCH', '/api/unions/x'],
    ] as const) {
      const response = await t.app.inject({ method, url, headers: { 'x-kinship-request': '1' } });
      expect(API_ERROR_CODES as readonly string[]).toContain((response.json() as { error: string }).error);
    }
  });
});

// The Database interface in src/db.ts is written by hand. These lists must name every column of it
// (a compile error otherwise) and must match the real tables (a test failure otherwise).
const peopleColumns = [
  'id',
  'given_name',
  'surname',
  'second_surname',
  'married_surname',
  'name_prefix',
  'name_suffix',
  'nickname',
  'surname_particle',
  'gender',
  'birth_date',
  'birth_precision',
  'deceased',
  'death_date',
  'death_precision',
  'is_placeholder',
  'search_name',
  'search_names',
  'created_by',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof Database['people']>;
const unionColumns = [
  'id',
  'partner_a_id',
  'partner_b_id',
  'status',
  'start_date',
  'start_precision',
  'end_date',
  'end_precision',
  'status_auto',
  'created_by',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof Database['unions']>;
const parentColumns = [
  'child_id',
  'kind',
  'union_id',
  'parent_id',
  'link_date',
  'link_precision',
  'created_by',
  'created_at',
] as const satisfies ReadonlyArray<keyof Database['person_parents']>;
const userColumns = [
  'id',
  'email',
  'display_name',
  'role',
  'person_id',
  'lineage_view',
  'color_scheme',
  'theme',
  'date_format',
  'disabled_at',
  'surname_choice',
  'name_form',
  'show_prefix',
  'show_suffix',
  'tree_wheel',
  'tree_default_view',
  'show_extended_relatives',
  'show_deceased_mark',
  'week_start',
  'last_sign_in_at',
  'password_changed_at',
  'password_changed_via',
  'last_seen_version',
  'last_seen_at',
  'update_dismissed_version',
  'update_backup_ack_version',
  'created_at',
  'updated_at',
] as const satisfies ReadonlyArray<keyof Database['users']>;
type Missing<T, L extends readonly string[]> = Exclude<keyof T, L[number]>;
const complete: [
  Missing<Database['people'], typeof peopleColumns>,
  Missing<Database['unions'], typeof unionColumns>,
  Missing<Database['person_parents'], typeof parentColumns>,
  Missing<Database['users'], typeof userColumns>,
] extends [never, never, never, never]
  ? true
  : false = true;

describe('database types', () => {
  const columnsOf = async (table: string) =>
    (
      await sql<{ column_name: string }>`
        select column_name from information_schema.columns
         where table_schema = 'public' and table_name = ${table} and column_name <> 'password_hash'
           and not (is_generated = 'ALWAYS' and column_name not in ('search_name', 'search_names'))
         order by column_name`.execute(t.owner)
    ).rows.map((r) => r.column_name);

  it('name every column of every table the API reads or writes', async () => {
    expect(complete).toBe(true);
    expect(await columnsOf('people')).toEqual([...peopleColumns].sort());
    expect(await columnsOf('unions')).toEqual([...unionColumns].sort());
    expect(await columnsOf('person_parents')).toEqual([...parentColumns].sort());
    expect(await columnsOf('users')).toEqual([...userColumns].sort());
  });
});
