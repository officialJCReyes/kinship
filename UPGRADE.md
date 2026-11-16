# Upgrading KinShip

Notes for upgrading from one release to the next, newest first. Read the section for the version you are moving to. The release process requires a section here for any release with a breaking change.

## 0.1.0-alpha.2

**This is an alpha: there is no upgrade promise, and data may be wiped between 0.1.x releases. Do not keep real family data in it.** The data promise starts with 0.2.

- **From 0.1.0-alpha.1 you can usually just update** (this was tried: an alpha.1 install with a SuperAdmin account moved to alpha.2 in place). Change `KINSHIP_VERSION` in `.env` to `0.1.0-alpha.2`, then `docker compose pull && docker compose up -d`. The database changes (migrations 0003 to 0006) are applied at startup and your SuperAdmin account keeps working. That account is **not linked to a person** (a fresh install can link it during setup; 0.1 has no screen to link one later): open **Family tree** and choose who to start from, or add people on the People page.
- **If anything looks wrong, start fresh.** Take a dump first if you want one (the backup command in [INSTALL.md](INSTALL.md)), then `docker compose down --volumes` and install again. Going back to alpha.1 after the database has been upgraded needs a restore of a dump taken before; there are no down-migrations.
- **Breaking changes (internal, for people who built on the API).** The people and tree API changed shape during the alpha: `GET /api/people/:id` returns `parents: {birth, adoptive}` and children as `{id, kind, link, adopted}`; a parent link carries `kind` and `link`; the tree response carries `lineage` and, for a person with a second family, `otherFamily`; `AuthUser` carries `lineageView`. The API is not a public interface in 0.1.
