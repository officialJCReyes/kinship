# 0020. Linking an existing account to a person (#8)

- Status: **Accepted** (decisions by JC, 2026-11-18, after the step 23 phase 1 report)
- Date: 2026-11-18
- Builds on: [0005 People and relationships](0005-people-and-relationships.md), [0012 Account links](0012-account-links.md), [0018 Scope audit](0018-scope-audit-0.2.md), [0019 Placeholder parents](0019-placeholder-parents.md)
- Migration: `0016_link_account_person.sql`. Additive: five functions added, one replaced, no table, column or data change. No test or safety-copy name may assume 0016 is the last migration.

## Context

An account ties to one person (`users.person_id`, 0005). It is set at first-run setup and when an invitation naming a person is accepted. Accounts made by an alpha or a release candidate can have no person (the setup person and the invitation's person were optional), and then Home says "not linked", "My profile" is missing and a Member can edit nothing. The app role cannot write the column: it has no UPDATE grant, and the policies on `users` let an account change only its own row, so a plain grant would let an account link itself to anyone. ADR 0018 pulled #8 into 0.2.0 for this reason; linking SSO identities stays in 0.4.

## Decisions

### Scope
Link, **change** and **unlink** are all part of #8 (a link made to the wrong person must be fixable without SQL). The role changes, disabling and deleting accounts (#56, #57) stay in 0.3 and do not need these routes.

### Who may link whom
One rule, in `kinship_auth.can_link_for` (SQL) and `canLinkPerson` (shared, for the page; a test compares them for every pair of roles):
- a **SuperAdmin** links any account;
- a **Family Admin** links **Member** and **User** accounts, and **their own**; never a SuperAdmin or another Family Admin;
- anyone who may manage accounts may link **their own** account (a SuperAdmin from an alpha who has no person is the main case);
- a Member, a User and a signed-out caller get 403 and 401.

### What is enforced, and how
- **One person to at most one account, one account to at most one person:** the existing `UNIQUE (person_id)` on `users` (0005) is the last guard, and the functions check first and map a lost race to `person_already_linked`. The account side is the column itself.
- **Order of checks** (`kinship_auth.check_link`): the caller is an admin and the hierarchy allows it; the account exists; the person exists and is **not a placeholder**; no other account has the person; the person has **no open invitation**. Then the caller's idea of the current link must match (below).
- **A person with an open invitation is refused** (`409 person_has_open_invitation`; the message says to revoke the invitation first). There is no automatic revoke: accepting the invitation would otherwise fail for the invitee with the one generic invalid-link answer. An expired invitation does not count.
- **Stale pages:** the PUT body carries `currentPersonId` (what the page believes the account is linked to) and the DELETE carries the same in its query. A mismatch is `409 account_already_linked` and nothing changes, so two admins cannot overwrite each other unseen. Linking the person the account already has is a no-op (200, no log line).
- **Placeholders** are never offered (the picker lists real people only, ADR 0019) and never accepted (`409 person_is_placeholder`).

### The functions (migration 0016, `kinship_auth`)
`can_link_for`, `check_link`, `link_account_person`, `unlink_account_person`, `link_preview`. All `SECURITY DEFINER` with `search_path = pg_catalog, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` to the app role **by name**. 0011's `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kinship_auth` form is deliberately **not** repeated: it would give the app role `setup_insert_person` and `setup_insert_union`, which 0012 keeps out of its reach (the first draft of 0016 did exactly that; `migration-0016.test.ts` and `non-superuser-owner.test.ts` now fail if it happens again). `people` has forced row-level security, and these run as the owner; they read people through the signed-in admin's `kinship.user_id`, which is still set, as `create_invitation` does. A test runs them as a role that is not a superuser.

### The routes (admins only; 403 for other roles, 401 signed out; never cached)
- `GET /api/admin/accounts/:id/link-preview?personId=`: **advice, not a decision.** It runs the same checks (so a refusal shows before saving) and says, for a Member, what the account may edit afterwards: the person, the people the account added below them (`createdByAccountInLine`), and how many people it may edit now through the old link and would lose (`losesEdit`). For other roles it answers zeros: their rights do not depend on the link. The PUT checks everything again on the server.
- `PUT /api/admin/accounts/:id/person` `{ personId, currentPersonId }` → `{ accountId, person }`.
- `DELETE /api/admin/accounts/:id/person?currentPersonId=` → 204.
- Error codes: `account_not_found`, `person_not_found` (404); `role_not_allowed` (403); `person_already_linked`, `account_already_linked`, `person_is_placeholder`, `person_has_open_invitation`, `account_not_linked` (409). New SQLSTATEs KS040 to KS043 (KS040 account_already_linked, KS041 person_is_placeholder, KS042 person_has_open_invitation, KS043 account_not_linked).
- Each row of `GET /api/admin/accounts` has `canLinkPerson`.

### What changes for the account
Nothing is stored in the session: `/api/auth/me` reads `person_id` on every request, so the change is immediate and needs no sign-out. Home, My profile, "Open my profile", the default focus of `/tree` and the "You" pill follow `personId`. A Member's edit rights follow `kinship_person_id()` (0005): their own person, and people **they added** who are in that person's line; adding a child under themselves or their line. Admins and Users are unaffected. Relationship labels do not read it. `kinship_person_has_account` makes a linked person undeletable (`person_has_account`); unlinking lifts that.

### Audit
**No new table.** Each link, change and unlink is one structured line in the api log, written after the commit: `{event: 'account_person_linked' | 'account_person_unlinked', actor, account, from, to}`, **ids only, no names and no emails**. A refused request and a no-op write nothing. The tree-wide change history is 0.5; that feature can backfill from this shape (the same four fields, plus the time).

### UI
Admin → Users only; no profile-page button in this step. Per account row: "Link to a person" (no person) or "Change" and "Unlink" (a person). The dialog reuses `PersonPicker` with the people who already have an account or an open invitation left out, reads the preview into a polite live region, and saves on an explicit confirm button; unlink has its own confirmation that says what is lost. Errors are `role="alert"`, success is the pill, and focus returns to the row's button. A button the hierarchy forbids is disabled with the existing reason ("Your role cannot change this one."). Invitations have no person buttons: an invitation names its person when it is made.

### The mockup
`design/kinship-mockup.html` shows the **Linked person** column on Admin → Users (read-only, "Not on tree" when empty), "Linked account" in a profile's Facts, the invite dialog's person select, a "Manage users and link people to accounts" row in Roles & access, and an email "Your account was linked to a person" marked *next*. It shows **no control to link, change or unlink an existing account**. `design/` is read-only, so this ADR is the record; the Project copy of the mockup may want the controls. No email is sent in 0.2.

### A fix made on the way
`kinship_auth.create_invitation` (0011) and its route accepted a placeholder as the person to link: the Invite dialog hid placeholders, the API did not. Accepting such an invitation would have failed on an empty display name with an unhandled error. 0016 replaces the function (same signature) with the check, the route checks too, and both answer `409 person_is_placeholder`. Listed under Fixed in the changelog.

## Upgrade test
The data digest in `scripts/upgrade-test.sh` already includes `users.person_id` (`'a:' || id || email || role || coalesce(person_id::text, '')`), so a link made on the previous release is carried through an upgrade and compared. The seed for 0.2.0 (`seed-0.2.0.sh`, needed once v0.2.0 is tagged) should copy `seed-0.2.0-rc.2.sh`, link its "Visiting User" (role `user`, no person) to a person through the new route, **before** the digest is taken, and assert after the upgrade that `users.person_id` of that account is that person, that three accounts still exist, and that the unique index still refuses a second account for the same person. No existing seed assertion changes.

## Consequences
- An admin can repair an alpha or release-candidate install from the screen.
- Linking a Member to someone high in the tree gives them add-child rights on that whole line; that is why the dialog says it first.
- Linking an SSO identity to an account (0.4) will reuse `link_account_person`.
