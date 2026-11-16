# 0012. Invitations and set-password links (account_links)

- Status: **Accepted** (decisions by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0003 Accounts and sessions](0003-accounts-and-sessions.md), [0005 People and relationships](0005-people-and-relationships.md)
- Sources: `design/kinship-email-templates.md` (sections 1 and 3), `design/kinship-navigation.md`, the mockup's Admin → Users tab and invite dialog. Where they differ, the step brief won (see "Where this differs from the design docs").

## What it is

An admin invites someone by **copying a link**; no email is sent in 0.2 (there is no mail provider yet). The same table and the same rules also carry **set-password links**, which an admin makes for someone who is locked out. Both kinds are a random token shown **once**.

## Who may do what

| Action | SuperAdmin | Family Admin | Member, User |
|---|---|---|---|
| Invite a Family Admin | yes | no | no |
| Invite a Member or a User | yes | yes | no |
| Invite a SuperAdmin | no (not in 0.2) | no | no |
| Set-password link for | anyone but themselves | a Member or a User | no |
| Make a new link for, or revoke, a link | if they could have created it | if they could have created it | no |

A locked-out SuperAdmin uses the server command (`kinship set-password`). The hierarchy lives in two SQL functions (`can_invite_role`, `can_reset_for`) and in `packages/shared` (`ROLES_INVITABLE_BY`, `canMakeSetPasswordLink`); the API checks it first for a clear error, and the database functions check it again, so a bug in the API cannot create a link the rules forbid. A role is fixed when the invitation is made; making a new link keeps it.

## Storage

- **One table, `account_links`** (migration 0011), `kind` = `invite` or `reset`. A CHECK keeps each kind's fields consistent (an invite has an email and a role of Family Admin, Member or User; a reset has a user and nothing else). `person_id` cascades: delete the person and their open invitation goes with them.
- **Only the SHA-256 of the token is stored** (the tokens are 256 random bits, so a fast hash is enough, as for sessions). The raw token exists in the one response that creates or regenerates a link (`LinkCreated`) and in the link the admin hands over.
- **One open link per email, per person and per reset target**, as partial unique indexes over links that are not accepted and not revoked. "Open" cannot mention the clock in an index, so `create_invitation` and `create_reset_link` first retire (revoke) an open link that has already expired for the same email, person or target; an expired link therefore never blocks a new one. A race between two creators ends in a unique violation, which is answered as `invitation_exists` / `link_exists`.
- **No grants for the app role, and RLS enabled with no policy.** Everything goes through `SECURITY DEFINER` functions in `kinship_auth` with a fixed `search_path`, executable by the app role only. RLS is **enabled but not forced**: those functions run as the owner, and forcing a policy-less table on the owner would hide every row from them (the same reason `users` and `family_tree` are not forced, see 0005). With no policy, a grant added by mistake would still show nothing, and a test checks exactly that.
- **Admin functions** (`create_invitation`, `create_reset_link`, `regenerate_link`, `revoke_link`, `list_open_links`, `list_inviters`) read `kinship_user_id()` and the role themselves and raise `KS010` for anyone who is not an admin. They must run inside a user transaction. **Public functions** (`lookup_link`, `accept_invitation`, `accept_reset`) have the link as the credential.
- **Lifetimes:** an invitation 7 days, a set-password link 24 hours, both fixed in SQL (the mockup's 1 hour for reset links is replaced).

## The link

`<origin>/invite#<token>` and `<origin>/reset#<token>`. The token is in the URL **fragment**, which a browser never sends to a server, so it is in no access log, no `Referer` and no proxy log. The page reads it, removes it from the address bar with `history.replaceState`, and sends it only in the **body** of `POST /api/links/lookup` and `POST /api/links/accept`. Every response about a link carries `Cache-Control: no-store`.

## Showing a link once

"Copy again" does not exist: the server cannot show a token again, because it does not have it. **Make a new link** (`regenerate`) replaces the token in the same row, so the old link stops working at once, and restarts the clock. The dialog that shows a link says plainly that closing it means it cannot be shown again.

## Every bad link looks the same

Unknown, expired, used and revoked tokens all get status **404**, code `invalid_link` and the same body, after **one indexed lookup** by `token_hash` (the conditions are checked on the row it finds). The token is checked before any password hashing, so a wrong token costs one indexed read, no argon2. Public routes have the same cap as sign-in (30 requests a minute per address), a failure limiter per address (20 in 15 minutes) and a global one (200 in 15 minutes), and a 300 ms pause after a failure. The global limit lets an attacker who keeps failing slow every acceptance for up to 15 minutes; with 256-bit tokens a guess cannot succeed, so the limits only keep the endpoint cheap, and that cost is accepted (as for setup).

## Accepting

`accept_invitation` claims the link with one atomic `UPDATE … WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() RETURNING`, then creates the account with the invited role, the person link and the default settings, and records `password_changed_via = 'invitation'`. Concurrent accepts of one link take turns on that row lock: ten at once make one account and nine generic errors (tested). If the email or the person was taken in the meantime, the unique constraint fails, the whole function rolls back (the claim too) and the answer is again the generic one. With a person linked the account takes that person's name; otherwise the invitee gives theirs. The API then starts a fresh session as setup does, which also sets `last_sign_in_at`.

`accept_reset` claims the link, sets the password, records `admin_link`, and deletes **all** of the account's sessions; the API then starts a fresh session on the browser that used the link.

## Email is unique, ignoring case

`users.email` already had a CHECK (`email = lower(email)`) and a unique index since 0002, so a case-only duplicate has never been possible and migration 0011 cannot hit a conflict on any database created by KinShip. It adds a unique index on `lower(email)` as well, so the rule keeps holding if that CHECK is ever relaxed, and a guard that stops with a clear message (a count, no addresses) if some database was edited by hand. Invitations are also checked against existing accounts case-insensitively.

## The password trace

`users.password_changed_via` (`setup`, `self`, `admin_link`, `cli`, `invitation`) and `password_changed_at` record how and when the password last changed. NULL means unknown: it was set before KinShip recorded it. The owner of an account sees it on their Account card ("Password last changed 14 Nov, using a link from an admin"), and admins see it on the Users page. **Why:** from 0.6 an account's private medical record is readable by whoever controls the account, so a reset made by an admin must be visible to the person it was made for. `last_sign_in_at` is set inside `create_session`. Admins read every account row through the `users_select_admin` policy; the password hash has no column grant, so no policy can expose it.

## Changing your own password

`change_password` takes the signed-in user, the new hash, the current session's token hash and a **new** token hash: it updates the hash and the trace, deletes the account's other sessions, gives the current session the new token (same expiry) and retires the account's open set-password links. The API sets the new cookie. (The brief named three arguments; the fourth lets the rotation happen in one transaction.)

## Where this differs from the design docs

- The mockup's invitation link is a path (`/invite/9f3c2a71`) and the email-templates doc follows it; the link is now `/invite#<token>`. Reset links last 24 hours, not 1 hour. Both docs are stale, listed in the step report.
- The mockup lists an invite role "User, Member, Family Admin" only; the Users page also needs the status and the trace, which the mockup does not show.
- No invitation email and no "password changed" email in 0.2 (0.4).

## Not built (issues)

Disabling and deleting accounts, role editing, the Sign-in column, linking an existing account to a person (issue #8, 0.4), password reset by email and the password-changed email (0.4), a session list (1.1).
