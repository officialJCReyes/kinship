# 0013. The first-run wizard writes everything in one transaction

- Status: **Accepted** (decisions by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0003 Accounts and sessions](0003-accounts-and-sessions.md), [0005 People and relationships](0005-people-and-relationships.md), [0008 Names and Widowed](0008-names-and-widowed.md), [0011 Display settings](0011-display-settings.md)
- Sources: `design/kinship-v2-requirements.md` ("First-run setup wizard"), the mockup's setup screens, the step 15 brief. Where they differ, the brief won (see "Where this differs from the design docs").

## What it is

The setup page becomes a seven-step wizard: **Account, Tree, You, Partner, Parents, Children, Review**. This record covers the API side (migration 0012, PR 1); the pages follow in later PRs.

## Nothing is written until Review

The browser keeps everything in memory (React state) and sends **one** `POST /api/setup` at the end. A refresh or a closed tab restarts the wizard; nothing personal is put in `localStorage` or `sessionStorage` (the color-scheme mirror from ADR 0011 holds no personal data). The alternative, creating the account on step 1 and the people as the person goes, would leave a half-made tree and a SuperAdmin account whenever someone walks away, and would need a second, weaker credential (the account's session) to be handed out before the person has seen what will be created.

## The setup token is checked early

The token is typed on step 1. `POST /api/setup/check {token}` answers **204**, or **403 `invalid_setup_token`**, so a wrong token is found before the person has typed the rest. It uses the same cheap `check_setup_token` and **the same failure limiters** as `POST /api/setup` (10 failures per 15 minutes per address, 30 for everyone) and the same 30 requests a minute per address cap, so the check is not a second way to guess. A wrong check counts as a failure; a right one does not. The token is sent again with the final request (it is a credential, not a session). The check answers `409 already_set_up` once an account exists, and does not count that as a guess.

## One database function, one transaction

`POST /api/setup` takes an optional **`family`** object (`packages/shared/src/setup.ts`): `you`, `partner` (with its status), `parents` (father, mother, and their relationship), and `children[]` (each with `otherParent: 'partner' | 'none'`). When it is present the API calls `kinship_auth.complete_setup_family(token_hash, email, name, password_hash, tree_name, settings, family)` (migration 0012). It:

1. takes the same advisory lock as `complete_setup` (7302041119), so two finishes take turns; the second finds an account and gets `KS001` (`already_set_up`); exactly one wins;
2. re-checks that no account exists and that the token matches (`KS001`, `KS002`);
3. creates the account (with its display settings), the tree, and then, **as that account** (`kinship.user_id` is set for the transaction, as `complete_setup` does, so the row-level security policies, the cycle check and the Widowed triggers all run as for any other write): the "you" person (linked on `users.person_id`), the partner and their relationship, the father and the mother and their relationship, your link to your parents, the children, and the children's links;
4. deletes the setup token, last.

Any failure raises and **everything rolls back, the account and the token deletion included**; the token stays valid. Tests make each insert fail in turn (11 stages) and check zero accounts, trees, sessions, people, relationships and parent links afterwards, and that the same request then succeeds. Five simultaneous finishes make one account and four `already_set_up`.

The function trusts the shape of the JSON (the API has cleaned every value) but not its content: the table constraints, triggers and policies still apply. Two small helpers, `setup_insert_person` and `setup_insert_union`, are executable by the owner only.

### The legacy form

The seven-argument `complete_setup` stays: scripted installs that send `person` (or nothing) still work, and `settings` sent without a `family` is still saved by a second statement as before. `person` together with `family` is refused (`invalid_request`, field `family`). Migration 0012 **drops the five-argument `complete_setup`** (issue #9: no caller since alpha.2; nothing else depended on it). The seven-argument one goes in a later contract step; this is noted on the issue.

## Validation, and errors that name the field

Everything is checked **before any write and before the argon2 hash**, after the token (a wrong token costs one indexed read, as in ADR 0003). The family is checked with the same code as adding a person by hand (`cleanName`, `parseDateInput`, `parsePersonInput`), field by field. An error is `{ "error": code, "field": path }`, where the path points into the request body: `email`, `password`, `settings.theme`, `family.you.birth`, `family.partner.status`, `family.children.1.birth`. The wizard maps a path to a step and a field (`setupStepOfField` in `packages/shared`), goes back to that step, and focuses the field. Account-level errors (`invalid_email`, `invalid_display_name`, `invalid_tree_name`, `password_too_short`, a bad setting) carry a field too. New codes: `widowed_needs_deceased`, `too_many_children`, `other_parent_needs_partner`.

## Rules

- **Everything created is a birth link.** No adoption in the wizard.
- **Gender** is optional for you, the partner and each child (`null` is "Not specified"); a father is stored as male and a mother as female, by their label.
- **Partner:** one relationship between you and the partner, with one of six statuses (Married, Engaged, Partner, Separated, Divorced, Widowed). No dates are collected, so Divorced and Separated have no end date (the database allows that). A married surname is kept only for Married and Widowed. **Widowed requires Deceased** (`widowed_needs_deceased`). **Married plus Deceased becomes Widowed automatically** through the existing trigger (`status_auto`); nothing in the function sets it.
- **Parents:** both entered gives one relationship between them (status default Married) and you hang from it; one entered, you hang from that parent alone. The same Widowed rule applies (at least one of the two deceased). With both deceased and Married, the trigger makes it Widowed (tested). Deceased is stored as `deceased = true` with no death date.
- **Children:** at most 30. `otherParent: 'partner'` hangs the child from your relationship with the partner and needs a partner (`other_parent_needs_partner`); `'none'` hangs the child from you alone. The mockup's "Add later" is dropped.
- **Warnings are soft and never stored.** `parent_too_young` (`MIN_PARENT_AGE_YEARS` is 12, already in `packages/shared`) is computed in the browser and does not block; a test sends a child born before their parent and gets 201.

## Consequences and known gaps

- If the response to the final request is lost after the commit, a retry gets `already_set_up`, and the credentials work on the sign-in page.
- The wizard's own `family` shape is part of the setup API: a script can use it, but nothing promises it beyond 0.x.
- Same people, same names (two people with the same given name, surname and birth date) are allowed; the web shows a soft note.
- Not built: siblings, grandparents, profile photos, GEDCOM import, adoption in the wizard, multiple trees (all outside step 15).

## Where this differs from the design docs

- The mockup's step 5 offers "Add later" as a child's other parent, and its last button is "Open my tree"; the brief drops the first and calls the button "Create my tree".
- The mockup's last step mentions Authentik and renaming the tree later; the brief replaces them (invite relatives under Admin → Users).
- The requirements doc lists the partner's "birth surname" only; the wizard also takes the given name, status, deceased and gender.

## Amendment (after 0.2.0-rc.1): the partner's date of birth

The partner may now have an optional `birth` (`{ value, precision }`, partial and approximate dates like yours and your children's), checked with the same `parseDateInput` and stored by the same `setup_insert_person` function, which already read `birth` for any person, so there is no migration. Empty means no date and never blocks the step. "No dates are collected" in the Partner bullet above still holds for the relationship itself.

