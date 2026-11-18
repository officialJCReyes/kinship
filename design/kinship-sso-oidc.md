# KinShip single sign-on: OpenID Connect and group roles (Nov 18, 2026)

Companion to `kinship-release-and-deployment-plan.md` (release 0.4), `kinship-v2-requirements.md` and `kinship-navigation.md` (Admin → Sign-in & SSO). Not yet built; it ships in **0.4** with email.

**Decided by JC, Nov 18:**
- Single sign-on is **provider-agnostic OpenID Connect (OIDC)**. No KinShip code may depend on one product. **Authentik** is the provider JC deploys and tests with, so it is the reference setup in the docs, not the only supported one.
- **Group membership claims decide the role.** A group maps to Family Admin, Member or User, **and to SuperAdmin** (see "SuperAdmin by group").
- **A person in no mapped group gets User** (not refused).
- **Accounts are created on a first SSO sign-in** when group mapping is on.
- **SSO sessions last at most 24 hours.**
- **Group names live in `.env`**, not in Admin.
- **A SuperAdmin must have TOTP (authenticator app) login, and it ships in 0.4** with SSO. "2FA" here means KinShip's own TOTP, not the provider's. **SSO supersedes TOTP:** an SSO sign-in is never asked for a KinShip code, because the provider handles its own sign-in. The TOTP exists for the break-glass path, the local sign-in you use after switching SSO off.
- **There can be more than one SuperAdmin, and the last SuperAdmin can never be demoted**, by a group, an admin action or any other route. It also cannot be disabled or deleted (JC, Nov 18).
- **The OIDC group is the only way to make a SuperAdmin (JC, Nov 18).** There is no "promote to SuperAdmin" action in Admin → Users, and invitations cannot create one. The first SuperAdmin is the one made by the setup wizard.
- **Single logout is later, not 0.4 (JC, Nov 18).**
- **An SSO sign-in links to an existing local account by email automatically (JC, Nov 18)**, with the safeguards under "Matching people to accounts".
- **TOTP is required for every SuperAdmin, including installs that never use SSO, and comes with one-time recovery codes and a `kinship` CLI reset (JC, Nov 18).**
- **While SSO is on, local sign-in is off, for every role (JC, Nov 18).** The only way to use a local credential again is to switch SSO off (`OIDC_ENABLED=false`, restart). See "Local sign-in while SSO is on".

Items marked **Proposed** still need a yes.

## Wording
Docs and the website say "OpenID Connect" and "any standards-compliant provider, tested with Authentik". A provider gets its own setup guide only after someone has tested it; until then the docs say "expected to work", never "supported". In the app the button says "Sign in with <provider name>", with a name the deployer sets (default "Single sign-on"). The word Authentik appears only in the docs. This replaces the earlier "Authentik OIDC SSO" lines in the release plan and the requirements doc.

## How it works
- **Authorization Code flow with PKCE (S256)**, KinShip as a confidential client. The API finds the provider's endpoints from the issuer's discovery document (`/.well-known/openid-configuration`).
- **Redirect URI** to register at the provider: `<PUBLIC_URL>/api/auth/oidc/callback` (**Proposed** path). Admin shows it with a Copy button.
- **Validation:** state and nonce, the token signature against the provider's published keys, `iss`, `aud` and expiry. Unsigned tokens are refused. Tokens are used to sign in and then dropped: KinShip keeps the identity (issuer and subject) and no refresh token (**Proposed**).
- **SSO is enforced while it is on:** the local password sign-in is refused (see "Local sign-in while SSO is on"). Switching SSO off, in `.env`, is the break glass (see "SuperAdmin by group").
- The api needs outbound HTTPS to the issuer (`HTTPS_PROXY` is honored). A private-network issuer is fine.
- **Library (Proposed):** `openid-client` (MIT, OpenID-certified). The dependency license check in CI must pass; an ADR records the choice when it is built.

## Settings (Proposed names)
Everything lives in `.env` or Docker secrets (`_FILE`), never in the database or the Admin page (JC, Nov 18: group names too). Names are unprefixed, like the rest of the install.

| Variable | Meaning | Default |
|---|---|---|
| `OIDC_ENABLED` | **The master switch (decided by JC, Nov 18).** `true` turns SSO on and local sign-in off; anything else, or unset, leaves SSO off. The other `OIDC_` settings can stay in `.env` while it is `false`, so the break glass is one edit. | `false` |
| `OIDC_ISSUER_URL` | The provider's issuer URL. Required when `OIDC_ENABLED=true`. | none |
| `OIDC_CLIENT_ID` | Client ID registered at the provider | none |
| `OIDC_CLIENT_SECRET` (and `_FILE`) | Client secret | none |
| `OIDC_PROVIDER_NAME` | Name shown on the sign-in button | `Single sign-on` |
| `OIDC_SCOPES` | Scopes requested | `openid profile email groups` |
| `OIDC_GROUPS_CLAIM` | Claim that holds the group names | `groups` |
| `OIDC_GROUP_SUPERADMIN` | Group name or names (comma separated) that mean SuperAdmin | none |
| `OIDC_GROUP_FAMILY_ADMIN` | Same, for Family Admin | none |
| `OIDC_GROUP_MEMBER` | Same, for Member | none |
| `OIDC_GROUP_USER` | Same, for User (optional: unmapped people get User anyway) | none |

**Startup check (Proposed):** with `OIDC_ENABLED=true`, a missing issuer, client ID or client secret stops the api with a log line that says what is missing and that `OIDC_ENABLED=false` is the way out. It never falls back to local sign-in by itself, because that would quietly drop the enforcement. A provider that is merely unreachable does not stop the api: SSO sign-in fails with a message and the deployer uses the break glass. Group mapping is on when at least one group variable is set. The docs suggest the names `kinship-superadmins`, `kinship-family-admins`, `kinship-members` and `kinship-users` as examples, not defaults.

## Group claims to roles
- Groups are read from the claim named by `OIDC_GROUPS_CLAIM` in the ID token, and from the userinfo endpoint when the ID token does not carry it. The claim may be a list or a single string. Values are compared as exact, case-sensitive text. A provider that sends group IDs instead of names works too: put the IDs in the settings.
- **Highest role wins:** SuperAdmin over Family Admin over Member over User.
- **A person in none of the mapped groups gets User** (decided by JC, Nov 18). Read-only is the safe default. To keep someone out entirely, the provider must not let them use the KinShip application (most providers can restrict an application to chosen groups; the setup guide says how in Authentik).
- **The role is rechecked at every SSO sign-in**, so a change at the provider applies the next time the person signs in. While mapping is on, the role of an SSO account reads "Set by <provider name>" in Admin → Users and cannot be changed there (it would be overwritten). Local accounts are unchanged and their roles stay managed in KinShip.
- **A removed group lasts at most 24 hours** (decided): an SSO session ends after 24 hours at most, so a person removed from a group loses access within a day.
- Each role change that comes from a group is written to the change history ("changed by the provider", from, to).

## SuperAdmin by group (decided by JC, Nov 18)
A group can make an account SuperAdmin, **as long as a local break-glass password is set up** and the account has **TOTP login set up**.
- **Break glass.** If the provider is down, misconfigured or locked out, the deployer **sets `OIDC_ENABLED=false` in `.env`, restarts the containers and signs in with a local account** (the other `OIDC_` settings can stay): password, then the TOTP code. Local sign-in does not work at all until then (see "Local sign-in while SSO is on"). This is why SSO is switched off by the environment file and not by a setting in the app: it must work when nobody can sign in.
- **Why TOTP, and why SSO skips it (decided):** the local login is the door left open when SSO is off, so a SuperAdmin's local sign-in is protected by a second factor. An SSO sign-in is not asked for a code, because the provider already decides how the person proves who they are (and can require its own two-factor).
- **Rule (Proposed mechanics):** an SSO account is made SuperAdmin by the group only when it has a local password **and** TOTP enrolled. An account created by SSO has neither, so it sets them first while signed in through SSO (My settings → Account → "Set a local password", then "Set up authenticator app"; neither can be used to sign in until SSO is off); until then it signs in with the highest other role it qualifies for, and the page says why. This is the "backup password" JC described.
- **TOTP ships in 0.4 (decided), pulled forward from 1.4,** and is required for every SuperAdmin, including a SuperAdmin on an install that never uses SSO: after upgrading to 0.4 the SuperAdmin is prompted to enroll at the next local sign-in (decided). Other roles get optional TOTP, and passkeys, in 1.4 as planned (**Proposed**).
- **Recovery (decided):** one-time **recovery codes** shown once at enrollment (a lost phone must not lock out the only SuperAdmin), and a `kinship` CLI command to reset a SuperAdmin's TOTP from the server shell (like `set-password`).
- **More than one SuperAdmin (decided).** The "one SuperAdmin per tree" rule is dropped. A group can create any number. **Invitations still cannot create a SuperAdmin** (ADR 0012 stays as built), and there is no promote action: the group is the only way to get a second one (decided).
- **The last SuperAdmin can never be demoted (decided), by any route:** not by a group change, not by an admin action, not by the CLI. A sign-in that would leave the tree with no SuperAdmin keeps the old role and logs a warning; an admin action that would do it is refused with a message. Disabling or deleting the last SuperAdmin is refused for the same reason (decided).
- **Other safeguards (Proposed):** every SuperAdmin granted or removed by a group is written to the change history and shown to the other SuperAdmins. Admin → Sign-in & SSO shows the break-glass steps.

## Local sign-in while SSO is on (decided by JC, Nov 18)
SSO is **enforced**, not offered beside the password form. While `OIDC_ENABLED=true`:
- **The api refuses every local password sign-in** for every role, SuperAdmin included (**Proposed** answer: 403 `local_sign_in_disabled`). It is refused on the server, not just hidden on the page.
- **There is no setting to allow both.** The only way to use a local credential again is to set `OIDC_ENABLED=false` and restart (decided by JC, Nov 18; this replaces "remove the issuer URL", so the provider settings can stay in `.env`). That is the break glass, and it is the same step whether the provider is down or you simply want to stop using SSO.
- **Proposed mechanics that follow from it:**
  - **Invitations** are accepted only with "Continue with <provider name>"; the password form on `/invite` is hidden and its route refused.
  - **Admin set-password links and reset emails are refused** (they would create a credential that cannot be used). The page says "Sign-in is handled by <provider name>."
  - **A person can still set or change their own local password** while signed in through SSO (no current password is asked, because they have none). It is stored but not usable until SSO is off; this is how a SuperAdmin prepares the break glass. The `kinship set-password` command still works from the server shell.
  - **Sessions follow the switch:** when the api starts, sessions made by a sign-in method that is no longer on are ended (SSO on: password sessions end; SSO off: SSO sessions end). A switch is never undone by a leftover session.
  - **Local-only accounts are locked out** while SSO is on if nobody at the provider matches them (no identity, and no verified email that matches). Admin → Users marks them "Local only: cannot sign in while SSO is on", so an admin sees who needs adding at the provider before switching SSO on.
  - **The first-run wizard still makes the first SuperAdmin with a local password**, even when `.env` already has the SSO settings. That account signs in through SSO afterwards, linked by email as below.

## Matching people to accounts
- The identity is **issuer plus subject (`sub`)**, never email or a username, because those change and can be reused.
- First sign-in by an identity KinShip does not know (checked in this order: an open invitation, then a local account with the same verified email, then a new account):
  1. **With an invitation:** the invitee chooses "Continue with <provider name>". The account is made with the invitation's person, and the role comes from the invitation, or from the groups when mapping is on.
  2. **Mapping on, no invitation:** the account is created on the spot (decided) with the mapped role, or **User** when no group matches, and **no person**. An admin links the account to a person with the existing admin action (ADR 0020, which 0.4 reuses for SSO identities). A Member with no person is read-only, as today.
  3. **Mapping off, no invitation, no local account with that email:** sign-in is refused. (Turn mapping on, or invite the person.) A local account with the same email is linked automatically, as below, with or without mapping.
- **Automatic link by email (decided by JC, Nov 18; this replaces the earlier "an email match never links" rule).** When an SSO sign-in is for an identity KinShip does not know, and a **local account with the same email** already exists, KinShip links the identity to that account instead of creating a new one. The person keeps their person link, history, local password and TOTP. This covers accounts that existed before SSO was set up.
  - **Safeguards (decided by JC, Nov 18; an email match trusts the provider):** link only when the provider says `email_verified` is true; compare emails ignoring case; link only an account that has no SSO identity yet; never link a disabled account; write every automatic link to the change history and show it to the SuperAdmins; and put the exact rule in the setup guide ("anyone who can create an account with a given email at your provider can sign in as the local account with that email, so the provider must verify emails").
  - **Roles on linking:** with group mapping on, the role comes from the groups at every sign-in, so a linked local account takes the group role ("Set by <provider name>"). A local SuperAdmin not in the SuperAdmin group would drop to the mapped role, except the last SuperAdmin, who is never demoted. **Decided:** the first sign-in that would lower a linked account's role shows the SuperAdmins a warning instead of silently changing it.
  - **Break glass is unaffected:** a linked account keeps its local password and TOTP, so `OIDC_ENABLED=false` still lets it sign in locally.
  - An admin can still link or unlink an SSO identity by hand (ADR 0020).
- A new account (no matching email) copies the email only when the provider says `email_verified` is true.
- A disabled account stays disabled.
- SSO accounts have no KinShip password unless they set a break-glass one. Password reset and "password changed" emails go only to accounts that have a local password, and the reset email is not sent at all while SSO is on (the password-changed notice still is); it tells people who sign in by SSO to change their password at their provider.
- Signing out ends the KinShip session only; it does not sign the person out of the provider.

## Screens
- **Sign-in page, SSO on:** only the "Sign in with <provider name>" button, with a line saying a local sign-in is switched off while single sign-on is on. No password form.
- **Sign-in page, SSO off:** the local form, which asks for the TOTP code after the password for accounts that have it set up.
- **Admin → Sign-in & SSO** (SuperAdmin): in 0.4 a read-only status, because the settings live in `.env`: on or off, issuer, provider name, the redirect URI with Copy, the group names, whether this account has a break-glass password and TOTP, the break-glass steps, and a **Test discovery** button that fetches the issuer's discovery document and says whether it advertises a groups claim or scope. The client secret is never shown.
- **My settings → Account:** "Set a local password" for SSO accounts, and "Authenticator app" (set up, recovery codes) for SuperAdmins.
- **Admin → Users:** the Sign-in column shows "Local" or the provider name (#58).

## Testing
- Automated tests run against a small mock OIDC provider, not Authentik, so the code cannot quietly depend on one product. Cases: groups as a list or a string, groups only in userinfo, no mapped group gives User, highest role wins, SuperAdmin group with and without a local password and with and without TOTP, two SuperAdmins at once, last SuperAdmin never demoted (group, admin action, CLI), demotion at the next sign-in, wrong issuer, wrong audience, wrong nonce, expired token, email match linked automatically (verified email only, not when unverified, not a disabled account, not an account that already has an identity), role taken from groups on linking, last SuperAdmin kept, session cut at 24 hours, SSO off when `OIDC_ENABLED` is unset or `false` (with the other settings present), the api refusing to start when it is `true` and the issuer, client ID or secret is missing, and **local sign-in refused for every role (SuperAdmin too) while SSO is on, accepted again after `OIDC_ENABLED=false`**, an old password session ended when SSO is switched on, an old SSO session ended when it is switched off, an invitation accepted only through SSO, admin set-password links refused, and the first-run wizard still working with the SSO settings present.
- TOTP cases: enrollment, a wrong and a reused code, clock drift of one step, recovery codes, the local sign-in refused without a code, an SSO sign-in never asking for one, and the break-glass path end to end (`OIDC_ENABLED=false`, restart, password plus code).
- A manual check against Authentik before 0.4 is tagged, including the break-glass steps. Other providers get a guide only after someone tests them.

## Open
- **Other roles' TOTP (Proposed):** optional for Member, Family Admin and User in 1.4, with passkeys. Confirm when 1.4 is planned.
- **Automatic link safeguards: decided (JC, Nov 18)**, the list under "Matching people to accounts". With local sign-in off while SSO is on, the provider is the only door, so trusting its verified email adds no second route in; the setup-guide warning stays.
- **Enforcement mechanics (Proposed):** the error name, refusing invitation passwords and admin set-password links, ending sessions at startup, and the "Local only" marker in Admin → Users (see "Local sign-in while SSO is on"). The rule itself (no local sign-in while SSO is on) is decided.
- **Single logout:** later (decided). Signing out of KinShip ends only the KinShip session; the provider session stays open.
