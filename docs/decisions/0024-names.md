# 0024. Prefix, suffix, nickname, surname particle, and how a married woman's name is shown

- Status: **Accepted** (decisions by JC, 2026-11-19 and 2026-11-20)
- Date: 2026-11-20
- Amends: [0006 The Family tree chart](0006-tree-view.md) (what a card shows), [0011 An account's own display settings](0011-display-settings.md) (the surname choice)
- Amended by: [0038 The surname particle is part of the surname](0038-surname-particle-folded.md) (the particle is folded into the surname by migration 0024 and the app no longer reads or writes it)
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0008 Second and married surnames](0008-names-and-widowed.md)
- Sources: `design/kinship-tree-settings-and-search.md`, `design/kinship-gedcom-coverage.md`, the mockup's Add relative, Edit details and My settings, Names.

## Context

0.3.0 adds four optional parts of a name and widens one setting. The data is new person data, so it needs a forward-only
migration (0017). JC's own MyHeritage choice for married women is "Maiden name (Married name)", and he wants it as the
default for everyone, existing accounts included.

## The data

Four optional columns on `people`, each trimmed, with the same `CHECK` pattern as `second_surname`, `NULL` when unset (a blank
value from a client means none):

| Column | Example | Limit |
|---|---|---|
| `name_prefix` | Dr., Sir, Dra. | 30 characters |
| `name_suffix` | Jr., II | 30 |
| `nickname` | Danny | 100 |
| `surname_particle` | de, de la, van | 30 |

`surname` stays the **bare** birth surname ("Cruz" for "de la Cruz"), so sorting ignores the particle and the list cursor is
unchanged. A placeholder ("Unknown father") has none of them: the `people_placeholder_is_blank` check of 0015 is extended.
The app role gets `INSERT` and `UPDATE` on the four columns; row-level security is by row and does not change.

On accounts: `users.name_form` (four values, default `maiden_married`), `show_prefix` and `show_suffix` (default true). The
app role gets `SELECT` and `UPDATE` on them like the other settings (ADR 0011).

## The setting, and what happens to existing accounts

`surname_choice` (`married` or `birth`) is replaced by `name_form`:

| Value | Rosa Mendez, married name Hale |
|---|---|
| `maiden_married` (default) | Rosa Mendez (Hale) |
| `married_born` | Rosa Mendez Hale (born Mendez) |
| `married` | Rosa Mendez Hale |
| `maiden` | Rosa Mendez |

**Migration rule:** an account on `married` (the column default, which almost nobody chose) becomes `maiden_married`; an account
on `birth` (always a choice) becomes `maiden`. The old column had no "was chosen" marker, so an account that actively picked
`married` moves too; that is accepted, and the What's new popup says so. `surname_choice` stays through this release (expand,
then contract), is no longer read or written, and is dropped later.

The API replaces `surnameChoice` with `nameForm`, `showPrefix` and `showSuffix` in `PATCH /api/auth/me`, the sign-in and `me`
responses, and the setup `settings` object. This is a breaking change for scripts that send or read `surnameChoice`
(`UPGRADE.md`).

## How a name is composed (`displayName` in `packages/shared`)

`[prefix] given [particle] surname [second surname] [suffix]`, where the surname part follows the account's form:

- **Maiden** is the particle, the surname, then the second surname ("de la Navarro Ortiz"). **Married** is `married_surname`.
- **A leading maiden name inside the married surname is stripped** before it is shown in brackets, ignoring case and accents,
  whole words only: "Mendez Hale" with maiden "Mendez" shows as "Rosa Mendez (Hale)". The surname plus second surname is tried
  first, then the surname alone. A hyphen does not count as a word break ("Mendez-Hale" stays whole). `married_born` and
  `married` show the married surname as stored.
- **A person with no married surname, or one that adds nothing to the maiden name, shows the maiden name in every form.**
- The particle belongs to the birth surname, so it is never written before a married surname.
- The prefix and suffix appear only when the account's switches are on. The nickname is never part of a displayed name: it is
  shown on the profile (Facts) and found by search.
- Initials skip the particle ("Beatriz de la Cruz" is BC).

The stored names never change; this is a per-viewer display rule, as in ADR 0008.

## Amendment to ADR 0006: the card

The card used to say "the card never shows the birth surname". It now shows the name in the viewer's form, so by default the
maiden name is on it. ADR 0006's wrapping stays: up to three lines, the font steps down for that card only, nothing is cut. The
longest realistic name tried ("Dra. Beatriz de la Navarro Ortiz (Hernandez-Hale) Jr.") needs three lines at 12 px, and 11 px
with the deceased dagger (attached with a no-break space); no name overflows. The accessible name of a card is the same display
name (a test pins it), so a screen reader hears the maiden name, prefix and suffix too, and never the nickname. The selected
person's panel shows a separate "Birth surname" line only in the Married name form, where the maiden name would otherwise be
missing.

## Search

`people.search_names` is the same column with a new formula: prefix, given name, nickname, particle, surname, second surname,
married surname, suffix, lower-cased and accent-free. Every word typed must match, as before. So a person is found by "Danny",
"de la cruz", "cruz", "Dr." or "Jr.".

**An exception to expand-then-contract (decided with JC, 2026-11-20).** The formula is changed in place with
`ALTER TABLE ... ALTER COLUMN search_names SET EXPRESSION` (PostgreSQL 17 and later; verified on 18), which rewrites the stored
column. A new column would have kept the old one for one release, but this is safe without it: the previous release only reads
`search_names` with `LIKE`, and the new text contains the old text's words, so the old code still searches correctly. A
rollback is a restore of the safety copy as usual. Nothing is built on the column (no index, view or generated column), so
the statement is not refused. The old `search_name` column is left alone; dropping it (#33) is a later, separate step.

## Matching rules (for 0.5 transcription and 0.7 import; nothing is built now)

When people are compared, prefix and suffix are dropped, the particle is optional, and the nickname counts only as an alias of
the given name. This agrees with `kinship-transcription-engines-and-matching.md`.

## GEDCOM mapping note for 0.7 (no import is built)

`NPFX` is `name_prefix`, `NSFX` is `name_suffix`, `NICK` is `nickname`, `SPFX` is `surname_particle`. A comma-separated `SURN`
maps to `surname` plus `second_surname`. `TITL` (a title of nobility) is a separate event and not the prefix. A vendor tag such
as `_MARNM` (married name) goes to the skipped list. Export writes the four fields back. See
`kinship-gedcom-coverage.md`.

## Consequences

- `Person`, `PersonInput`, `AuthUser`, `UserSettings` and `PATCH /api/auth/me` change (see above). New error codes
  `invalid_name_prefix`, `invalid_name_suffix`, `invalid_nickname`, `invalid_surname_particle`, `invalid_name_form`,
  `invalid_show_prefix` and `invalid_show_suffix`; `invalid_surname_choice` is gone.
- The setup wizard asks for no new fields; `complete_setup_family` takes the new settings.
- Design docs now behind (in `design/`, not edited here): the release plan and the tree-settings doc (the settings), the
  requirements doc ("Maiden and married surnames": the setting now has four forms), and the mockup's "Surname shown on the
  tree" select in the marriage form (not built).
