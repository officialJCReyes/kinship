# 0019. Unknown parents (placeholders), and the success pill

- Status: **Accepted** (decisions by JC, 2026-11-18, after the step 22 phase 1 report)
- Date: 2026-11-18
- Builds on: [0005 People and relationships](0005-people-and-relationships.md), [0007 Adoption](0007-adoption-parentage.md), [0014 Backups](0014-backup-and-owner-access.md), [0016 Upgrade test](0016-upgrade-test.md), [0018 Scope audit](0018-scope-audit-0.2.md)
- Migration: `0015_placeholder_people.sql`. It is the only migration of this step; linking an account to a person (#8) is 0016 in the next step. No test or safety-copy name may assume 0015 is the last one.

## Context

A brother or sister is not a record of its own: two people are siblings when they hang from the same parents. So someone with no parents on the tree could not be given a sibling ("Add a parent first"), and adding one parent first was the only way. MyHeritage solves this with unknown parents. The decision is to do the same.

## Decisions

### What a placeholder is
- A **real `people` row** with `is_placeholder = true`: no name (`''`), no dates, not deceased, no second or married surname, no facts. A separate table was rejected: a placeholder must be a parent in `person_parents` and a partner in `unions`, and naming it must be one UPDATE.
- `gender` is `male` ("Unknown father") or `female` ("Unknown mother") **for the label only**. It is never drawn and never shown as a sex: not in the border colour (a placeholder is neutral and dashed), not in the accessible name ("Unknown father, add details"), not in the side panel, not in the profile's Facts.
- Check constraints: the two name checks become `is_placeholder OR (...)`; `people_placeholder_is_blank` says a placeholder has no dates, no deceased flag, no other surnames and a male or female gender. Every existing row gets `false`. Expand only; no contract step.
- Row-level security is unchanged: the `people_*` policies decide who may insert, change and delete a row. The column is granted explicitly to the app role. Only an admin creates a placeholder (the route is admin-only) and only an admin may edit one (a Member cannot: the row was created by someone else).

### Adding a sibling (also the fix of #15 for this case)
`POST /api/people/:id/siblings` (admins), one transaction, no `createThenLink`:
- The person has parents of that kind: the sibling gets the same set (the same relationship, or the same single parent). **A second sibling reuses the pair. With one parent, that parent is reused and no placeholder is added.**
- No birth parents: two placeholders, one **Unknown** relationship between them, and both children linked to it. An adoptive sibling needs an adoptive set already (`sibling_needs_parent`).
- Any failure rolls everything back.

### Members
**Admin-only, unchanged.** No new SECURITY DEFINER function and no policy change. A Member gets the sibling cards disabled ("Ask an admin to add this relative") and a 403 from the route. Their rule, descendants only, is the Nov 14 decision in the requirements doc.

### Naming
`PATCH /api/people/:id` on a placeholder needs both a given name and a surname (`placeholder_needs_name` otherwise) and clears the flag. A named person is ordinary from then on and is not turned back.

### Deleting
Deleting a person runs `removeOrphanPlaceholders` in the same transaction: a relationship between two placeholders with no children goes, and so does a placeholder with no relationship and no child. Named people are never touched.

### "Real people only"
Lists, search, `ancestorCount`, `otherFamily.count` and any "N people" text count real people. One helper (`realPeople`) starts a listing. Every other read of the `people` table says what it does about placeholders with a `placeholders: included` comment, and a test (`placeholders.test.ts`) fails if a read has neither. The chart, by-id reads, the backup's row counts and the parent-age check include them on purpose.

### Rules for views and features that are not built yet
- **Relationship finder (0.3), Pedigree and Fan: a placeholder may be a hop on a path but is never a result and never a picker entry.** Two siblings through unknown parents are siblings only by passing through them.
- **Birthdays, reports and the medical and identity-number rules (0.4 to 0.7)** skip placeholders (they have nothing to report).
- **GEDCOM export (0.7)** skips placeholders and writes no parent link to one. A child who then has no parent in the file is written as having none.
- A person's "Add father" and "Add mother" cards are not offered once unknown parents fill the birth set; naming them is the way (an admin may still add adoptive parents).

### The success pill
Success messages are a small fixed pill at the top centre, removed after 5 seconds, paused while the pointer or keyboard focus is on it, with no button and no focus change. Warnings and the update notice keep their bars and the Dismiss button. The live region (`role="status"`, polite) stays mounted when empty. Under `prefers-reduced-motion` the pill disappears without a fade.

## Upgrade test
After an upgrade from any earlier release, `count(*) from people where is_placeholder` is 0 (asserted in every seed's `assert_seed_after_upgrade`). The seed for 0.2.0 (`seed-0.2.0.sh`, needed once v0.2.0 is tagged, since the next run starts from it) should copy `seed-0.2.0-rc.2.sh`, add a person with no parents and a sibling through the new route, and assert that the two placeholders, their Unknown relationship and the flag survive, and that they are absent from `GET /api/people`.

## Consequences
- A placeholder is visible data in a backup and in `pg_dump`; a restore brings it back.
- A person with unknown parents is not "orphaned": the chart shows two dashed cards above them.
- A placeholder pair for each person without parents is only created when a sibling is added, never by itself.
