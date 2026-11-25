# 0038. The surname particle is part of the surname

- Status: **Accepted** (decisions by JC, 2026-11-23, step 43, backlog 11)
- Date: 2026-11-23
- Amends: [0024 Prefix, suffix, nickname, surname particle, and how a married woman's name is shown](0024-names.md) (the
  particle), [0037 How a release candidate is made](0037-pre-releases.md) (the wording "an rc seed is a wrapper")
- Builds on: [0035 Restore with photos](0035-restore-with-photos.md) (an older backup is migrated after it is restored)
- Migration: `0024_fold_surname_particle.sql`. Data only. The contract, `0025_drop_surname_particle.sql`, is in the addendum at the end.

## Context

ADR 0024 added `people.surname_particle` (de, de la, van, von), kept apart from a bare `surname` so that sorting would
ignore it. In use it was one more field to explain, and a particle is simply part of a surname: "de la Cruz" is the
surname. The field only ever shipped in the 0.3.0 release candidates (rc.1 and rc.2), never in a stable release.

## Decisions

### The fold (migration 0024)
For each person with a particle, the surname becomes "particle, a space, the surname", unless the surname already is the
particle or already starts with the particle and a space, compared without case and by whole words ("de" + "De la Cruz"
stays "De la Cruz"; "van" + "Vandermeer" becomes "van Vandermeer"). The particle becomes `NULL`.

- **Too long:** a row whose particle, a space and its surname would pass the 100-character surname limit is left as it is
  (particle kept), and the migration raises a `NOTICE` that names the ids. The api now writes database notices from the
  start-up migration and from the migrations after a restore to its log (`database notice: ...`, level warn); before,
  they were dropped. The contract migration below must fold or refuse any such row before it drops the column. The upgrade
  seeds assert that no particle is left.
- **No surname:** cannot happen. A real person's surname is 1 to 100 characters (CHECK since 0015), and a placeholder's
  particle must be `NULL` (0017's `people_placeholder_is_blank`). The migration still skips an empty surname.
- **Row-level security:** `people` has `FORCE ROW LEVEL SECURITY` (0003), which hides every row from an owner that is not a
  superuser when no user is signed in. The migration lifts the force for its one statement and puts it back in the same
  transaction (`migration-0024.test.ts` proves the fold under a non-superuser owner).
- `updated_at` moves for the folded rows (the usual trigger); the upgrade test's fingerprint does not include it, and
  reads the surname as the fold would on a release that has the column.

### Expand, then contract
The app stops reading and writing the column now. **Not** changed now, and left for a later release's contract
migration: the column itself, the `search_names` expression (it still adds the particle, which is now always `NULL`), the
placeholder CHECK, the column grants to the app role, and `kinship_auth.complete_setup_family` (which never wrote it). The
`Database` type in `apps/api/src/db.ts` keeps the column, marked unread.

### What changes for people
- Add relative, Edit details and the profile's Facts have no particle field; it is typed into Surname. The first-run
  wizard never asked for it.
- The API refuses `surnameParticle` in a create or a change (`invalid_request`, as `surnameChoice` in 0024), and no
  response has it. The error code `invalid_surname_particle` is gone.
- **Shown names do not change**: the particle was always written before the surname.
- **Initials** take the particle's letter: "Rosa de la Cruz" was RC and is RD.
- **Sort order**: the particle is no longer ignored, so "de la Cruz" sorts under D (by the database's collation).
- **Search** is unchanged: `search_names` held the particle before the surname, so a folded row's search text is the same.
  A particle typed in both fields is now there once.

### Backups and restore
A backup from rc.1 or rc.2 (schema 23) holds the particle apart. Restoring it into this build replays it and then runs
the newer migrations (ADR 0031, 0035), so 0024 folds it and the names are the same as on an upgraded install. The CLI and
the in-app Restore share that code. `backup-restore.test.ts` proves it, and the upgrade test does it again by restoring the
pre-upgrade safety copy (`pre-upgrade-0023-to-0024.tar.enc` from an rc).

### The upgrade test and ADR 0037
ADR 0037 says a release candidate's seed is a wrapper that sources the release's seed. The rc.1 and rc.2 wrappers now also
set `SEED_PARTICLES=1` before sourcing `seed-0.3.0.sh`, which then stores two particles through the rc's own API and checks
the fold after the upgrade. This stretches "a wrapper" slightly: the rc seeds differ from the 0.3.0 seed by that flag,
because the final 0.3.0 refuses the field. Without the flag the 0.3.0 seed is unchanged. The pinned rc.1 and rc.2 upgrades
now really migrate (schema 23 to 24) and write `pre-upgrade-0023-to-0024.tar.enc`; from 0.2.1 the safety copy becomes
`pre-upgrade-0016-to-0024.tar.enc`.

### An exception to "a release candidate carries fixes only"
A migration normally waits for the next minor release. This one goes into the 0.3.0 release candidates because the field
was never in a stable release: after 0.3.0 the particle would be a published field with a published contract.

### GEDCOM (0.7)
This replaces ADR 0024's SPFX note. On **import**, a `SPFX` is joined to the front of `SURN` with a space (the same fold).
On **export**, the whole surname goes in `SURN` and no `SPFX` is written.

## Consequences
- One fewer field, and names are typed as they are written.
- A later release must drop the column, rewrite `search_names` without it, and change the placeholder CHECK and the
  grants (a contract migration), after dealing with any row the NOTICE named.
- `design/` docs that describe the particle (the requirements doc, the tree settings and search doc, the GEDCOM coverage
  doc, the handoff's names bullet, the release plan, the mockup) are stale on this point; they are corrected in the Project.

## Addendum (0.4.0, step 50): the column is dropped in migration 0025

The contract half, `0025_drop_surname_particle.sql`, also drops `users.surname_choice` (#220; unread since 0017). In order:

1. **0024's fold again** for any row that still has a particle, so 0025 is safe from any starting point (from rc.1 or rc.2,
   0024 and 0025 run in the same start-up).
2. **The leftover table.** A row still too long to fold (particle, a space and the surname over 100 characters) is copied
   into `people_surname_particle_leftover` (`person_id`, `surname_particle`, `surname`, `kept_at`) before the drop, so
   nothing is truncated or lost. The NOTICE (`0025: ...`) names the person ids only, never a surname or a particle. The
   table is created on every install, even when empty; the app role has no privilege on it and the app never reads it. It
   travels in backups like any other table.
3. **`search_names`** gets the same formula without the particle (`SET EXPRESSION`, which rewrites the table under a lock;
   fine at a family tree's size). Its value is **identical for every row except leftover rows**, whose particle leaves the
   search text (it is kept in the leftover table).
4. **The placeholder CHECK** is made again without the particle, before the drop (PostgreSQL would otherwise drop the
   whole constraint with the column).
5. **The drop** of both columns; their own CHECKs and column grants go with them. `complete_setup_family` needed no
   change: its current version (0020) names neither column.

`FORCE ROW LEVEL SECURITY` on `people` is lifted and put back as in 0024 (tested under an owner that is not a superuser).

**What an admin does with a leftover row:** shorten that person's surname in the app (Edit details), typing the particle
in, then delete the row (`DELETE FROM people_surname_particle_leftover WHERE person_id = '<id>'`, as the owner). **The table
can be emptied once the surname is shortened**; an empty table is harmless and stays. UPGRADE.md has the commands.

The upgrade test seeds one such row by SQL on the previous release and checks the leftover table, the NOTICE and the dropped
columns; `migration-0025.test.ts` and `backup-restore.test.ts` cover the rest (schema 23 and 24 archives).
