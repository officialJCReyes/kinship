// SPDX-License-Identifier: AGPL-3.0-or-later
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createAppDb } from '../src/db.js';
import { ensureAppRole } from '../src/migrations/roles.js';
import { runMigrations } from '../src/migrations/runner.js';
import { buildFamily } from './helpers/family.js';
import type { Family } from './helpers/family.js';
import { createTestDatabase } from './helpers/db.js';
import type { TestDatabase } from './helpers/db.js';
import { realMigrationsDir, removeMigrationsFrom, tempMigrationsDir } from './helpers/migrations-dir.js';

const hex = (n: number) => n.toString(16).padStart(32, '0');
let counter = 1;
const ids = () => ({ storage: hex(counter++), avatar: hex(counter++) });

describe('migration 0021 on a populated database (migrations 0001 to 0020 with the Hale family)', () => {
  it('adds the photo tables and changes no existing row', async () => {
    const test = await createTestDatabase();
    const dir = await tempMigrationsDir(true);
    try {
      await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
      await removeMigrationsFrom(dir.dir, 21);
      const before = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(before.applied.at(-1)).toBe('0020_week_start');
      await buildFamily(test.owner);
      const snapshot = async () => ({
        users: (await sql`select * from users order by id`.execute(test.owner)).rows,
        people: (
          await sql`select id, given_name, surname, birth_date, deceased, created_by from people order by id`.execute(
            test.owner,
          )
        ).rows,
        unions: (await sql`select * from unions order by id`.execute(test.owner)).rows,
        parents: (await sql`select * from person_parents order by child_id, kind`.execute(test.owner)).rows,
      });
      const beforeData = await snapshot();

      await cp(join(realMigrationsDir, '0021_media_files.sql'), join(dir.dir, '0021_media_files.sql'));
      const result = await runMigrations(test.owner, { dir: dir.dir, appRole: test.config.appUser });
      expect(result.applied).toEqual(['0021_media_files']);
      expect(await snapshot()).toEqual(beforeData);

      const photos = await sql<{
        n: string;
      }>`select count(*) as n from people where photo_media_id is not null`.execute(test.owner);
      expect(photos.rows[0]?.n).toBe('0');
      expect((await sql`select * from media_files`.execute(test.owner)).rows).toHaveLength(0);
      expect((await sql`select * from media_people`.execute(test.owner)).rows).toHaveLength(0);
    } finally {
      await dir.remove();
      await test.cleanup();
    }
  }, 60_000);
});

describe('media tables: constraints and row-level security, as the app role in raw SQL', () => {
  let test: TestDatabase;
  let family: Family;
  let app: ReturnType<typeof createAppDb>;

  async function setup() {
    test = await createTestDatabase();
    await ensureAppRole(test.owner, test.config.appUser, test.config.appPassword);
    await runMigrations(test.owner, { dir: realMigrationsDir, appRole: test.config.appUser });
    family = await buildFamily(test.owner);
    app = test.track(createAppDb(test.config));
  }

  type Trx = Parameters<Parameters<ReturnType<typeof app.transaction>['execute']>[0]>[0];
  const as = <T>(userId: string | null, statement: (trx: Trx) => Promise<T>): Promise<T> =>
    app.transaction().execute(async (trx) => {
      if (userId) await sql`select set_config('kinship.user_id', ${userId}, true)`.execute(trx);
      return statement(trx);
    });
  const affected = (r: unknown) => Number((r as { numAffectedRows?: bigint }).numAffectedRows ?? 0n);

  async function newMedia(uploader: string, takenOn: string | null = null): Promise<string> {
    const { storage, avatar } = ids();
    const r = await sql<{ id: string }>`
      insert into media_files (storage_id, avatar_storage_id, mime, size, avatar_size, width, height, taken_on, key_id, uploaded_by)
      values (${storage}, ${avatar}, 'image/jpeg', 1000, 100, 800, 600, ${takenOn}, ${'0123456789abcdef'}, ${uploader})
      returning id`.execute(test.owner);
    return (r.rows[0] as { id: string }).id;
  }
  const link = (media: string, person: string) =>
    sql`insert into media_people (media_id, person_id) values (${media}, ${person})`.execute(test.owner);

  it('is set up', async () => {
    await setup();
  }, 60_000);

  it('everyone signed in reads photos and links; nobody signed out does', async () => {
    const media = await newMedia(family.account.superadmin.id);
    await link(media, family.person.marcus);
    for (const who of ['superadmin', 'familyadmin', 'member', 'unlinked', 'user'] as const) {
      const rows = await as(family.account[who].id, (trx) => sql`select id from media_files`.execute(trx));
      expect(rows.rows.length, who).toBeGreaterThan(0);
      const links = await as(family.account[who].id, (trx) => sql`select * from media_people`.execute(trx));
      expect(links.rows.length, who).toBeGreaterThan(0);
    }
    expect((await as(null, (trx) => sql`select id from media_files`.execute(trx))).rows).toHaveLength(0);
    expect((await as(null, (trx) => sql`select * from media_people`.execute(trx))).rows).toHaveLength(0);
  });

  it('only admins and Members may add a photo, and only as themselves', async () => {
    const insert = (uploader: string, as_: string) => {
      const { storage, avatar } = ids();
      return as(as_, (trx) =>
        sql`insert into media_files (storage_id, avatar_storage_id, mime, size, avatar_size, width, height, key_id, uploaded_by)
            values (${storage}, ${avatar}, 'image/png', 10, 10, 1, 1, ${'0123456789abcdef'}, ${uploader})`.execute(trx),
      );
    };
    for (const who of ['superadmin', 'familyadmin', 'member', 'unlinked'] as const) {
      await expect(insert(family.account[who].id, family.account[who].id), who).resolves.toBeTruthy();
    }
    await expect(insert(family.account.user.id, family.account.user.id)).rejects.toThrow(/row-level security/);
    // Not as somebody else.
    await expect(insert(family.account.superadmin.id, family.account.member.id)).rejects.toThrow(/row-level security/);
    await expect(insert(family.account.member.id, null as unknown as string)).rejects.toThrow();
  });

  it('refuses bad values: names, types, sizes, key ids and dates', async () => {
    const bad = (extra: Record<string, string | number>) => {
      const { storage, avatar } = ids();
      const v = {
        storage_id: storage,
        avatar_storage_id: avatar,
        mime: 'image/jpeg',
        size: 1,
        avatar_size: 1,
        width: 1,
        height: 1,
        key_id: '0123456789abcdef',
        taken_on: null as string | null,
        ...extra,
      };
      return sql`insert into media_files (storage_id, avatar_storage_id, mime, size, avatar_size, width, height, key_id, taken_on)
        values (${v.storage_id}, ${v.avatar_storage_id}, ${v.mime}, ${v.size}, ${v.avatar_size}, ${v.width}, ${v.height}, ${v.key_id}, ${v.taken_on})`.execute(
        test.owner,
      );
    };
    await expect(bad({ storage_id: 'not-hex' })).rejects.toThrow(/check constraint/);
    await expect(bad({ mime: 'image/gif' })).rejects.toThrow(/check constraint/);
    await expect(bad({ mime: 'image/svg+xml' })).rejects.toThrow(/check constraint/);
    await expect(bad({ size: 0 })).rejects.toThrow(/check constraint/);
    await expect(bad({ width: 0 })).rejects.toThrow(/check constraint/);
    await expect(bad({ key_id: 'XYZ' })).rejects.toThrow(/check constraint/);
    await expect(bad({ taken_on: '2020-02-30' })).rejects.toThrow(/partial_date_valid/);
    await expect(bad({ taken_on: '1999-6' })).rejects.toThrow(/partial_date_valid/);
    const same = hex(999_999);
    await expect(bad({ storage_id: same, avatar_storage_id: same })).rejects.toThrow(/check constraint/);
    await expect(bad({ taken_on: '1999' })).resolves.toBeTruthy();
    await expect(bad({ taken_on: '1999-06' })).resolves.toBeTruthy();
    await expect(bad({ taken_on: '1999-06-04' })).resolves.toBeTruthy();
  });

  it('linking follows who may change the person', async () => {
    const media = await newMedia(family.account.superadmin.id);
    const add = (who: string, person: string) =>
      as(who, (trx) => sql`insert into media_people (media_id, person_id) values (${media}, ${person})`.execute(trx));
    // Admins: anyone.
    await expect(add(family.account.superadmin.id, family.person.walter)).resolves.toBeTruthy();
    await expect(add(family.account.familyadmin.id, family.person.rosa)).resolves.toBeTruthy();
    // The Member linked to Marcus: Marcus, not Daniel.
    await expect(add(family.account.member.id, family.person.marcus)).resolves.toBeTruthy();
    await expect(add(family.account.member.id, family.person.daniel)).rejects.toThrow(/row-level security/);
    // A Member linked to nobody, and a User: nobody.
    await expect(add(family.account.unlinked.id, family.person.marcus)).rejects.toThrow(/row-level security/);
    await expect(add(family.account.user.id, family.person.marcus)).rejects.toThrow(/row-level security/);
    // Unlinking follows the same rule.
    const remove = (who: string, person: string) =>
      as(who, (trx) => sql`delete from media_people where media_id = ${media} and person_id = ${person}`.execute(trx));
    expect(affected(await remove(family.account.unlinked.id, family.person.marcus))).toBe(0);
    expect(affected(await remove(family.account.user.id, family.person.marcus))).toBe(0);
    expect(affected(await remove(family.account.member.id, family.person.daniel))).toBe(0);
    expect(affected(await remove(family.account.member.id, family.person.marcus))).toBe(1);
  });

  it('a Member also changes people in their line that they added', async () => {
    const leo = family.person.leo;
    // Leo is Marcus's child; if the Member added Leo, the Member may link photos to Leo.
    await sql`update people set created_by = ${family.account.member.id} where id = ${leo}`.execute(test.owner);
    const media = await newMedia(family.account.member.id);
    await expect(
      as(family.account.member.id, (trx) =>
        sql`insert into media_people (media_id, person_id) values (${media}, ${leo})`.execute(trx),
      ),
    ).resolves.toBeTruthy();
    // Sofia is Marcus's sister: not in his line.
    await sql`update people set created_by = ${family.account.member.id} where id = ${family.person.sofia}`.execute(
      test.owner,
    );
    await expect(
      as(family.account.member.id, (trx) =>
        sql`insert into media_people (media_id, person_id) values (${media}, ${family.person.sofia})`.execute(trx),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('the date taken: the uploader, or someone who may change a linked person; nobody else', async () => {
    const media = await newMedia(family.account.member.id, '2001');
    await link(media, family.person.daniel);
    const set = (who: string, value: string | null) =>
      as(who, (trx) => sql`update media_files set taken_on = ${value} where id = ${media}`.execute(trx));
    expect(affected(await set(family.account.familyadmin.id, '2002-03'))).toBe(1);
    expect(affected(await set(family.account.member.id, '2003'))).toBe(1); // the uploader
    expect(affected(await set(family.account.unlinked.id, '2004'))).toBe(0);
    expect(affected(await set(family.account.user.id, '2004'))).toBe(0);
    // The Member linked to Marcus: Daniel is not theirs.
    const other = await newMedia(family.account.superadmin.id);
    await link(other, family.person.daniel);
    expect(
      affected(
        await as(family.account.member.id, (trx) =>
          sql`update media_files set taken_on = '2010' where id = ${other}`.execute(trx),
        ),
      ),
    ).toBe(0);
    await link(other, family.person.marcus);
    expect(
      affected(
        await as(family.account.member.id, (trx) =>
          sql`update media_files set taken_on = '2010' where id = ${other}`.execute(trx),
        ),
      ),
    ).toBe(1);
    // Only the date taken may be changed by the app role.
    await expect(
      as(family.account.superadmin.id, (trx) => sql`update media_files set width = 5 where id = ${other}`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(family.account.superadmin.id, (trx) =>
        sql`update media_files set taken_on = '2020-13' where id = ${other}`.execute(trx),
      ),
    ).rejects.toThrow(/partial_date_valid/);
  });

  it('deleting a photo: admins, or the uploader if a Member', async () => {
    const del = (who: string, media: string) =>
      as(who, (trx) => sql`delete from media_files where id = ${media}`.execute(trx));
    const mine = await newMedia(family.account.member.id);
    expect(affected(await del(family.account.unlinked.id, mine))).toBe(0);
    expect(affected(await del(family.account.user.id, mine))).toBe(0);
    expect(affected(await del(family.account.member.id, mine))).toBe(1);
    const theirs = await newMedia(family.account.member.id);
    expect(affected(await del(family.account.familyadmin.id, theirs))).toBe(1);
    // A User who uploaded something before being demoted may not delete it.
    const userMedia = await newMedia(family.account.user.id);
    expect(affected(await del(family.account.user.id, userMedia))).toBe(0);
  });

  it('the profile photo must be linked to that person, and unlinking or deleting clears it', async () => {
    const media = await newMedia(family.account.superadmin.id);
    const setPhoto = (person: string, value: string | null) =>
      as(family.account.superadmin.id, (trx) =>
        sql`update people set photo_media_id = ${value} where id = ${person}`.execute(trx),
      );
    await expect(setPhoto(family.person.sofia, media)).rejects.toThrow(/people_photo_linked_fk/);
    await expect(setPhoto(family.person.sofia, '00000000-0000-7000-8000-000000000000')).rejects.toThrow(/foreign key/);
    await link(media, family.person.sofia);
    await setPhoto(family.person.sofia, media);
    const read = async () =>
      (
        await sql<{
          photo_media_id: string | null;
        }>`select photo_media_id from people where id = ${family.person.sofia}`.execute(test.owner)
      ).rows[0]?.photo_media_id;
    expect(await read()).toBe(media);
    // Unlink: cleared.
    await sql`delete from media_people where media_id = ${media} and person_id = ${family.person.sofia}`.execute(
      test.owner,
    );
    expect(await read()).toBeNull();
    // Link again, set, then delete the photo: cleared, the person stays.
    await link(media, family.person.sofia);
    await setPhoto(family.person.sofia, media);
    await sql`delete from media_files where id = ${media}`.execute(test.owner);
    expect(await read()).toBeNull();
    expect((await sql`select 1 from people where id = ${family.person.sofia}`.execute(test.owner)).rows).toHaveLength(
      1,
    );
  });

  it('who may set a profile photo follows the people update rule', async () => {
    const media = await newMedia(family.account.superadmin.id);
    await link(media, family.person.marcus);
    await link(media, family.person.daniel);
    const setPhoto = (who: string, person: string) =>
      as(who, (trx) => sql`update people set photo_media_id = ${media} where id = ${person}`.execute(trx));
    expect(affected(await setPhoto(family.account.user.id, family.person.marcus))).toBe(0);
    expect(affected(await setPhoto(family.account.unlinked.id, family.person.marcus))).toBe(0);
    expect(affected(await setPhoto(family.account.member.id, family.person.daniel))).toBe(0);
    expect(affected(await setPhoto(family.account.member.id, family.person.marcus))).toBe(1);
  });

  it('deleting a person removes the links and leaves the photo row', async () => {
    const media = await newMedia(family.account.superadmin.id);
    await link(media, family.person.tomas);
    await sql`update people set photo_media_id = ${media} where id = ${family.person.tomas}`.execute(test.owner);
    await sql`delete from people where id = ${family.person.tomas}`.execute(test.owner);
    expect(
      (await sql`select 1 from media_people where person_id = ${family.person.tomas}`.execute(test.owner)).rows,
    ).toHaveLength(0);
    expect((await sql`select 1 from media_files where id = ${media}`.execute(test.owner)).rows).toHaveLength(1);
  });

  it('the start-up questions work without a signed-in account and reveal nothing else', async () => {
    expect((await sql<{ ok: boolean }>`select public.kinship_media_exists() as ok`.execute(app)).rows[0]?.ok).toBe(
      true,
    );
    const keys = (await sql<{ id: string }>`select public.kinship_media_key_ids() as id`.execute(app)).rows.map(
      (r) => r.id,
    );
    expect(keys).toEqual(['0123456789abcdef']);
    const used = (await sql<{ id: string }>`select public.kinship_media_storage_ids() as id`.execute(app)).rows;
    expect(used.length).toBeGreaterThan(2);
    // Not callable by an unrelated role: only the app role has EXECUTE.
    const grants = await sql<{ n: string }>`
      select count(*) as n from information_schema.routine_privileges
       where routine_name = 'kinship_media_exists' and grantee = 'PUBLIC'`.execute(test.owner);
    expect(grants.rows[0]?.n).toBe('0');
  });

  it('is cleaned up', async () => {
    await test.cleanup();
  });
});
