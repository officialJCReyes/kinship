// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Loads the fictional Hale family into a test database as the owner role. Returns each person's id by key.
import { sql } from 'kysely';
import type { UntypedDb } from '../../src/db.js';
import { insertPersonRow, insertUnionRow, linkChild } from '../helpers/family.js';
import { HALE_PARENTS, HALE_PEOPLE, HALE_UNIONS } from './hale.js';

export async function seedHale(owner: UntypedDb): Promise<Record<string, string>> {
  const id: Record<string, string> = {};
  for (const p of HALE_PEOPLE) {
    id[p.key] = await insertPersonRow(owner, p.givenName, p.surname, {
      gender: p.gender,
      birth: p.birth,
      deceased: p.death !== undefined,
    });
    if (p.nickname || p.namePrefix || p.nameSuffix || p.surnameParticle || p.marriedSurname) {
      await sql`update people set nickname = ${p.nickname ?? null}, name_prefix = ${p.namePrefix ?? null},
        name_suffix = ${p.nameSuffix ?? null}, surname_particle = ${p.surnameParticle ?? null},
        married_surname = ${p.marriedSurname ?? null} where id = ${id[p.key]!}`.execute(owner);
    }
  }
  const unionIds = new Map<string, string>();
  for (const u of HALE_UNIONS) {
    const created = await insertUnionRow(owner, id[u.a]!, id[u.b]!, u.status);
    unionIds.set(`${u.a}|${u.b}`, created);
    unionIds.set(`${u.b}|${u.a}`, created);
  }
  for (const [child, sets] of Object.entries(HALE_PARENTS)) {
    for (const kind of ['birth', 'adoptive'] as const) {
      const parents = sets[kind];
      if (!parents) continue;
      if (parents.length === 1) await linkChild(owner, id[child]!, { parent: id[parents[0]!]! }, kind);
      else await linkChild(owner, id[child]!, { union: unionIds.get(`${parents[0]}|${parents[1]}`)! }, kind);
    }
  }
  return id;
}
