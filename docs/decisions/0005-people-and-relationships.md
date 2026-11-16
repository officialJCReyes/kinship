# 0005. People, relationships and who may change them

- Status: **Accepted** (the approach and eleven open points were proposed to JC and approved as recommended, 2026-11-15)
- Date: 2026-11-15
- Builds on: [0001 Stack](0001-stack.md), [0003 Accounts and sessions](0003-accounts-and-sessions.md)
- Sources: `design/kinship-v2-requirements.md` (Partner relationships, Roles and edit scope), `design/kinship-tree-views-and-dna.md`, `design/kinship-release-and-deployment-plan.md` (sections 4 and 6)

## Context

0.1 needs people, partner relationships and parents, and the permission checks (Admin edits everything, Member edits their own profile and adds descendants, User reads) have to be real from the start. Alpha data may be wiped, but 0.2 promises forward-only migrations, so the schema has to be one that 0.2 can extend by adding columns and tables only (expand, never contract). The release plan lists the full relationship model for 0.2; this step builds the part of it that the tables and rules depend on.

## The schema

### Naming: `unions`

The partner-relationship table is called **`unions`**, not `relationships`. In the design docs a child "hangs from the union", the line between two partners. "Relationship" would also describe a parent link, which is a different thing.

### Parentage: one row per child

> Superseded in part by [0007](0007-adoption-parentage.md): from migration 0006 a child has one row per child **and kind** (birth or adoptive).

`person_parents` has **one row per child**, and the row says where the child hangs from: either a `union_id` (the child's two parents are that union's two partners) or a `parent_id` (the child has one parent on the tree). A `CHECK` requires exactly one of the two.

This models the rule from the requirements without anything to count:

- **At most two parents**: a child has one row, and a union has two partners.
- **No duplicate parent links**: `child_id` is the primary key.
- **A child with two unlinked parents gets an automatic relationship with status Unknown** (the API does this when a second parent is added to a single-parent child). If the two already have one union, that one is used. If they have several, the API answers `union_ambiguous` and asks which.
- **A child with one parent on the tree hangs from that parent alone**, even when that parent is married to someone else (Tomas in the test family hangs from Beatriz alone).
- **Changing a union's status never touches children.** Deleting a union that has children is refused (`union_has_children`); the status is changed instead.
- **Deleting a person** (admin, `?confirm=true`, `409 confirm_required` with counts without it) is done by a database trigger, so it holds for any deleter: children of a union that included the person keep the other partner as their single parent, children of the person alone lose their only parent, the person's unions are deleted, then the person. The foreign keys are `RESTRICT`, so a delete that skipped the trigger would fail loudly. A person linked to an account cannot be deleted (`person_has_account`).

`unions` stores the pair as `partner_a_id < partner_b_id`, so the same couple can never exist twice in two orders. The pair is **not** unique: the same two people can marry, divorce and remarry. The API refuses only an identical one (same status and start date). A union's partners cannot change (trigger); delete it and make a new one.

### Rules in the database, rules in the API

| Rule | Where |
|---|---|
| Given name and surname required, trimmed, 1 to 100 characters | `CHECK`, and the API (clearer error) |
| No self-parenting (`KS011`), a child cannot be a partner of the union it hangs from (`KS012`), no cycles (`KS013`) | trigger `kinship_check_parentage`, run for every insert and update of a parent link, behind an advisory lock so two concurrent writes cannot jointly create a loop. The walk is a recursive query up from the parents. |
| A union joins two different people | `CHECK` |
| End date only for divorced, separated, annulment | `CHECK` |
| Valid dates | domain `partial_date` plus the API |
| A Member's new person must be placed in the tree | deferred constraint trigger (below) |
| A parent should be at least about 12 years older than the child | **API only, a warning** (`warnings: [{code: 'parent_too_young'}]`). It is never stored and never blocks. It is checked when a child is added, a parent added, or a birth date changed. |

The 12-year rule is a convenience for the person typing, not a fact about the family (adoptive and unusual cases exist, and the data may be partial), so it lives in the API and is not enforced by the database. It is not in the design docs; it came from the step brief.

### Dates

A date is stored **as typed** (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`, validated against a real calendar, in the domain `partial_date`) next to a **precision** (`exactly`, `about`, `before`, `after`). For sorting and filtering each date column has two generated columns, `x_from` and `x_to`: the first and last day the text can mean (`1955-02` is `1955-02-01` to `1955-02-28`). The precision does not change them; it changes how the date is read (`before 1950` sorts at 1950-01-01, but 1950-01-01 is not a bound on when the event happened). The migration comments say so, so whoever first filters on a date applies the same reading.

### Other choices

- **Ids** are `uuidv7()` (new in PostgreSQL 18): ordered by creation, so index inserts stay local.
- `surname` is the **birth (maiden) surname** from the start; a married surname is a later, additive column.
- **Left for later, on purpose:** `married_surname`, custom labels, the automatic-Widowed flag, places, cause of death, sources, notes, photos (0.2 to 0.5); soft delete and merge tombstones (0.5); alternate names (1.5).
- The hand-written Kysely types in `db.ts` are checked against `information_schema` by a test, instead of adding a code generator (ADR 0001 expected one).

## Accounts and people

`users.person_id` (nullable, unique, `ON DELETE SET NULL`) links an account to at most one person. That is the smallest link that makes the permission checks real; the Users page, linking others and invitations come with 0.4. First-run setup (`POST /api/setup`) takes an optional `person: {givenName, surname}` and, when given, creates the first person and links it, inside the same function and transaction as the account (`kinship_auth.complete_setup`, a new seven-argument version; the old five-argument one stays and can be dropped in a later contract step). The web setup page does not send it yet (step 9).

## Row-level security

- **One setting reaches Postgres**: `kinship.user_id`, set per request transaction (`set_config(..., true)`), as in ADR 0003. The account's role and linked person are **looked up inside the database** by `SECURITY DEFINER` helpers with a fixed `search_path` (`kinship_role()`, `kinship_person_id()`, `kinship_is_admin()`, `kinship_in_my_line()`). There is no second setting that could disagree with the `users` table.
- **Everyone signed in (with a real account) reads the whole tree.** A made-up user id sees nothing. Writes follow the table below. Medical and DNA data get their own tables and policies in 0.6.

| | people | unions | person_parents |
|---|---|---|---|
| SuperAdmin, Family Admin | everything | everything | everything |
| Member | change their own person and people they added who are still in their line; add a person only as a child, below | change status and dates of a union they are a partner in | add a link for a child they just added, under themselves or a descendant (or a union that includes one) |
| User | read | read | read |
| Delete | admin | admin | admin |

"In my line" means the Member's own person or one of their descendants (the walk goes up from the candidate, a short walk). A Member cannot delete, cannot add parents, partners or siblings, and cannot create or delete unions.

- **Column grants** back the policies: the app role has no right to change `id`, `created_by`, `created_at`, the generated columns, or the partners of a union.
- **A Member's person cannot be left outside the tree.** A policy cannot see the link that is inserted after the person row, so a **deferred constraint trigger** checks at commit that a person created by a Member has a row in `person_parents`; otherwise the whole transaction fails (`KS010`).
- The API repeats every check before the database is reached, so a refusal is a clear `403 forbidden`; the policies are the backstop. The role-by-role test table runs every case twice, through the API and as direct SQL under the app role, against the same expected answers. One nuance it found and the policies allow: a Member may link a person they themselves created, and who has no parent, under their own line. That has the same effect as adding a child, is no escalation, and the API does not expose it.
- **FORCE.** Row-level security is **enabled and forced** on `people`, `unions` and `person_parents`. It is **not forced on `users` and `family_tree`** (0002): the `SECURITY DEFINER` functions for sign-in and setup run as the owner, and forcing the policies on the owner hides every account from them. `non-superuser-owner.test.ts` proves it (with FORCE on `users`, `find_login` finds nobody) and also proves the new tables, sign-in, setup and the Member rules all work when every migration runs as a plain role that is not a superuser, which is the option ADR 0001 offers self-hosters. For the new tables, setup acts as the new account (it sets `kinship.user_id` inside the function and restores it) so the person insert passes the same policy as any other. Superusers bypass row-level security regardless; FORCE only matters when the owner is a plain role.
- A consequence worth knowing: under FORCE with a non-superuser owner, a script run as the owner with no user set sees no people. Restores and maintenance as the owner need a superuser or a `set_config` first.

## Search, the tree and speed

- **Name search** is accent- and case-insensitive: `people.search_name` is a generated column, `lower(kinship_unaccent(given || ' ' || surname))`. PostgreSQL's `unaccent()` is only STABLE (it looks up its dictionary through `search_path`); the wrapper names the dictionary explicitly (`public.unaccent`), so it is honestly `IMMUTABLE` and can be a generated column or be indexed. Every word typed has to match. Paging is keyset (name, then id), with an opaque cursor.
- **No trigram index.** Measured with 2,000 generated people (test `scale.test.ts`): the search runs in **0.26 ms in the database** (a sequential scan over `search_name`) and 6 to 12 ms through the API. An index would add an extension and write cost for no visible gain. Revisit at the 10,000-person load test of 1.0-rc.
- **The tree** (`GET /api/tree/:personId?up&down&collateral`) is a recursive walk over the indexed parent links plus three lookups by id, so it takes a handful of queries however large the family is: **14 to 20 ms for 161 people out of 2,000**, 11 ms for a whole 161-person line. `collateral=true` also returns the other descendants of the topmost ancestors, as far down as the focal person plus `down`, which is what the Family tree view draws; Pedigree uses `up` only, Descendants `down` only. A person's own parents are included only up to `up`; `hasParents` tells the chart whether to offer the leaf for an in-law.
- **JIT is switched off for the recursive walks.** Postgres cannot estimate a recursive query and guesses millions of rows, so it compiled the tree query with JIT for about 140 ms to save microseconds (the same walk took 12 ms to 20 ms once off). The tree transaction runs `set local jit = off`, and the functions that walk (`kinship_check_parentage`, `kinship_in_my_line`) have `SET jit = off`.

## Request cap

The people, relationship and tree routes are capped at **600 requests a minute per signed-in account** (`@fastify/rate-limit`, keyed by account, not by address, because behind a reverse proxy every visitor can share one address unless `TRUST_PROXY` is set). It is generous for a person clicking around and stops one account from hammering the tree and search queries. Sign-in and setup keep their own, stricter limits (ADR 0003). API-wide limits and session management are still planned for 1.1.

## Shared package

`packages/shared` is now **compiled** (`tsc`, to `dist/`), and the API imports it as a normal workspace dependency; the api image builds it and copies it in. The API response types, `MIN_PASSWORD_LENGTH`, the error codes, the warning codes and the route table (method, path, who may call it) live there. The web app and the API tests still use the TypeScript source directly (a Vite alias and a `paths` entry), so they need no build step. `contract.test.ts` checks that the API registers exactly the routes in the table, that every error code has an English message (`error.<code>`), and that the hand-written database types match the tables.

## Consequences and known gaps

- No UI. The web app's `AuthUser` type gained `personId`; the setup page does not send a person yet (step 9).
- No way yet to link or unlink an account and a person other than setup and direct SQL (Users page, 0.4). A person linked to an account cannot be deleted until then.
- The "automatic Widowed" behaviour and the relationship naming (step, half, in-law, cousin titles) are not built.
- Optimistic concurrency (two admins editing one person) and change history are not built (0.5).
- The advisory lock serializes parent-link writes; fine for a family, not for bulk imports (GEDCOM import in 0.7 should write in one transaction).
- Fonts, places, sources and the rest of 0.2 are untouched.
