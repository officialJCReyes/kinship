# 0008. Second and married surnames, and the automatic Widowed status

- Status: **Accepted** (decisions by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0007 Birth and adoptive parent links](0007-adoption-parentage.md)
- Sources: `design/kinship-v2-requirements.md` (names, partner relationships), `design/kinship-release-and-deployment-plan.md` (0.2). Where the mockup stores a display choice by rewriting the surname, this ADR follows the requirements doc instead: the choice is a per-viewer setting and the stored names never change.

## Context

0.2 starts the data promise, so this is the last easy moment to shape the name columns and to put the Widowed rule where no code path can skip it. Migration `0007_names_and_widowed.sql` is additive (expand only); 0.1.0 is the baseline.

## Names

- `people.surname` stays the **birth surname** (the first or paternal surname). `second_surname` (the maternal surname) and `married_surname` are optional, each trimmed, 1 to 100 characters, NULL when unset. A blank value from a client means "none".
- **Display rule**, in one shared helper (`displayName`, web app, PR 2): given name, then surname, then second surname when set. When a married surname is set **and chosen**, it replaces both surname fields. The default choice is "married when set"; the per-viewer control arrives with My settings (a `users` column). The rule is a cultural default and can change in a later step without a data change.
- **Search** reads a new generated column `people.search_names` (given name and all three surnames, lower-cased and accent-free). The old `search_name` is kept for one release and dropped later (expand, then contract): issue opened for that. Lists sort by surname, then second surname (none first), then given name (index `people_name_order_v2_idx`). The list cursor now carries the second surname; a cursor in the old shape is refused with `invalid_cursor`.
- **For later:** GEDCOM export, the reports and the Records request sheet must write **both** surnames (and the married one where it applies); nothing about them is built now.

## Automatic Widowed

Rules, enforced by two triggers in the database so the API, the CLI and any future import all behave the same:

1. A person becomes deceased: each of their `married` relationships becomes `widowed` with `status_auto = true`. No other status ever changes.
2. A person becomes living again: a relationship reverts to `married` only when it is `widowed`, `status_auto` is true and **neither** partner is still deceased. A status set by hand is kept.
3. A relationship saved as `married` while a partner is deceased is stored as `widowed`, `status_auto = true` (the API tells the admin through `statusAuto` in the response, and checks duplicates against the stored status).
4. Any change of status by hand sets `status_auto = false`. The app role has no privilege on `status_auto`, so a change to that column can only come from the triggers.

   **Saving the same status by hand (migration 0008).** A trigger cannot see that an admin saved "Widowed" over an automatic Widowed, because the value did not change, yet that is a choice that must become permanent. So `PATCH /api/unions/:id` sets one transaction-local setting, **`kinship.union_status_by_hand`**, to `on` when (and only when) the body includes a `status`, in the same transaction as the one UPDATE (`set_config(..., true)`, never at session level), and back to `off` straight after it. The trigger honours it only for an UPDATE that does not itself write `status_auto`; the deceased trigger and rule 3 always write `status_auto` themselves (to true, or back to false on a revert), so they ignore it. A PATCH without a status (dates) leaves `status_auto` alone. Tests cover the setting not carrying over to the next request on the same connection, and one union's PATCH not changing another's `status_auto`.

   **What the web app says.** The "N marriages were set to Widowed automatically" notice is shown only for transitions the server reports (the person's relationships are read before and after the save and compared on `status` and `statusAuto`); nothing is guessed in the browser. An admin editing an automatic Widowed relationship sees "Set automatically; saving a status here makes it permanent.".

Data from before the migration follows rule 3: a Married relationship with a partner who is already deceased is Widowed after the upgrade.

**Why triggers use extra policies.** Row-level security is forced on `people` and `unions`, so it applies to the owner role that runs the `SECURITY DEFINER` trigger functions, and a Member may change only the relationships they are in. The migration therefore adds three narrow policies **for the owner role only** (`people` select, `unions` select and update). Each is open only while a trigger function has set the transaction-local setting `kinship.widow_internal` to `on`; at any other time the owner sees exactly what it saw before. The app role is not the owner and not a member of it. Tests cover a Member marking a descendant deceased in a relationship they are not in, with a non-superuser owner. The policies name the role that ran the migration; an installation that later renames its owner role would need them re-created (the migration runner always runs as the owner, so a fresh install is unaffected). Tracked in [#35](https://github.com/officialJCReyes/kinship/issues/35): re-check it in the backup role ADR (step 16a) and add a case to the upgrade test.

## Consequences

- `Person` gains `secondSurname` and `marriedSurname`; `Union` gains `statusAuto`; new error codes `invalid_second_surname` and `invalid_married_surname`.
- The test family's Walter (deceased) and Rosa are now Widowed, as in the mockup.
- Out of scope here: marriage place (0.5, with Places), the surname display setting UI and date format (step 13), the finder's step names (0.3).
