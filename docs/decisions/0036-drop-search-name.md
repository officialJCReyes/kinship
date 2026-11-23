# 0036. Dropping people.search_name (#33)

- Status: **Accepted** (decisions by JC, step 38)
- Date: 2026-11-23
- Amends: [0005 People, relationships and who may change them](0005-people-and-relationships.md) (name search reads `search_names`), [0008 Second and married surnames](0008-names-and-widowed.md) (the contract step it promised), [0024 Names](0024-names.md) ("dropping it is a later, separate step": this is it)
- Migration: `0023_drop_search_name.sql`

## Context
Migration 0007 (0.2.0) added `people.search_names`, a generated search column over the given name and all three surnames, and
moved the API onto it. The old generated column `people.search_name` (0003, given name and surname only) was kept for one release
as the "expand" half of expand-then-contract, so that the previous release could still run against the new schema. 0017 rewrote
`search_names` in place (ADR 0024) and left `search_name` alone. 0.2.0 and 0.2.1 have shipped; no supported release reads it.

## Decisions
- **0023 is one plain statement: `ALTER TABLE people DROP COLUMN search_name;`** No `IF EXISTS` (every database that reaches
  0023 ran 0003, so the column is there; a database where it is missing is not one KinShip made, and should stop). No `CASCADE`:
  nothing is built on the column (no index, view, function, trigger or other generated column), and if that ever stopped being
  true the migration must fail rather than silently drop the dependant.
- **Nothing to revoke.** The app role reads `people` through a table-level `SELECT` (0003); there is no column grant on
  `search_name`. The protections fingerprint a backup records lists column grants, so it is unchanged by the drop.
- **Lock.** Dropping a column edits the catalog only; PostgreSQL does not rewrite the table, also not for a stored generated
  column. It takes an `ACCESS EXCLUSIVE` lock on `people` for a moment, at start-up, before the api serves requests, after the
  pre-upgrade safety copy is written. It waits only for transactions already open on `people` (none at start-up). No
  `lock_timeout` is set, as for every other migration.
- **Commit type `chore(api):`.** Nobody can see the change, so it gets no CHANGELOG line and does not move the version. The release
  manifest's `migration` flag comes from the file diff (`scripts/release-info.mjs`), not from the commit type, so it is still true.
- **Who verified what nothing reads it:** a search of the whole repository and of `v0.2.1` (only type definitions, comments,
  tests and prose named it; `store.ts` searched `search_names` in both). The tests that named it now use `search_names`:
  `scale.test.ts` (the raw search plan), `roles.test.ts` (the app role cannot write a generated column; the old target would
  have failed with "column does not exist" and still passed the test's pattern), `contract.test.ts` (the column list).

## Going back, and older backups
- **The pre-upgrade safety copy** (`pre-upgrade-0016-to-0023.tar.enc` from 0.2.1) is a dump taken before the migration, so it
  holds the column. Restoring it with the 0.2.1 image works exactly as before. Running the 0.2.1 image against the upgraded
  database without a restore was already impossible (the schema is ahead from 0017 on), so the drop does not make going back
  harder: going back is a restore of the safety copy.
- **A backup from schema 22 or older restored into a build that has 0023** replays the dump (with the column), passes the row
  count and protections checks, commits, and then runs the newer migrations, which drop it again. `migration-0023.test.ts`
  proves it for a schema 16 backup (0.2.0 and 0.2.1).

## Consequences
- `apps/api/src/db.ts` no longer names `search_name`.
- The other "contract" left from 0017, `users.surname_choice`, stays for now; it has its own issue.
