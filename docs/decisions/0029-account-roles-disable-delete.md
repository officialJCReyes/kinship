# 0029. Changing a role, disabling and deleting accounts (#57, #56)

- Status: **Accepted** (decisions by JC, 2026-11-21, after the step 35 phase 1 report)
- Date: 2026-11-21
- Builds on: [0003 Accounts and sessions](0003-accounts-and-sessions.md), [0012 Account links](0012-account-links.md), [0020 Linking an account to a person](0020-link-account-to-person.md), [0018 Scope audit](0018-scope-audit-0.2.md)
- Amends: [0012](0012-account-links.md) (a set-password link is refused for a disabled account), [0028](0028-relationship-finder.md) (see "A wording change" below)
- Migration: `0019_account_roles_disable_delete.sql`. Additive (expand only): one nullable column, new functions, two triggers, a few functions replaced with the same signature. No data change: every existing account stays active.

## Context

An account's role was fixed when its invitation was made (ADR 0012), and there was no way to turn an account off or remove it. Both are needed before 0.4 (SSO group roles, SuperAdmin TOTP): the SSO design already says "never a disabled account" and "the last SuperAdmin can never be demoted, disabled or deleted".

## Decisions

### Who may do what
One rule per action, in SQL (`can_change_role_for`, `can_disable_for`) and in `packages/shared` (`canChangeRole`, `canDisableAccount`), compared for every pair of roles by a test.

| Action | SuperAdmin | Family Admin | Member, User |
|---|---|---|---|
| Change role | Family Admin, Member or User on any other account that is not a SuperAdmin | Member and User accounts, between Member and User only | no |
| Disable or enable | any other account except the last active SuperAdmin | Member and User accounts | no |
| Delete (the account is already disabled, its email typed) | same as disable | Member and User accounts | no |

- **Nobody acts on their own account.** Nobody changes their own role, disables, enables or deletes themselves (no self-service delete in 0.3).
- **There is no "promote to SuperAdmin"** and a role change can never set SuperAdmin. Invitations still cannot create one (ADR 0012 stands). In 0.3 a SuperAdmin account is never the target of a role change either. Only a provider group can make a SuperAdmin, in 0.4.
- **The order of checks is the same in every SQL function and route:** who is asking (KS010), the account exists (KS025), self (KS045), the hierarchy (KS020), the last-SuperAdmin count (KS044), then the state of the account: a stale page (KS046), not disabled (KS048), the typed email (KS049). Authorization before state, so a refusal never tells a caller about an account they may not touch.
- A role change on a disabled account is allowed.

### The last SuperAdmin
- **Written as a count**, not "there is only one": `other_active_superadmins(target)` counts the SuperAdmins that are not disabled and are not the target. Several SuperAdmins arrive in 0.4.
- A disabled SuperAdmin does not count: it cannot sign in.
- **A backstop in the database, for any route** (an admin action, the `kinship` command, an owner at a `psql` prompt, 0.4's group sync): two row triggers on `users`, `users_keep_a_superadmin_update` (BEFORE UPDATE, fires only when an active SuperAdmin's role changes away from `superadmin` or `disabled_at` becomes set) and `users_keep_a_superadmin_delete` (BEFORE DELETE, fires only for an active SuperAdmin). Two triggers because a `WHEN` clause cannot read `NEW` on DELETE. Both take the same advisory lock as the functions (so two SuperAdmins cannot remove each other at the same moment) and raise KS044 `last_superadmin` unless another active SuperAdmin exists. An ordinary sign-in or settings change never fires them.
- `TRUNCATE`, a restore (which drops and recreates the schemas) and the first-run setup are not blocked. An owner who really means it can `ALTER TABLE users DISABLE TRIGGER users_keep_a_superadmin_update` (and `..._delete`).
- **For 0.4:** a group-driven role change must check for the last SuperAdmin BEFORE it updates, because the trigger raises KS044 and would abort the sign-in. The SSO design says to keep the old role and log a warning. 0.4 must also read `users.disabled_at` as its one "disabled" flag (including "never auto-link a disabled account"), not add its own.
- Because an acting admin is always an active SuperAdmin, the function-level guard is reached only in the database (a stale actor, the owner's SQL) and, in 0.4, by group changes. The route answers the only SuperAdmin acting on itself with `self_not_allowed` and a Family Admin with `role_not_allowed`.

### Disabled
`users.disabled_at timestamptz` (NULL means active). Disabling, in one transaction: sets it, deletes the account's sessions, and revokes its open set-password link. (An account has no open invitation: the invitation is accepted when the account is made; invitations keep their own Revoke button.) Its person link, history, shares and every `created_by` stay.
- **Sign-in is refused with the same answer a wrong password gets.** `find_login` returns no row for a disabled account, so the route takes the "no such account" path: the dummy hash, the failure counters, the pause and `401 invalid_credentials`. A test compares the status, body and headers with a wrong password and an unknown email, with the right password.
- `resolve_session` and `create_session` leave a disabled account out (second guards: its sessions are gone already). `create_reset_link` refuses it (`409 account_disabled`, after the hierarchy check); `accept_reset` treats a link for one as `invalid_link`, because accepting a reset link starts a session.
- **Enable** brings the sign-in back. **The old password works again** (decided by JC), and the success message says so and points to the set-password link. Old sessions stay deleted.
- Disabling or enabling an account that is already so is a quiet no-op (200, no log line).
- `kinship set-password` still works on a disabled account and prints "That account is disabled". There is no new command.

### Delete
Only an account that is already disabled, with its email typed (trimmed, ignoring case, checked again on the server, `400 confirmation_mismatch`).
- **The person and their record are never deleted, only the account.** The foreign keys do the rest:

| Reference to `users.id` | On delete | Why |
|---|---|---|
| `sessions.user_id`, `account_links.user_id` (set-password links) | cascade | worthless without the account |
| `people.created_by`, `unions.created_by`, `person_parents.created_by`, `relationship_labels.created_by`, `app_settings.updated_by`, `account_links.created_by` | set null (as built) | the data belongs to the tree; "invited by" goes blank |
| `account_links.accepted_user_id` | the rows are **deleted** first | an accepted invitation keeps the invitee's email; it is personal data of a deleted account, and the email is then free to invite again |

- **A cost the dialog states:** a Member may edit people they created in their own line. After delete those people have `created_by` empty, so only admins (and, for their own person, the person) can edit them; a new account for the same person does not regain "the people I added". The delete preview says how many people the account added.
- **Known limit:** an invitation created by an admin who is later disabled or deleted stays valid. It has its own Revoke button, and after a delete its "invited by" is blank.
- The typed email travels in a POST body (`POST /api/admin/accounts/:id/delete`), never a URL, so it reaches no request log (#74 is the open issue about a ticket in one).

### Routes and codes
`PATCH /api/admin/accounts/:id/role` `{role, currentRole}`; `POST .../disable`, `POST .../enable`; `GET .../delete-preview`; `POST .../delete` `{confirmEmail}`. All admin-only, never cached. A role change applies at once (the role is read from the database on every request), so it does not sign the account out (the open question of #57). A stale `currentRole` is `409 account_role_changed`.
Codes and SQLSTATEs: `last_superadmin` KS044 (409), `self_not_allowed` KS045 (403), `account_role_changed` KS046 (409), `account_disabled` KS047 (409), `account_not_disabled` KS048 (409), `confirmation_mismatch` KS049 (400); `role_not_allowed` and `account_not_found` as before.

### Audit
No audit table until 0.5. One structured log line after each commit, ids only (no name, no email): `account_role_changed` `{actor, account, from, to}` (role codes), `account_disabled`, `account_enabled`, `account_deleted` `{actor, account}`. A refused request and a no-op write nothing. The 0.5 change history can backfill from these shapes. #57 asked for a visible record: until 0.5 this log line is the record.

### The Users page
A menu button per account row (WAI-ARIA menu button: arrows, Home, End, Escape returns focus, Tab and an outside click close it). An unavailable item stays in the menu, is `aria-disabled` and shows its reason as text. A radio-group dialog for roles (only the roles the admin may set), a confirmation for disable, an immediate enable with a message, and a delete dialog with the typed email and the preview count. A disabled row shows a "Disabled" pill in text and the date. Focus returns to the row's menu button; after a delete it goes to the page heading.

## Sharing, for 0.5 and 0.6 (a rule recorded now)
No medical, share or change-history table exists yet. **Shares and records must be keyed by person, never by account id**, and access must resolve through `users.person_id` at read time. Then deleting an account loses nothing and leaks nothing, and a new account linked to the same person gets back exactly what the person had. Photo and file tables (step 37) use `uploaded_by ... ON DELETE SET NULL`.

**A hole this step widens, not creates (for the 0.6 phase 1):** an admin can invite a new account naming a living person who has no account and control that link; from 0.6 that would give them the person's private record. Deleting or unlinking an account makes more living people eligible. Tracked as an issue; 0.6 must decide what linking an account to a living person with a private record requires.

## A wording change (amends ADR 0028)
ADR 0028 says Separated reads "separated" in the finder ("Aunt's separated husband"). JC decided that Separated reads "ex-" like Divorced and Annulment ("Aunt's ex-husband", "ex-wife", and "ex-partner" where no gendered word applies). This is wording only: the `rel.separated.*` keys are gone and every former partner uses `rel.ex.*`. Married and Widowed remain the only statuses that give in-law and step names (`givesStepTitles`), and the profile and the finder keep sharing that one rule. The profile's own partner label ("Wife (separated)") and the setup wizard's labels are unchanged.

## Consequences
- An admin can repair an account from the screen without SQL, and an account that leaves can be turned off at once.
- No install can end with no active SuperAdmin through a normal route.
- Manual SQL on `users` that would remove the last active SuperAdmin now fails (documented in UPGRADE.md).
