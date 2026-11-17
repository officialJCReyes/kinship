# 0018. A place for a relationship

- Status: **Proposed** (a draft pull request; not for 0.2.0)
- Date: 2026-11-17
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0008 Second and married surnames](0008-names-and-widowed.md)
- Source: JC's brief for step 19 (the marriage location). This record also notes where it differs from ADR 0008.

## Context

A relationship (`unions`) has a status and two optional dates (start, end) but nowhere to say where it began. ADR 0008 listed "marriage place" as out of scope until **0.5, with Places**. JC has asked for a plain optional place now.

There is no place data anywhere in the app yet: people have no birth or death place columns, and there is no places table or place component. So there is nothing to reuse, and the brief's fallback applies: a plain text field.

## Decision

- `unions.place`, free text, optional (migration 0015). `NULL` means none. Trimmed, 1 to 200 characters (`PLACE_MAX_LENGTH`, `CHECK`); the API turns a blank value into `NULL`, normalizes to NFC and refuses control characters (`invalid_place`).
- Additive, nullable, no default, no backfill: no existing row changes, so the expected upgrade data checks are the same. `GRANT INSERT (place)` and `GRANT UPDATE (place)` to the app role, like the other editable columns; the row-level security policies are untouched (a Member may write the place of a relationship they are in, nobody else's).
- API: `POST /api/unions` and `PATCH /api/unions/:id` take `place` (string or null); every union in a response has `place` (string or null). A PATCH without `place` keeps it.
- Web: a **Place (optional)** text field in the relationship form (used by Add relative > partner and by Edit relationship), and a line "Place: …" under the partner in the chart's person panel.
- Deliberately **not** in this change: the profile page's relationship card, the relationship line's tooltip, reports and GEDCOM. They are one-line additions each when wanted.

## Consequences

- **0.5 Places.** When a places table arrives, `unions.place` is read into it (match or create a place from the text), then the column can be retired in a later contract migration. Nothing here has to be undone first. Keeping the column name `place` leaves `place_id` free for that.
- **Backup and restore** need no code or format change: the dump is a whole-database `pg_dump`, so the column is in it, and an older backup (schema 14) restores and migrates to 15 like any other older backup. `docs/backup-format.md` does not list columns. Tests that name the newest schema number moved to 15 (`backup-restore.test.ts`).
- **The upgrade test** derives the expected `to_schema` from the newest file in `apps/api/migrations`, so it expects 15 by itself, and its data digests do not read the new column.
- **If this ever ships in 0.2.0** the release notes that name the schema range need the new number: `UPGRADE.md` ("pre-upgrade-0006-to-0014", "migrations 0007 to 0014"), the `CHANGELOG.md` 0.2.0 line "migrations 0007 to 0014", and the in-app "What's changing" text, which reads the schema range from the database and so updates itself.
