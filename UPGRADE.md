# Upgrading KinShip

Notes for upgrading from one release to the next, newest first. Read the section for the version you are moving to. The release process requires a section here for any release with a breaking change.

## Unreleased (will become 0.2.0)

Notes are added here as 0.2 changes land and finished at release prep: rename this heading to the version.

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
