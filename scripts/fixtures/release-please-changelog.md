# Changelog

## [0.2.0-alpha.2](https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.2...v0.2.0-alpha.2) (2026-11-17)


### ⚠ BREAKING CHANGES

* **api:** BACKUP_KEEP is no longer read; set BACKUP_RETENTION_DAILY.

### Security

* refuse a session cookie without the Secure flag behind HTTPS ([941477e](https://github.com/officialJCReyes/kinship/commit/941477e0093bdd9edaaeedabbe48d115e982d749))


### Features

* an account's own display settings on the account (migration 0010) ([#42](https://github.com/officialJCReyes/kinship/issues/42)) ([e775fca](https://github.com/officialJCReyes/kinship/commit/e775fca10df35de5f651a36f8f3ed51daea1f929))
* **api:** a safety copy of the database before every migration ([#70](https://github.com/officialJCReyes/kinship/issues/70)) ([6e05d6e](https://github.com/officialJCReyes/kinship/commit/6e05d6e65f055ec21bcca10ab7daa747358f9e3f))
* **api:** atomic first-run setup with a family, and a setup token check (migration 0012, ADR 0013) ([#62](https://github.com/officialJCReyes/kinship/issues/62)) ([cd343b2](https://github.com/officialJCReyes/kinship/commit/cd343b2a5245535f4ab00ccca65a2b775832299d))
* **api:** change your own password, and set-password links from an admin ([#53](https://github.com/officialJCReyes/kinship/issues/53)) ([0ed5743](https://github.com/officialJCReyes/kinship/commit/0ed5743cba5541ca0b1c1f66e913e903def3fe42))
* **api:** invitations by copied link (migration 0011, ADR 0012) ([#52](https://github.com/officialJCReyes/kinship/issues/52)) ([bcada3a](https://github.com/officialJCReyes/kinship/commit/bcada3ad098b374e4328f390ce64501c5ae730c6))
* **api:** kinship restore and testing a backup in a temporary database ([#68](https://github.com/officialJCReyes/kinship/issues/68)) ([c4c9720](https://github.com/officialJCReyes/kinship/commit/c4c97201bb5919736e965f66b7d8ee0ddc9adbbb))
* **api:** migration 0014 for the update check and What's new ([#79](https://github.com/officialJCReyes/kinship/issues/79)) ([70b4f14](https://github.com/officialJCReyes/kinship/commit/70b4f143d5ee955bc0250b997344e5fa510de715))
* **api:** rename BACKUP_KEEP to BACKUP_RETENTION_DAILY ([1a36849](https://github.com/officialJCReyes/kinship/commit/1a368495660dfb95cad97b25caa68881f6d755c6))
* **api:** second and married surnames, search over all names, and automatic Widowed ([#34](https://github.com/officialJCReyes/kinship/issues/34)) ([ce94a30](https://github.com/officialJCReyes/kinship/commit/ce94a301e768f795d34a069213f48858c123533c))
* **api:** the backup archive format and its crypto (format 1) ([#66](https://github.com/officialJCReyes/kinship/issues/66)) ([69ac229](https://github.com/officialJCReyes/kinship/commit/69ac22961c2e7809cf51885d6fc04874c3f1dc2c))
* **api:** the backup dump and the kinship backup commands (migration 0013, ADR 0014) ([#67](https://github.com/officialJCReyes/kinship/issues/67)) ([1d21a47](https://github.com/officialJCReyes/kinship/commit/1d21a47b232db500e70baf0dcbfdad4d5ac8335c))
* **api:** the backup schedule, retention and history ([#69](https://github.com/officialJCReyes/kinship/issues/69)) ([15b09fa](https://github.com/officialJCReyes/kinship/commit/15b09fa2f4993e50d8cd0e155adfdc5570f6b695))
* **api:** the daily update check, the job runner and proxy support ([#80](https://github.com/officialJCReyes/kinship/issues/80)) ([ca96769](https://github.com/officialJCReyes/kinship/commit/ca96769cd211f468f78eeb6f75fae28e87d9a5e3))
* **api:** the Updates and What's new routes, and the web/api version check ([#81](https://github.com/officialJCReyes/kinship/issues/81)) ([fcc1391](https://github.com/officialJCReyes/kinship/commit/fcc139105dea9ebf8beb545fab37b8618db6f0da))
* custom relationship labels (Godmother, Guardian) between two people ([#40](https://github.com/officialJCReyes/kinship/issues/40)) ([bc8ef65](https://github.com/officialJCReyes/kinship/commit/bc8ef65c56ab15387bfb4c0e30e0aeffb9ab895b))
* saving a status by hand makes an automatic Widowed permanent, and the web app reports it ([#37](https://github.com/officialJCReyes/kinship/issues/37)) ([e2b2d72](https://github.com/officialJCReyes/kinship/commit/e2b2d72dd7210e93be4dabd89344b7cb177a4d6c))
* **shared:** SemVer, release manifest, changelog reader and the updates contract ([#78](https://github.com/officialJCReyes/kinship/issues/78)) ([9a8ed69](https://github.com/officialJCReyes/kinship/commit/9a8ed6932cfad8db32fbe8b6ef46c70b5f6275b9))
* step relatives and a partner's children from another relationship ([#41](https://github.com/officialJCReyes/kinship/issues/41)) ([4a8d1dd](https://github.com/officialJCReyes/kinship/commit/4a8d1dd5219cbe3742ba03dbc2c0246c8ea5bf2c))
* the backup routes and the Admin &gt; Backups page ([#71](https://github.com/officialJCReyes/kinship/issues/71)) ([37fd507](https://github.com/officialJCReyes/kinship/commit/37fd5079d1f88e013009a69ac088b65e79d8c7ff))
* **web:** Admin &gt; Updates, the update banner and popups, What's new, version-mismatch page ([#82](https://github.com/officialJCReyes/kinship/issues/82)) ([7577128](https://github.com/officialJCReyes/kinship/commit/757712896e6ea1da122b090cbf72f55036f51606))
* **web:** Admin → Users, with invitations and set-password links ([#54](https://github.com/officialJCReyes/kinship/issues/54)) ([0ac1ef8](https://github.com/officialJCReyes/kinship/commit/0ac1ef8a9441f2642ad098c242f0d3a82210a683))
* **web:** four color schemes and a theme, applied before the first paint ([#45](https://github.com/officialJCReyes/kinship/issues/45)) ([94c5c70](https://github.com/officialJCReyes/kinship/commit/94c5c70f12026e43af0f53fff825fd706fa86592))
* **web:** My settings, and the account menu ([#46](https://github.com/officialJCReyes/kinship/issues/46)) ([c42b1c4](https://github.com/officialJCReyes/kinship/commit/c42b1c4a405328cb22be8339e33c7bfda5af1fe8))
* **web:** one helper for dates and one for names, fed from the account ([#43](https://github.com/officialJCReyes/kinship/issues/43)) ([ba5ab56](https://github.com/officialJCReyes/kinship/commit/ba5ab56cb59094afdc92f46267c07a8779d6eba0))
* **web:** second and married surnames, shown through one displayName helper ([#36](https://github.com/officialJCReyes/kinship/issues/36)) ([3748b3a](https://github.com/officialJCReyes/kinship/commit/3748b3a268eb4a66de4cd29dd6a3d2b17b858bab))
* **web:** the first-run wizard shell and steps 1 to 3 (Account, Tree, You) ([#63](https://github.com/officialJCReyes/kinship/issues/63)) ([1d16269](https://github.com/officialJCReyes/kinship/commit/1d162695f9215cc0dd8a6f15df0722ed6de648f6))
* **web:** the invitation and set-password pages, and Change password ([#55](https://github.com/officialJCReyes/kinship/issues/55)) ([f497fdc](https://github.com/officialJCReyes/kinship/commit/f497fdcc87eadb7fdb9e5059fd66e1561b52131e))
* **web:** wizard steps 4 to 6 (Partner, Parents, Children), the full Review and soft warnings ([#64](https://github.com/officialJCReyes/kinship/issues/64)) ([db1e8d8](https://github.com/officialJCReyes/kinship/commit/db1e8d89a4f277f252ab51d01dab4c13a978e7c1))


### Bug Fixes

* **web:** move focus to the first invalid setup field once the error is shown ([#84](https://github.com/officialJCReyes/kinship/issues/84)) ([3dc561f](https://github.com/officialJCReyes/kinship/commit/3dc561fdb44cf95fbc4105b0643ce2a9434dd614))

