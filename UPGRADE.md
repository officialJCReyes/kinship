# Upgrading KinShip

Notes for upgrading from one release to the next, newest first. Read the section for the version you are moving to. The release process requires a section here for any release with a breaking change.

## Unreleased (will become 0.2.0)

Notes are added here as 0.2 changes land and finished at release prep: rename this heading to the version.

### First-run wizard (database change, back up first)

- **No action is needed, and no data changes.** Migration 0012 adds the function the new first-run wizard uses to create the account, the tree and your closest relatives in one step, and drops an old unused one (the five-argument `complete_setup`, issue [#9](https://github.com/officialJCReyes/kinship/issues/9)). An installation that has an account already never sees the wizard. A new install sees a seven-step setup wizard instead of the one-page form: everything is created at the end in one step.
- **API:** `POST /api/setup` takes an optional `family` object (you, partner, parents, children) and answers errors with the field that is wrong (`{ "error": "invalid_date", "field": "family.children.1.birth" }`); other setup errors now carry a `field` too. New `POST /api/setup/check` tells whether a setup token is right. A script that sends `person` instead of `family` keeps working. See [ADR 0013](docs/decisions/0013-setup-wizard.md).

### Invitations, set-password links and Change password (database change, back up first)

- **No action is needed, and every existing account keeps working** (your SuperAdmin, and any Members or Users you made by hand). Migration 0011 adds a table for invitation and set-password links, and three columns to every account: when it last signed in, when its password last changed, and how. For accounts that exist already, "how" is empty and the Account card says "Password change not recorded"; it fills in the next time the password changes.
- **Admins can now invite people.** **Account menu → Admin → Users → Invite user** makes a link to send yourself (KinShip sends no email yet). A SuperAdmin invites Family Admins, Members and Users; a Family Admin invites Members and Users. The link works once and lasts 7 days, and it is shown only when you make it: if you close the window, make a new link (that cancels the old one). An invitation can link an existing person who has no account; a Member with no linked person can only read, and linking an account afterwards is not possible yet ([#8](https://github.com/officialJCReyes/kinship/issues/8)).
- **Set-password links.** An admin can make a 24-hour link for someone who is locked out (a Family Admin for a Member or a User, a SuperAdmin for anyone but themselves). Using it signs the account out everywhere. **The account shows that an admin set the password**: under **My settings → Account**, "Password last changed 14 Nov, using a link from an admin", and admins see the same line on the Users page. A SuperAdmin who is locked out still uses `kinship set-password` on the server, which now also shows as "by the person who runs the server".
- **Change password** is under **My settings → Account**. It signs out every other device.
- **Email addresses are unique ignoring case.** Accounts have always stored addresses in lower case with a unique index, so no existing database can have a clash and the migration does not change any account. It adds the same rule on `lower(email)` as well. If a database edited by hand ever had two accounts whose addresses differ only in case, the migration stops with a message that says how many (never the addresses) and changes nothing: give each its own address and start KinShip again.
- **Admins now read every account row** (name, email, role, linked person, last sign-in, how the password changed) through a new row-level security policy. The password hash is still unreadable by the application.
- **Links are in the address fragment** (`https://your-tree.example/invite#…`, `/reset#…`). A browser never sends a fragment to a server, so the secret is in no access log, including your reverse proxy's. **Reverse proxies:** nothing to change; `/invite` and `/reset` are served like any other page, and the API answers for them under `/api/links/` with `Cache-Control: no-store`.
- **API:** `POST /api/admin/invitations`, `GET /api/admin/accounts`, `POST /api/admin/links/:id/regenerate`, `POST /api/admin/links/:id/revoke`, `POST /api/admin/accounts/:id/set-password-link`, public `POST /api/links/lookup` and `POST /api/links/accept` (the token in the body), and `POST /api/auth/password`. `GET /api/auth/me`, sign-in and setup also return `passwordChangedAt` and `passwordChangedVia`. See [ADR 0012](docs/decisions/0012-account-links.md).

### Display settings (database change, back up first)

- **No action is needed.** Migration 0010 adds four columns to every account: color scheme, theme (light or dark), date format, and which surname shows, next to the family setting that already exists. Every existing account gets the defaults: Forest, Device (follows your device), dates like "Jan 1, 2026", and the married surname when someone has one.
- **Dates now read "Jan 1, 2026" by default** (the alpha showed "January 1, 2026"). Each person changes this, the color scheme (Forest, Warm sand, Slate blue, Graphite), Light or Dark, which surname shows, and the family to follow for an adopted person under **account menu → My settings**. These settings belong to the account and change nothing for anyone else.
- **The top bar changed.** "My profile" and "About" moved into the account menu (click your name), which also has "My settings" and "Sign out".
- **API:** `GET /api/auth/me`, sign-in and first-run setup return `colorScheme`, `theme`, `dateFormat` and `surnameChoice`; `PATCH /api/auth/me` accepts any of the five settings. The browser keeps a copy of the color scheme and theme (`kinship.display` in local storage) so a page is drawn right before sign-in; the account decides.
- **Reverse proxies:** the web container now also serves one small file, `/theme-init.js`. It must not be blocked, and it must not be cached for long: the bundled nginx makes the browser check it on every load, so a new release reaches people at once.

## 0.1.0-alpha.2

**This is an alpha: there is no upgrade promise, and data may be wiped between 0.1.x releases. Do not keep real family data in it.** The data promise starts with 0.2.

- **From 0.1.0-alpha.1 you can usually just update** (this was tried: an alpha.1 install with a SuperAdmin account moved to alpha.2 in place). Change `KINSHIP_VERSION` in `.env` to `0.1.0-alpha.2`, then `docker compose pull && docker compose up -d`. The database changes (migrations 0003 to 0006) are applied at startup and your SuperAdmin account keeps working. That account is **not linked to a person** (a fresh install can link it during setup; 0.1 has no screen to link one later): open **Family tree** and choose who to start from, or add people on the People page.
- **If anything looks wrong, start fresh.** Take a dump first if you want one (the backup command in [INSTALL.md](INSTALL.md)), then `docker compose down --volumes` and install again. Going back to alpha.1 after the database has been upgraded needs a restore of a dump taken before; there are no down-migrations.
- **Breaking changes (internal, for people who built on the API).** The people and tree API changed shape during the alpha: `GET /api/people/:id` returns `parents: {birth, adoptive}` and children as `{id, kind, link, adopted}`; a parent link carries `kind` and `link`; the tree response carries `lineage` and, for a person with a second family, `otherFamily`; `AuthUser` carries `lineageView`. The API is not a public interface in 0.1.
