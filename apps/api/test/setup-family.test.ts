// SPDX-License-Identifier: AGPL-3.0-or-later
// The first-run wizard's single write (migration 0012, ADR 0013): POST /api/setup with a `family`, POST /api/setup/check.
import type { SetupFamily, SetupUnionStatus } from '@kinship/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as passwords from '../src/auth/passwords.js';
import { prepareSetupToken } from '../src/auth/startup.js';
import { checkSetupToken } from '../src/auth/store.js';
import { hashToken } from '../src/auth/tokens.js';
import { CSRF, PASSWORD, createTestApp, post } from './helpers/app.js';
import type { TestApp } from './helpers/app.js';

// Count the password hashes, so a test can show that a refused request never reached argon2.
vi.mock('../src/auth/passwords.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/auth/passwords.js')>();
  return { ...original, hashPassword: vi.fn(original.hashPassword) };
});

const apps: TestApp[] = [];
afterAll(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function newToken(t: TestApp): Promise<string> {
  let printed = '';
  await prepareSetupToken(t.db, 'http://kin.example', (text) => (printed = text));
  const token = /^\s{4}(\S+)$/m.exec(printed)?.[1];
  if (!token) throw new Error(`no token in the printed message:\n${printed}`);
  return token;
}

/** A fresh install: a migrated database with no account and a setup token. */
async function freshInstall(overrides: Parameters<typeof createTestApp>[0] = {}) {
  const t = await createTestApp(overrides);
  apps.push(t);
  return { ...t, token: await newToken(t) };
}

/** Puts a used-up install back to a fresh one (the tests that need many setups share one database). */
async function reset(t: TestApp): Promise<string> {
  await sql`truncate users, people, unions, person_parents, family_tree, sessions, setup_token cascade`.execute(
    t.owner,
  );
  return newToken(t);
}

const body = (token: string, family: SetupFamily | undefined, extra: Record<string, unknown> = {}) => ({
  token,
  displayName: 'Marcus Hale',
  email: 'marcus@example.com',
  password: PASSWORD,
  treeName: 'Hale Family',
  ...(family ? { family } : {}),
  ...extra,
});

/** The Hale family of the mockup, as far as the wizard goes. */
const HALE: SetupFamily = {
  you: { givenName: 'Marcus', surname: 'Hale', birth: { value: '1986-07-31' }, gender: 'male' },
  partner: { status: 'married', givenName: 'Priya', surname: 'Nair', marriedSurname: 'Hale', gender: 'female' },
  parents: {
    father: { givenName: 'Daniel', surname: 'Hale' },
    mother: { givenName: 'Elena', surname: 'Ruiz' },
  },
  children: [
    { givenName: 'Leo', surname: 'Hale', birth: { value: '2017-04-09' }, gender: 'male', otherParent: 'partner' },
    { givenName: 'Mia', surname: 'Hale', otherParent: 'none' },
  ],
};

interface Snapshot {
  users: number;
  trees: number;
  sessions: number;
  people: string[];
  unions: string[];
  links: string[];
  tokens: number;
}

const count = async (t: TestApp, table: string) =>
  Number((await sql<{ n: string }>`select count(*) as n from ${sql.table(table)}`.execute(t.owner)).rows[0]?.n);

/** What is in the database, in words: "Given Surname", "A + B (status)", "child < A + B" or "child < A". */
async function snapshot(t: TestApp): Promise<Snapshot> {
  const name = (id: string, names: Map<string, string>) => names.get(id) ?? id;
  const people = (
    await sql<{ id: string; given_name: string; surname: string }>`select id, given_name, surname from people`.execute(
      t.owner,
    )
  ).rows;
  const names = new Map(people.map((p) => [p.id, `${p.given_name} ${p.surname}`]));
  const unions = (
    await sql<{ id: string; partner_a_id: string; partner_b_id: string; status: string }>`
      select id, partner_a_id, partner_b_id, status from unions`.execute(t.owner)
  ).rows;
  const unionText = new Map(
    unions.map((u) => [u.id, [name(u.partner_a_id, names), name(u.partner_b_id, names)].sort().join(' + ')]),
  );
  const links = (
    await sql<{ child_id: string; union_id: string | null; parent_id: string | null; kind: string }>`
      select child_id, union_id, parent_id, kind from person_parents`.execute(t.owner)
  ).rows;
  return {
    users: await count(t, 'users'),
    trees: await count(t, 'family_tree'),
    sessions: await count(t, 'sessions'),
    people: [...names.values()].sort(),
    unions: unions.map((u) => `${unionText.get(u.id)} (${u.status})`).sort(),
    links: links
      .map(
        (l) =>
          `${name(l.child_id, names)} < ${l.union_id ? unionText.get(l.union_id) : name(l.parent_id as string, names)} [${l.kind}]`,
      )
      .sort(),
    tokens: await count(t, 'setup_token'),
  };
}

const EMPTY: Snapshot = { users: 0, trees: 0, sessions: 0, people: [], unions: [], links: [], tokens: 1 };

describe('POST /api/setup with a family', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = (await freshInstall()) as TestApp;
  });

  it('creates the account, the tree and the whole Hale family, and links the account to "you"', async () => {
    const token = await reset(t);
    const response = await post(t.app, '/api/setup', body(token, HALE, { settings: { colorScheme: 'slate' } }));
    expect(response.statusCode).toBe(201);
    const me = response.json() as { user: { id: string; personId: string; colorScheme: string }; treeName: string };
    expect(me.treeName).toBe('Hale Family');
    expect(me.user.colorScheme).toBe('slate');

    const snap = await snapshot(t);
    expect(snap).toEqual({
      users: 1,
      trees: 1,
      sessions: 1,
      tokens: 0,
      people: ['Daniel Hale', 'Elena Ruiz', 'Leo Hale', 'Marcus Hale', 'Mia Hale', 'Priya Nair'],
      unions: ['Daniel Hale + Elena Ruiz (married)', 'Marcus Hale + Priya Nair (married)'],
      links: [
        'Leo Hale < Marcus Hale + Priya Nair [birth]',
        'Marcus Hale < Daniel Hale + Elena Ruiz [birth]',
        'Mia Hale < Marcus Hale [birth]',
      ],
    });

    const you = await sql<{ given_name: string; birth_date: string; gender: string }>`
      select p.given_name, p.birth_date, p.gender from people p where p.id = ${me.user.personId}`.execute(t.owner);
    expect(you.rows).toEqual([{ given_name: 'Marcus', birth_date: '1986-07-31', gender: 'male' }]);

    const rows = await sql<Record<string, unknown>>`
      select given_name, married_surname, gender, deceased, created_by from people order by given_name`.execute(
      t.owner,
    );
    const byName = Object.fromEntries(rows.rows.map((r) => [r['given_name'] as string, r]));
    expect(byName['Priya']).toMatchObject({ married_surname: 'Hale', gender: 'female' });
    expect(byName['Daniel']).toMatchObject({ gender: 'male', deceased: false });
    expect(byName['Elena']).toMatchObject({ gender: 'female' });
    expect(byName['Mia']).toMatchObject({ gender: null });
    for (const row of rows.rows) expect(row['created_by']).toBe(me.user.id);

    // The account can read the people through row-level security, as itself.
    const cookie = response.cookies[0];
    const people = await t.app.inject({ url: '/api/people', cookies: { [cookie?.name ?? '']: cookie?.value ?? '' } });
    expect(people.statusCode).toBe(200);
    expect((people.json() as { items: unknown[] }).items).toHaveLength(6);
  });

  it('stores the account settings with the account, in the same transaction', async () => {
    const token = await reset(t);
    const response = await post(
      t.app,
      '/api/setup',
      body(token, HALE, {
        settings: { colorScheme: 'graphite', theme: 'dark', dateFormat: 'iso', surnameChoice: 'birth' },
      }),
    );
    expect(response.statusCode).toBe(201);
    expect((response.json() as { user: Record<string, string> }).user).toMatchObject({
      colorScheme: 'graphite',
      theme: 'dark',
      dateFormat: 'iso',
      surnameChoice: 'birth',
    });
  });

  it('works for every skip combination of partner, parents and children (2 x 2 x 2)', async () => {
    for (const withPartner of [false, true]) {
      for (const withParents of [false, true]) {
        for (const withChildren of [false, true]) {
          const token = await reset(t);
          const family: SetupFamily = {
            you: HALE.you,
            ...(withPartner ? { partner: HALE.partner } : {}),
            ...(withParents ? { parents: HALE.parents } : {}),
            ...(withChildren
              ? {
                  children: [
                    { givenName: 'Leo', surname: 'Hale', otherParent: withPartner ? 'partner' : 'none' },
                    { givenName: 'Mia', surname: 'Hale', otherParent: 'none' },
                  ],
                }
              : {}),
          };
          const response = await post(t.app, '/api/setup', body(token, family));
          const label = JSON.stringify({ withPartner, withParents, withChildren });
          expect(response.statusCode, label).toBe(201);
          const snap = await snapshot(t);
          expect(snap.people, label).toHaveLength(
            1 + (withPartner ? 1 : 0) + (withParents ? 2 : 0) + (withChildren ? 2 : 0),
          );
          expect(snap.unions, label).toHaveLength((withPartner ? 1 : 0) + (withParents ? 1 : 0));
          expect(snap.links, label).toHaveLength((withParents ? 1 : 0) + (withChildren ? 2 : 0));
          expect(snap.users).toBe(1);
          expect(snap.tokens).toBe(0);
          if (withChildren) {
            expect(snap.links).toContain(
              withPartner ? 'Leo Hale < Marcus Hale + Priya Nair [birth]' : 'Leo Hale < Marcus Hale [birth]',
            );
          }
        }
      }
    }
  });

  it('with one parent entered, you hang from that parent alone (no relationship made)', async () => {
    for (const [which, other] of [
      ['father', 'Daniel Hale'],
      ['mother', 'Elena Ruiz'],
    ] as const) {
      const token = await reset(t);
      const parents =
        which === 'father'
          ? { father: { givenName: 'Daniel', surname: 'Hale' } }
          : { mother: { givenName: 'Elena', surname: 'Ruiz' } };
      const response = await post(t.app, '/api/setup', body(token, { you: HALE.you, parents }));
      expect(response.statusCode).toBe(201);
      const snap = await snapshot(t);
      expect(snap.unions).toEqual([]);
      expect(snap.links).toEqual([`Marcus Hale < ${other} [birth]`]);
    }
  });

  it('turns Married plus Deceased into Widowed by the existing trigger, and keeps the other statuses', async () => {
    const token = await reset(t);
    const family: SetupFamily = {
      you: HALE.you,
      partner: { status: 'married', givenName: 'Priya', surname: 'Nair', deceased: true },
      parents: {
        father: { givenName: 'Daniel', surname: 'Hale', deceased: true },
        mother: { givenName: 'Elena', surname: 'Ruiz', deceased: true },
      },
    };
    expect((await post(t.app, '/api/setup', body(token, family))).statusCode).toBe(201);
    // Both parents deceased with the default Married status: Widowed, set automatically.
    const rows = await sql<{ status: string; status_auto: boolean }>`
      select status, status_auto from unions order by status`.execute(t.owner);
    expect(rows.rows).toEqual([
      { status: 'widowed', status_auto: true },
      { status: 'widowed', status_auto: true },
    ]);

    const token2 = await reset(t);
    const divorced: SetupFamily = {
      you: HALE.you,
      partner: { status: 'divorced', givenName: 'Priya', surname: 'Nair', deceased: true },
    };
    expect((await post(t.app, '/api/setup', body(token2, divorced))).statusCode).toBe(201);
    expect((await snapshot(t)).unions).toEqual(['Marcus Hale + Priya Nair (divorced)']);
  });

  it('stores Widowed by hand when someone is deceased, and a deceased father with a Married mother becomes Widowed', async () => {
    const token = await reset(t);
    const family: SetupFamily = {
      you: HALE.you,
      partner: { status: 'widowed', givenName: 'Priya', surname: 'Nair', marriedSurname: 'Hale', deceased: true },
      parents: {
        father: { givenName: 'Daniel', surname: 'Hale', deceased: true },
        mother: { givenName: 'Elena', surname: 'Ruiz' },
      },
    };
    expect((await post(t.app, '/api/setup', body(token, family))).statusCode).toBe(201);
    const rows = await sql<{ status: string; status_auto: boolean }>`
      select status, status_auto from unions order by status_auto`.execute(t.owner);
    expect(rows.rows).toEqual([
      { status: 'widowed', status_auto: false }, // chosen: the partner
      { status: 'widowed', status_auto: true }, // automatic: the parents
    ]);
    const priya = await sql<{ married_surname: string; deceased: boolean }>`
      select married_surname, deceased from people where given_name = 'Priya'`.execute(t.owner);
    expect(priya.rows).toEqual([{ married_surname: 'Hale', deceased: true }]);
  });

  it('lets the parents have any of the six statuses, and ignores a married surname for the other statuses', async () => {
    for (const status of ['married', 'engaged', 'partner', 'separated', 'divorced'] as const) {
      const token = await reset(t);
      const family: SetupFamily = {
        you: HALE.you,
        partner: { status, givenName: 'Priya', surname: 'Nair', marriedSurname: 'Hale' },
        parents: { ...HALE.parents, status },
      };
      expect((await post(t.app, '/api/setup', body(token, family))).statusCode, status).toBe(201);
      expect((await snapshot(t)).unions, status).toEqual([
        `Daniel Hale + Elena Ruiz (${status})`,
        `Marcus Hale + Priya Nair (${status})`,
      ]);
      const priya = await sql<{ married_surname: string | null }>`
        select married_surname from people where given_name = 'Priya'`.execute(t.owner);
      expect(priya.rows[0]?.married_surname, status).toBe(status === 'married' ? 'Hale' : null);
    }
  });

  it('never blocks on parent_too_young: a child born before their parent is stored', async () => {
    const token = await reset(t);
    const family: SetupFamily = {
      you: { givenName: 'Marcus', surname: 'Hale', birth: { value: '2000-05' } },
      children: [
        { givenName: 'Leo', surname: 'Hale', birth: { value: '1900', precision: 'about' }, otherParent: 'none' },
      ],
    };
    expect((await post(t.app, '/api/setup', body(token, family))).statusCode).toBe(201);
    const leo = await sql<{ birth_date: string; birth_precision: string }>`
      select birth_date, birth_precision from people where given_name = 'Leo'`.execute(t.owner);
    expect(leo.rows).toEqual([{ birth_date: '1900', birth_precision: 'about' }]);
  });

  it('accepts a family with only "you" and an empty object for the optional parts', async () => {
    const token = await reset(t);
    const response = await post(
      t.app,
      '/api/setup',
      body(token, { you: HALE.you, partner: null, parents: {}, children: [] }),
    );
    expect(response.statusCode).toBe(201);
    expect((await snapshot(t)).people).toEqual(['Marcus Hale']);
  });

  it('accepts 30 children and refuses 31', async () => {
    const child = (i: number) => ({ givenName: `Kid${i}`, surname: 'Hale', otherParent: 'none' as const });
    const token = await reset(t);
    const over = await post(
      t.app,
      '/api/setup',
      body(token, { you: HALE.you, children: Array.from({ length: 31 }, (_, i) => child(i)) }),
    );
    expect(over.statusCode).toBe(400);
    expect(over.json()).toEqual({ error: 'too_many_children', field: 'family.children' });
    expect((await snapshot(t)).users).toBe(0);
    const ok = await post(
      t.app,
      '/api/setup',
      body(token, { you: HALE.you, children: Array.from({ length: 30 }, (_, i) => child(i)) }),
    );
    expect(ok.statusCode).toBe(201);
    expect((await snapshot(t)).people).toHaveLength(31);
  });
});

describe('errors name the field, and nothing is written', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = (await freshInstall()) as TestApp;
  });

  const family = (change: (f: SetupFamily) => void): SetupFamily => {
    const copy = structuredClone(HALE);
    change(copy);
    return copy;
  };
  // [what to break, error, field]
  const cases: Array<[string, (f: SetupFamily) => void, string, string]> = [
    ['you: no given name', (f) => (f.you.givenName = '  '), 'invalid_given_name', 'family.you.givenName'],
    ['you: surname too long', (f) => (f.you.surname = 'x'.repeat(101)), 'invalid_surname', 'family.you.surname'],
    ['you: control character', (f) => (f.you.givenName = 'Mar\u0007cus'), 'invalid_given_name', 'family.you.givenName'],
    ['you: bad birth date', (f) => (f.you.birth = { value: '1986-02-30' }), 'invalid_date', 'family.you.birth'],
    [
      'you: bad precision',
      (f) => (f.you.birth = { value: '1986', precision: 'sometime' as never }),
      'invalid_precision',
      'family.you.birth',
    ],
    ['you: bad gender', (f) => (f.you.gender = 'robot' as never), 'invalid_gender', 'family.you.gender'],
    [
      'partner: bad status',
      (f) => ((f.partner as { status: string }).status = 'friends'),
      'invalid_union_status',
      'family.partner.status',
    ],
    [
      'partner: no given name',
      (f) => ((f.partner as { givenName: string }).givenName = ''),
      'invalid_given_name',
      'family.partner.givenName',
    ],
    [
      'partner: no surname',
      (f) => ((f.partner as { surname: string }).surname = ''),
      'invalid_surname',
      'family.partner.surname',
    ],
    [
      'partner: bad married surname',
      (f) => ((f.partner as { marriedSurname: string }).marriedSurname = 'x'.repeat(101)),
      'invalid_married_surname',
      'family.partner.marriedSurname',
    ],
    [
      'partner: bad gender',
      (f) => ((f.partner as { gender: string }).gender = 'x'),
      'invalid_gender',
      'family.partner.gender',
    ],
    [
      'partner: widowed but living',
      (f) => (f.partner = { status: 'widowed', givenName: 'Priya', surname: 'Nair' }),
      'widowed_needs_deceased',
      'family.partner.deceased',
    ],
    [
      'partner: deceased is not a boolean',
      (f) => ((f.partner as { deceased: unknown }).deceased = 'yes'),
      'invalid_request',
      'family.partner.deceased',
    ],
    [
      'father: no given name',
      (f) => ((f.parents?.father as { givenName: string }).givenName = ''),
      'invalid_given_name',
      'family.parents.father.givenName',
    ],
    [
      'mother: no surname',
      (f) => ((f.parents?.mother as { surname: string }).surname = ''),
      'invalid_surname',
      'family.parents.mother.surname',
    ],
    [
      'parents: bad status',
      (f) => ((f.parents as { status: string }).status = 'complicated'),
      'invalid_union_status',
      'family.parents.status',
    ],
    [
      'parents: widowed but living',
      (f) => ((f.parents as { status: string }).status = 'widowed'),
      'widowed_needs_deceased',
      'family.parents.status',
    ],
    [
      'parents: a death date is not accepted',
      (f) => ((f.parents?.father as unknown as Record<string, unknown>)['death'] = { value: '1990' }),
      'invalid_request',
      'family.parents.father.death',
    ],
    [
      'child 1: bad birth date',
      (f) => ((f.children as Array<{ birth: unknown }>)[1]!.birth = { value: '2019-13' }),
      'invalid_date',
      'family.children.1.birth',
    ],
    [
      'child 0: no given name',
      (f) => ((f.children as Array<{ givenName: string }>)[0]!.givenName = ''),
      'invalid_given_name',
      'family.children.0.givenName',
    ],
    [
      'child 1: bad other parent',
      (f) => ((f.children as Array<{ otherParent: string }>)[1]!.otherParent = 'later'),
      'invalid_request',
      'family.children.1.otherParent',
    ],
    [
      'child 1: bad gender',
      (f) => ((f.children as Array<{ gender: string }>)[1]!.gender = 'x'),
      'invalid_gender',
      'family.children.1.gender',
    ],
    [
      'an unknown key',
      (f) => ((f as unknown as Record<string, unknown>)['siblings'] = []),
      'invalid_request',
      'family.siblings',
    ],
    [
      'children is not a list',
      (f) => ((f as unknown as Record<string, unknown>)['children'] = 'Leo'),
      'invalid_request',
      'family.children',
    ],
    ['you is missing', (f) => delete (f as Partial<SetupFamily>).you, 'invalid_request', 'family.you'],
  ];

  it.each(cases)('%s', async (_name, change, error, field) => {
    const token = await reset(t);
    const response = await post(t.app, '/api/setup', body(token, family(change)));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error, field });
    expect(await snapshot(t)).toEqual(EMPTY);
    expect(await checkSetupToken(t.db, hashToken(token))).toBe(true);
  });

  it('refuses a child of the partner when there is no partner', async () => {
    const token = await reset(t);
    const response = await post(
      t.app,
      '/api/setup',
      body(token, { you: HALE.you, children: [{ givenName: 'Leo', surname: 'Hale', otherParent: 'partner' }] }),
    );
    expect(response.json()).toEqual({ error: 'other_parent_needs_partner', field: 'family.children.0.otherParent' });
    expect(await snapshot(t)).toEqual(EMPTY);
  });

  it('names the account-level fields too, and the setting', async () => {
    const token = await reset(t);
    for (const [change, error, field] of [
      [{ email: 'nope' }, 'invalid_email', 'email'],
      [{ displayName: ' ' }, 'invalid_display_name', 'displayName'],
      [{ treeName: ' ' }, 'invalid_tree_name', 'treeName'],
      [{ password: 'short' }, 'password_too_short', 'password'],
      [{ settings: { theme: 'neon' } }, 'invalid_theme', 'settings.theme'],
      [{ settings: { nope: 1 } }, 'invalid_request', 'settings'],
    ] as const) {
      const response = await post(t.app, '/api/setup', body(token, HALE, change));
      expect(response.statusCode, error).toBe(400);
      expect(response.json(), error).toMatchObject({ error, field });
    }
    expect(await snapshot(t)).toEqual(EMPTY);
  });

  it('refuses `person` together with `family`', async () => {
    const token = await reset(t);
    const response = await post(t.app, '/api/setup', body(token, HALE, { person: { givenName: 'A', surname: 'B' } }));
    expect(response.json()).toEqual({ error: 'invalid_request', field: 'family' });
    expect(await snapshot(t)).toEqual(EMPTY);
  });

  it('checks the token first, and never hashes a password for a refused request', async () => {
    const token = await reset(t);
    const hash = vi.mocked(passwords.hashPassword);
    hash.mockClear();
    // A wrong token with a family that is also wrong: the token is what is refused.
    const wrong = await post(
      t.app,
      '/api/setup',
      body(
        'not-the-token',
        family((f) => (f.you.givenName = '')),
      ),
    );
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'invalid_setup_token', field: 'token' });
    // A right token with a bad family: refused before argon2.
    const bad = await post(
      t.app,
      '/api/setup',
      body(
        token,
        family((f) => (f.you.givenName = '')),
      ),
    );
    expect(bad.statusCode).toBe(400);
    expect(hash).not.toHaveBeenCalled();
    const good = await post(t.app, '/api/setup', body(token, HALE));
    expect(good.statusCode).toBe(201);
    expect(hash).toHaveBeenCalledTimes(1);
  });
});

describe('the whole setup is one transaction', () => {
  // The full Hale family writes 6 people, 2 relationships and 3 parent links (see HALE).
  const STAGES: Array<[string, number]> = [
    ['people', 1], // you
    ['people', 2], // the partner
    ['unions', 1], // the partner relationship
    ['people', 3], // the father
    ['people', 4], // the mother
    ['unions', 2], // the parents' relationship
    ['person_parents', 1], // you hang from the parents
    ['people', 5], // the first child
    ['people', 6], // the second child
    ['person_parents', 2], // the first child's link
    ['person_parents', 3], // the second child's link
  ];

  it.each(STAGES)('rolls everything back when insert number %#: the %s table fails at row %i', async (table, n) => {
    const t = await freshInstall();
    const token = t.token;
    await sql`
      create function test_fail_nth() returns trigger language plpgsql as $$
      declare k text := 'test.count_' || tg_table_name; c int;
      begin
        c := coalesce(nullif(current_setting(k, true), ''), '0')::int + 1;
        perform set_config(k, c::text, true);
        if c = tg_argv[0]::int then raise exception 'test failure at % %', tg_table_name, c; end if;
        return new;
      end $$`.execute(t.owner);
    await sql`create trigger test_fail before insert on ${sql.table(table)} for each row execute function test_fail_nth(${sql.lit(n)})`.execute(
      t.owner,
    );

    const failed = await post(t.app, '/api/setup', body(token, HALE));
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: 'internal_error' });
    // No account, tree, session, person, relationship or parent link; the token is still good.
    expect(await snapshot(t)).toEqual(EMPTY);
    expect(await checkSetupToken(t.db, hashToken(token))).toBe(true);

    // With the fault gone the same request succeeds, so nothing was left half done.
    await sql`drop trigger test_fail on ${sql.table(table)}`.execute(t.owner);
    expect((await post(t.app, '/api/setup', body(token, HALE))).statusCode).toBe(201);
    expect((await snapshot(t)).people).toHaveLength(6);
  });

  it('rolls everything back when the account itself cannot be created (an email already used is not possible, so a bad status is forced)', async () => {
    const t = await freshInstall();
    // A relationship status the table refuses, sent past the API's own check by calling the function directly.
    const family = {
      you: { given_name: 'A', surname: 'B' },
      partner: { given_name: 'C', surname: 'D', status: 'friendly' },
    };
    await expect(
      sql`select kinship_auth.complete_setup_family(
            ${hashToken(t.token)}, 'a@example.com', 'A B', 'hash', 'Tree', '{}'::jsonb, ${JSON.stringify(family)}::jsonb)`.execute(
        t.db,
      ),
    ).rejects.toThrow(/unions_status_check/);
    expect(await snapshot(t)).toEqual(EMPTY);
  });

  it('lets exactly one of 5 simultaneous finishes win, with the whole family, and the other four say already_set_up', async () => {
    const t = await freshInstall();
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        post(t.app, '/api/setup', body(t.token, HALE, { email: `person${i}@example.com` })),
      ),
    );
    expect(attempts.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
    for (const loser of attempts.filter((r) => r.statusCode === 409)) {
      expect(loser.json()).toEqual({ error: 'already_set_up' });
    }
    const snap = await snapshot(t);
    expect(snap.users).toBe(1);
    expect(snap.trees).toBe(1);
    expect(snap.people).toHaveLength(6);
    expect(snap.unions).toHaveLength(2);
    expect(snap.links).toHaveLength(3);
    expect(snap.tokens).toBe(0);
  });
});

describe('the legacy `person` field and settings still work', () => {
  it('creates the account and the one person, as before', async () => {
    const t = await freshInstall();
    const response = await post(
      t.app,
      '/api/setup',
      body(t.token, undefined, { person: { givenName: 'Marcus', surname: 'Hale' } }),
    );
    expect(response.statusCode).toBe(201);
    expect((await snapshot(t)).people).toEqual(['Marcus Hale']);
    const me = response.json() as { user: { personId: string | null } };
    expect(me.user.personId).not.toBeNull();
  });

  it('still saves a `settings` object sent without a family', async () => {
    const t = await freshInstall();
    const response = await post(t.app, '/api/setup', body(t.token, undefined, { settings: { theme: 'dark' } }));
    expect(response.statusCode).toBe(201);
    expect((response.json() as { user: { theme: string } }).user.theme).toBe('dark');
  });

  it('creates only the account when neither is sent', async () => {
    const t = await freshInstall();
    expect((await post(t.app, '/api/setup', body(t.token, undefined))).statusCode).toBe(201);
    expect(await snapshot(t)).toMatchObject({ users: 1, people: [], unions: [] });
  });
});

describe('what was created matches the form (seeded property check)', () => {
  // mulberry32: a small seeded generator, so a failure can be replayed by its seed.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const STATUSES: SetupUnionStatus[] = ['married', 'engaged', 'partner', 'separated', 'divorced', 'widowed'];
  const effective = (status: SetupUnionStatus, anyDeceased: boolean) =>
    status === 'married' && anyDeceased ? 'widowed' : status;

  it('creates exactly the people, relationships and links the form describes, for 40 seeded forms', async () => {
    const t = await freshInstall();
    for (let seed = 1; seed <= 40; seed++) {
      const random = rng(seed);
      const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)] as T;
      const chance = (p: number) => random() < p;
      const year = () => String(1900 + Math.floor(random() * 120));

      const expectedPeople: string[] = ['You0 Hale'];
      const expectedUnions: string[] = [];
      const expectedLinks: string[] = [];
      const family: SetupFamily = {
        you: { givenName: 'You0', surname: 'Hale', ...(chance(0.5) ? { birth: { value: year() } } : {}) },
      };

      let partnerName: string | null = null;
      if (chance(0.6)) {
        const deceased = chance(0.4);
        const status = deceased ? pick(STATUSES) : pick(STATUSES.filter((s) => s !== 'widowed'));
        partnerName = 'Partner1 Nair';
        family.partner = {
          status,
          givenName: 'Partner1',
          surname: 'Nair',
          deceased,
          ...(chance(0.5) ? { gender: pick(['male', 'female', 'other'] as const) } : {}),
        };
        expectedPeople.push(partnerName);
        expectedUnions.push(`${['You0 Hale', partnerName].sort().join(' + ')} (${effective(status, deceased)})`);
      }

      const father = chance(0.5);
      const mother = chance(0.5);
      if (father || mother) {
        const fd = chance(0.3);
        const md = chance(0.3);
        family.parents = {
          ...(father ? { father: { givenName: 'Father2', surname: 'Hale', deceased: fd } } : {}),
          ...(mother ? { mother: { givenName: 'Mother3', surname: 'Ruiz', deceased: md } } : {}),
        };
        if (father) expectedPeople.push('Father2 Hale');
        if (mother) expectedPeople.push('Mother3 Ruiz');
        if (father && mother) {
          const status = pick(STATUSES.filter((s) => s !== 'widowed' || fd || md));
          family.parents.status = status;
          const union = `${['Father2 Hale', 'Mother3 Ruiz'].sort().join(' + ')}`;
          expectedUnions.push(`${union} (${effective(status, fd || md)})`);
          expectedLinks.push(`You0 Hale < ${union} [birth]`);
        } else {
          expectedLinks.push(`You0 Hale < ${father ? 'Father2 Hale' : 'Mother3 Ruiz'} [birth]`);
        }
      }

      const kids = Math.floor(random() * 5);
      if (kids > 0) family.children = [];
      for (let i = 0; i < kids; i++) {
        const other = partnerName && chance(0.6) ? ('partner' as const) : ('none' as const);
        const name = `Kid${10 + i}`;
        family.children?.push({
          givenName: name,
          surname: 'Hale',
          otherParent: other,
          ...(chance(0.5)
            ? { birth: { value: year(), precision: pick(['exactly', 'about', 'before', 'after'] as const) } }
            : {}),
        });
        expectedPeople.push(`${name} Hale`);
        expectedLinks.push(
          `${name} Hale < ${other === 'partner' ? ['You0 Hale', partnerName as string].sort().join(' + ') : 'You0 Hale'} [birth]`,
        );
      }

      const token = await reset(t);
      const response = await post(t.app, '/api/setup', body(token, family));
      expect(response.statusCode, `seed ${seed}: ${JSON.stringify(family)} -> ${response.body}`).toBe(201);
      const snap = await snapshot(t);
      expect(snap.people, `seed ${seed}`).toEqual(expectedPeople.sort());
      expect(snap.unions, `seed ${seed}`).toEqual(expectedUnions.sort());
      expect(snap.links, `seed ${seed}`).toEqual(expectedLinks.sort());

      // The account's person is "you", and nobody else is linked.
      const linked = await sql<{ given_name: string }>`
        select p.given_name from users u join people p on p.id = u.person_id`.execute(t.owner);
      expect(linked.rows, `seed ${seed}`).toEqual([{ given_name: 'You0' }]);
    }
  });
});

describe('POST /api/setup/check', () => {
  it('says 204 for the setup token and 403 for anything else', async () => {
    const t = await freshInstall();
    const ok = await post(t.app, '/api/setup/check', { token: `  ${t.token} ` });
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const wrong = await post(t.app, '/api/setup/check', { token: 'nope' });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'invalid_setup_token', field: 'token' });
    // Checking does not use the token up.
    expect((await post(t.app, '/api/setup', body(t.token, HALE))).statusCode).toBe(201);
  });

  it('says already_set_up once an account exists, and needs the CSRF header and a token', async () => {
    const t = await freshInstall();
    expect((await post(t.app, '/api/setup', body(t.token, HALE))).statusCode).toBe(201);
    const after = await post(t.app, '/api/setup/check', { token: t.token });
    expect(after.statusCode).toBe(409);
    expect(after.json()).toEqual({ error: 'already_set_up' });

    const t2 = await freshInstall();
    const noCsrf = await t2.app.inject({ method: 'POST', url: '/api/setup/check', payload: { token: t2.token } });
    expect(noCsrf.statusCode).toBe(403);
    expect((await post(t2.app, '/api/setup/check', {})).statusCode).toBe(400);
    expect((await post(t2.app, '/api/setup/check', { token: t2.token, extra: 1 })).statusCode).toBe(400);
  });

  it('shares the failure limiters with setup: 10 wrong checks lock the address out of both', async () => {
    const t = await freshInstall();
    for (let i = 0; i < 10; i++)
      expect((await post(t.app, '/api/setup/check', { token: `guess-${i}` })).statusCode).toBe(403);
    const check = await post(t.app, '/api/setup/check', { token: t.token });
    expect(check.statusCode).toBe(429);
    expect(check.json()).toMatchObject({ error: 'rate_limited' });
    expect(Number(check.headers['retry-after'])).toBeGreaterThan(0);
    const setup = await post(t.app, '/api/setup', body(t.token, HALE));
    expect(setup.statusCode).toBe(429);
    expect((await snapshot(t)).users).toBe(0);
    // Another address is not locked out.
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/setup/check',
      payload: { token: t.token },
      headers: CSRF,
      remoteAddress: '10.9.9.9',
    });
    expect(other.statusCode).toBe(204);
  });

  it('counts wrong guesses made through setup against the same allowance', async () => {
    const t = await freshInstall();
    for (let i = 0; i < 10; i++)
      expect((await post(t.app, '/api/setup', body(`guess-${i}`, HALE))).statusCode).toBe(403);
    expect((await post(t.app, '/api/setup/check', { token: t.token })).statusCode).toBe(429);
  });

  it('also limits guessing spread over many addresses (30 in 15 minutes for everyone)', async () => {
    const t = await freshInstall();
    for (let i = 0; i < 30; i++) {
      await t.app.inject({
        method: 'POST',
        url: '/api/setup/check',
        payload: { token: `guess-${i}` },
        headers: CSRF,
        remoteAddress: `10.1.${Math.floor(i / 250)}.${i % 250}`,
      });
    }
    const blocked = await t.app.inject({
      method: 'POST',
      url: '/api/setup/check',
      payload: { token: t.token },
      headers: CSRF,
      remoteAddress: '10.2.0.1',
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('has the same per-address request cap as setup (a flood is refused even with the right token)', async () => {
    const t = await freshInstall({ loginRequestsPerMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await post(t.app, '/api/setup/check', { token: t.token })).statusCode);
    expect(codes).toEqual([204, 204, 204, 429, 429]);
  });

  it('does not count a loser of a race as a bad guess', async () => {
    const t = await freshInstall();
    expect((await post(t.app, '/api/setup', body(t.token, HALE))).statusCode).toBe(201);
    for (let i = 0; i < 12; i++)
      expect((await post(t.app, '/api/setup/check', { token: `late-${i}` })).statusCode).toBe(409);
  });
});
