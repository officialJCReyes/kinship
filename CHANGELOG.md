# Changelog

All notable changes to KinShip are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0](https://github.com/officialJCReyes/kinship/compare/v0.2.1...v0.3.0) (2026-11-24)


### ⚠ BREAKING CHANGES

* PATCH /api/auth/me, the sign-in and me responses and the setup settings object use nameForm, showPrefix and showSuffix instead of surnameChoice.

### Features

* a cousin marriage can bring a brother or sister out of birth order when that removes an overlap or a crossing ([#153](https://github.com/officialJCReyes/kinship/issues/153)) ([fbcfc7d](https://github.com/officialJCReyes/kinship/commit/fbcfc7ddc338a7a1d5e6c12f30c492675aaa0805))
* a gear panel in the chart's top bar, with Cards and Names ([#167](https://github.com/officialJCReyes/kinship/issues/167)) ([492bacd](https://github.com/officialJCReyes/kinship/commit/492bacd356b8e7d32f8f9eb4abe1afff923b9b3b))
* a shared chart viewport, the view switcher and the address for the chart views ([#157](https://github.com/officialJCReyes/kinship/issues/157)) ([5f69ab5](https://github.com/officialJCReyes/kinship/commit/5f69ab5e743cedaff6d24c9604a8509bf001b93b))
* a week start setting for the account (migration 0020, ADR 0032) ([#199](https://github.com/officialJCReyes/kinship/issues/199)) ([99b902e](https://github.com/officialJCReyes/kinship/commit/99b902e2fe59c08a32e764635ef3a59b2bce4bfa))
* **api:** add a partner or a parent with the children they share ([#264](https://github.com/officialJCReyes/kinship/issues/264)) ([59c9c1e](https://github.com/officialJCReyes/kinship/commit/59c9c1e304f0f9428fabfb95c1726096f77a59e4))
* **api:** backups carry the photos, with an index, and Test checks them ([#211](https://github.com/officialJCReyes/kinship/issues/211)) ([66b38ca](https://github.com/officialJCReyes/kinship/commit/66b38ca56c18c7719cee7e9e750b07d89c371728))
* **api:** file encryption key, stored-file format and files volume ([#209](https://github.com/officialJCReyes/kinship/issues/209)) ([665489a](https://github.com/officialJCReyes/kinship/commit/665489ad2c8b7971d3be7997d01c5eb78a340bd5))
* **api:** link existing children to a second parent ([#262](https://github.com/officialJCReyes/kinship/issues/262)) ([2933279](https://github.com/officialJCReyes/kinship/commit/2933279ceaf11eed3be64bdeea535d38ba851d86))
* **api:** media tables, object store and orphan sweeper ([#210](https://github.com/officialJCReyes/kinship/issues/210)) ([24b5e22](https://github.com/officialJCReyes/kinship/commit/24b5e225c0f68e473cce0030c514b157b10f051c))
* **api:** restore from the app with maintenance mode ([#201](https://github.com/officialJCReyes/kinship/issues/201)) ([0a1b884](https://github.com/officialJCReyes/kinship/commit/0a1b88478810fe61c6e87db987d5b6ae97e5aa72))
* **api:** restore puts the photo files back (37g) ([#212](https://github.com/officialJCReyes/kinship/issues/212)) ([023e133](https://github.com/officialJCReyes/kinship/commit/023e1330774f60ffe9df31199a90f4932d13b167))
* **api:** upload and serve photos (37c) ([#214](https://github.com/officialJCReyes/kinship/issues/214)) ([b368a69](https://github.com/officialJCReyes/kinship/commit/b368a695e82c8e9e6a924dc7dd9cbe33216148a1))
* change an account's role, PATCH /api/admin/accounts/:id/role ([#182](https://github.com/officialJCReyes/kinship/issues/182)) ([caa14d0](https://github.com/officialJCReyes/kinship/commit/caa14d0eace0065521c978f1f516807083e6a728))
* children lines of different families that would run along each other get their own lane ([#152](https://github.com/officialJCReyes/kinship/issues/152)) ([fd60587](https://github.com/officialJCReyes/kinship/commit/fd60587f5bd3736dc15184b81ca337533cb2752e))
* choose whether the mouse wheel zooms or scrolls the chart (gear, Navigation) ([#170](https://github.com/officialJCReyes/kinship/issues/170)) ([8cd57f4](https://github.com/officialJCReyes/kinship/commit/8cd57f46300e3c961cfd5e6735f16c6dd17ec489))
* choose which chart opens first from the Tree tab (gear, Navigation) ([#171](https://github.com/officialJCReyes/kinship/issues/171)) ([41aaf2b](https://github.com/officialJCReyes/kinship/commit/41aaf2b5ec2a2886b87ae9a5b25b6b54bcd440a8))
* collateral=siblings in the tree API (siblings and their families, without aunts, uncles and cousins), and a layout fixture for both modes ([#164](https://github.com/officialJCReyes/kinship/issues/164)) ([32873e2](https://github.com/officialJCReyes/kinship/commit/32873e2d14c165dfb6570218afce08c27943de4c))
* custom relationship labels in the finder and the person panel ([#39](https://github.com/officialJCReyes/kinship/issues/39)) ([#176](https://github.com/officialJCReyes/kinship/issues/176)) ([55cd129](https://github.com/officialJCReyes/kinship/commit/55cd129abae95039908b5c69479450f371120f2c))
* delete a disabled account and a delete preview ([#185](https://github.com/officialJCReyes/kinship/issues/185)) ([aaf5c2c](https://github.com/officialJCReyes/kinship/commit/aaf5c2c499e35d89901ce1c008a2ecf09e788802))
* disable and enable an account ([#184](https://github.com/officialJCReyes/kinship/issues/184)) ([72349dc](https://github.com/officialJCReyes/kinship/commit/72349dca6a3b1640e31377e7227e832f9a6e4302))
* find a person from the chart, and an N of M people counter ([#147](https://github.com/officialJCReyes/kinship/issues/147)) ([46adb54](https://github.com/officialJCReyes/kinship/commit/46adb54ba66a0be54d90bd1ed829564f7639d856))
* **finder:** draw the shared ancestors of each link in the path ([#253](https://github.com/officialJCReyes/kinship/issues/253)) ([30c5ad1](https://github.com/officialJCReyes/kinship/commit/30c5ad19ba53e94345513159c2ac3aa91e06b29a))
* GET /api/relationship, how one person is related to another ([#174](https://github.com/officialJCReyes/kinship/issues/174)) ([4b4d343](https://github.com/officialJCReyes/kinship/commit/4b4d343fd162733232a93cb2af148ee36c6287de))
* hide aunts, uncles and cousins by default, with a gear setting to show them ([#168](https://github.com/officialJCReyes/kinship/issues/168)) ([8baece7](https://github.com/officialJCReyes/kinship/commit/8baece77797806d889a8b398099fee2b0d3f197c))
* Media page and tab, GET /api/media (37e) ([#218](https://github.com/officialJCReyes/kinship/issues/218)) ([a1a24e3](https://github.com/officialJCReyes/kinship/commit/a1a24e3e26d10fae762c9dc5eafa11195511d883))
* migration 0019, disable, delete and role change in SQL, no route yet ([#181](https://github.com/officialJCReyes/kinship/issues/181)) ([cd8e6d6](https://github.com/officialJCReyes/kinship/commit/cd8e6d68a82438e323bc2bd306ff8e97bf38c478))
* name prefix, nickname, surname particle and suffix in Add relative, Edit details and the profile ([#141](https://github.com/officialJCReyes/kinship/issues/141)) ([23b3053](https://github.com/officialJCReyes/kinship/commit/23b3053b1a1e95cf93df70c9114ec08eae608b6b))
* name prefix, suffix, nickname and surname particle; four name forms (migration 0017, ADR 0024) ([#140](https://github.com/officialJCReyes/kinship/issues/140)) ([c5ea1ff](https://github.com/officialJCReyes/kinship/commit/c5ea1ff88acb1959b01e827a472a5a85dbed7053))
* **names:** prefix and suffix as drop downs ([#250](https://github.com/officialJCReyes/kinship/issues/250)) ([bd766f7](https://github.com/officialJCReyes/kinship/commit/bd766f7bfff2fcc49d5cc23de83fdb90d0775fb5))
* **names:** the name form layout ([#251](https://github.com/officialJCReyes/kinship/issues/251)) ([6a4d014](https://github.com/officialJCReyes/kinship/commit/6a4d01435c1a33d79eaed2e4b62c29e69c7b8f71))
* **photos:** remove a profile photo from the camera menu ([#252](https://github.com/officialJCReyes/kinship/issues/252)) ([53ee550](https://github.com/officialJCReyes/kinship/commit/53ee55090f77c530a624e0d3407b7b7eb0bdcf6e))
* siblings' partners in the family view, and a legend line ([#149](https://github.com/officialJCReyes/kinship/issues/149)) ([0a1407a](https://github.com/officialJCReyes/kinship/commit/0a1407a29cece838b74d836cc49835f3d28d7870))
* store the chart's own settings on the account (migration 0018) ([#163](https://github.com/officialJCReyes/kinship/issues/163)) ([8a6047f](https://github.com/officialJCReyes/kinship/commit/8a6047f344e36ed3947c8b566a0f28d94c6f4a96))
* the Descendants view: everyone below a person, children grouped under their parent, partners on the card ([#159](https://github.com/officialJCReyes/kinship/issues/159)) ([a0b93aa](https://github.com/officialJCReyes/kinship/commit/a0b93aa3d90d67ca203e9b48c9b26a8c466a4f57))
* the Family tree opens centred on the home person when it would not fit at 0.7 ([#165](https://github.com/officialJCReyes/kinship/issues/165)) ([186a3b5](https://github.com/officialJCReyes/kinship/commit/186a3b5254db2adc6d570048eebefa84c4526ab9))
* the Fan view: blood ancestors as rings, the father's side green on the left and the mother's amber on the right ([#160](https://github.com/officialJCReyes/kinship/issues/160)) ([70bbaee](https://github.com/officialJCReyes/kinship/commit/70bbaee6757ef2cde77220b1f13a31fb625ed935))
* the Pedigree view: blood ancestors in columns, with empty slots for missing parents ([#158](https://github.com/officialJCReyes/kinship/issues/158)) ([de0b160](https://github.com/officialJCReyes/kinship/commit/de0b160433a275855679c847480bd8f5a151e671))
* the relationship finder page ([#175](https://github.com/officialJCReyes/kinship/issues/175)) ([7c8f5b7](https://github.com/officialJCReyes/kinship/commit/7c8f5b70aff1f7b4b767906cfd4e0bf6852fbf22))
* the relationship finder's naming rules and graph walk (shared, pure) ([#173](https://github.com/officialJCReyes/kinship/issues/173)) ([00a60bf](https://github.com/officialJCReyes/kinship/commit/00a60bf1b58e20c6df796326fd239e177fcb8b82))
* the tree response says how many people the viewer may see (totalPeople) ([#146](https://github.com/officialJCReyes/kinship/issues/146)) ([bdd37dd](https://github.com/officialJCReyes/kinship/commit/bdd37dd456727d66fe98f748d72c311e2e02e124))
* **tree:** a "+" on each card opens Add relative ([#255](https://github.com/officialJCReyes/kinship/issues/255)) ([4eca860](https://github.com/officialJCReyes/kinship/commit/4eca860bd70ddff011c4653d16c274f2a034c209))
* **tree:** double-click a person to open the side panel ([#254](https://github.com/officialJCReyes/kinship/issues/254)) ([a840c91](https://github.com/officialJCReyes/kinship/commit/a840c91099c7ca7559a491ef120438dcd45ef43b))
* Users page disable, enable and delete dialogs and the disabled row ([#187](https://github.com/officialJCReyes/kinship/issues/187)) ([c28a1e9](https://github.com/officialJCReyes/kinship/commit/c28a1e97283496327015cf8dc3ba77d4e0113840))
* Users page row actions menu and Change role dialog ([#186](https://github.com/officialJCReyes/kinship/issues/186)) ([62f7597](https://github.com/officialJCReyes/kinship/commit/62f7597d0385b43be76b2c7f85f0ddf545f04d7e))
* **web:** Add parent asks which brothers and sisters are the new parent's too ([#266](https://github.com/officialJCReyes/kinship/issues/266)) ([7c49c6b](https://github.com/officialJCReyes/kinship/commit/7c49c6ba1d36cb9ab8fd4a89fe156ebc449589e4))
* **web:** Add partner asks which children are the partner's too ([#265](https://github.com/officialJCReyes/kinship/issues/265)) ([f803dc7](https://github.com/officialJCReyes/kinship/commit/f803dc75806c2e533629227771f0dd31be7596a1))
* **web:** calendar picker beside every typed date, ported from [#92](https://github.com/officialJCReyes/kinship/issues/92) ([#200](https://github.com/officialJCReyes/kinship/issues/200)) ([52b81fc](https://github.com/officialJCReyes/kinship/commit/52b81fc09820c17bcb4aed0ca4ea6548f6f01e51))
* **web:** first-run Review step gets a Check for new versions switch ([#213](https://github.com/officialJCReyes/kinship/issues/213)) ([2763c49](https://github.com/officialJCReyes/kinship/commit/2763c4958cc449cc7533304e05e298fe6f024bcc))
* **web:** link a partner's child to both parents from the profile ([#268](https://github.com/officialJCReyes/kinship/issues/268)) ([baffd14](https://github.com/officialJCReyes/kinship/commit/baffd140e5d38ce54b47bca56b0cf9639193cecc))
* **web:** one way to set a person's photo: upload new or choose an existing one ([#238](https://github.com/officialJCReyes/kinship/issues/238)) ([7f4f78d](https://github.com/officialJCReyes/kinship/commit/7f4f78d34b9ce53ebf3ede4527409be390edc1f1))
* **web:** photos on profiles, avatars everywhere, journeys 15 and 16 (37d) ([#215](https://github.com/officialJCReyes/kinship/issues/215)) ([9cb21e3](https://github.com/officialJCReyes/kinship/commit/9cb21e3c44fc024b01a4b7b77c35e9079b738ee2))
* **web:** Restore button, dialog and maintenance page ([#202](https://github.com/officialJCReyes/kinship/issues/202)) ([9223830](https://github.com/officialJCReyes/kinship/commit/9223830e7d4ca48b6ea45f04854b6c57e33023e6))
* **web:** set as profile picture straight from the gallery ([#239](https://github.com/officialJCReyes/kinship/issues/239)) ([645187b](https://github.com/officialJCReyes/kinship/commit/645187b0e8d2e5e7d458d52b469620c9e875d43f))


### Bug Fixes

* a themed focus ring and a bigger checkbox on My settings, Names ([#148](https://github.com/officialJCReyes/kinship/issues/148)) ([3fc27bd](https://github.com/officialJCReyes/kinship/commit/3fc27bd5f83acb4b8183317ebf356d80ecf79621))
* **api:** a photo deleted while a backup runs no longer fails the backup ([#217](https://github.com/officialJCReyes/kinship/issues/217)) ([4056abc](https://github.com/officialJCReyes/kinship/commit/4056abc30bd70d6099217eedbde5165ced9d1b75))
* **api:** do not fail a restore when tar is stopped after pg_restore succeeded ([#241](https://github.com/officialJCReyes/kinship/issues/241)) ([e8cf380](https://github.com/officialJCReyes/kinship/commit/e8cf3809a44792dbf48786d7064d7207e5f7e78c)), closes [#240](https://github.com/officialJCReyes/kinship/issues/240)
* **api:** keep the backup download ticket out of the logs ([#74](https://github.com/officialJCReyes/kinship/issues/74)) ([#234](https://github.com/officialJCReyes/kinship/issues/234)) ([64a6231](https://github.com/officialJCReyes/kinship/commit/64a6231b34c2605dc35c810adaa9ec252051c618))
* **finder:** remove the paragraph on how the answer is worked out ([#248](https://github.com/officialJCReyes/kinship/issues/248)) ([61dd276](https://github.com/officialJCReyes/kinship/commit/61dd2765c2263972d9ff3bb4361cf2d40b01eae1))
* **names:** fold the surname particle into the surname ([#249](https://github.com/officialJCReyes/kinship/issues/249)) ([53927e3](https://github.com/officialJCReyes/kinship/commit/53927e3794542d9f4dda11087500686992466e28))
* **release:** skip the UPGRADE.md breaking-changes rule in the pull request preview when the version is already released ([#216](https://github.com/officialJCReyes/kinship/issues/216)) ([e224da4](https://github.com/officialJCReyes/kinship/commit/e224da4bb8eca71c2888f1ff0fdb47adc4b232aa))
* **shared:** the finder reads a Separated former partner as ex- ([#180](https://github.com/officialJCReyes/kinship/issues/180)) ([6885b1c](https://github.com/officialJCReyes/kinship/commit/6885b1cbe1b3e58ecea99dc9f591f7e471aef05b))
* **test:** check free space against the database size the error reports ([#258](https://github.com/officialJCReyes/kinship/issues/258)) ([67dc6db](https://github.com/officialJCReyes/kinship/commit/67dc6db753f276dbb03e3c6ba86bee3e6281cd60))
* **test:** keep loaded queries in the web tests' query client ([#257](https://github.com/officialJCReyes/kinship/issues/257)) ([b0bd399](https://github.com/officialJCReyes/kinship/commit/b0bd3998850aa3942277b73db6abab33d2a0d319))
* **test:** one assertion per layout in the nub clearance test ([#267](https://github.com/officialJCReyes/kinship/issues/267)) ([31e8ff1](https://github.com/officialJCReyes/kinship/commit/31e8ff1b3c1d99e46c4d0444e25beedb19010410))
* **web:** centre the sign-in card header ([#235](https://github.com/officialJCReyes/kinship/issues/235)) ([8d09aa9](https://github.com/officialJCReyes/kinship/commit/8d09aa980915c25f7299c5d11fa6de0848861631))
* **web:** keep select arrows inside their boxes and match the photo icon ([#236](https://github.com/officialJCReyes/kinship/issues/236)) ([9d3ad16](https://github.com/officialJCReyes/kinship/commit/9d3ad166aae786f6737b60cb74d5336d70ca4345))
* **web:** remember the legend and hide it by default ([#237](https://github.com/officialJCReyes/kinship/issues/237)) ([d9b9e52](https://github.com/officialJCReyes/kinship/commit/d9b9e525cd445827a3acf8c6d626326f4c5b1b0f))
* **web:** say profile photo everywhere ([#242](https://github.com/officialJCReyes/kinship/issues/242)) ([71919d0](https://github.com/officialJCReyes/kinship/commit/71919d0e05005b7877281a86af86641a7846ad65))
* **web:** the Users row menu follows its button when the page scrolls instead of closing ([#189](https://github.com/officialJCReyes/kinship/issues/189)) ([8e8efdc](https://github.com/officialJCReyes/kinship/commit/8e8efdc8c7bda5b5724e78556308f89a52d08fe4))

## [0.3.0-rc.4] - 2026-11-24

Fourth release candidate of 0.3.0. From rc.3 it is an image update with no database change; back up first as always. If you are on rc.1, rc.2 or 0.2.1, read UPGRADE.md first.

### Added

- When you add a partner, Add relative asks which of the person's children are the partner's too. Every child is ticked when the person has no other relationship; otherwise none is. The ticked children hang from the couple, each with the same kind of link it had (birth or adoptive).
- When you add a second parent to a child, Add relative also lists that child's brothers and sisters who have only the first parent, so the ones who share the new parent can be linked in the same step. None is ticked to start with.
- On a profile, a partner's child marked "other parent not on the tree" has an "Also {name}'s child" button. It links that child to both parents, and you can tick the partner's other such children to link them in one go. This is how a tree entered one parent at a time is repaired.
- All of this is for admins, and everything in one save is kept or nothing is: if one child cannot be linked, the form says which one and why. For developers: new admin-only API calls add a partner or a parent together with the children they share (ADR 0039).

### Fixed

- A child who was entered under one parent first, before the other parent was added, no longer shows as a stepchild of their own parent or a half-sibling of their full brothers and sisters once linked to both parents.
- A slow automated chart test that sometimes ran out of time is fixed. Nothing changes in the app.

## [0.3.0-rc.3] - 2026-11-24

Third release candidate of 0.3.0. From rc.1 or rc.2 it is an image update with one database change (migration 0024), so back up first; if you are on 0.2.1 read UPGRADE.md first.

### Added

- Remove profile photo: the camera menu on a person's picture, on the profile and in the tree's person panel, can unset the profile photo after asking. The photo itself stays in the person's Photos and on the Media page.
- Double-click or double-tap a person on the chart to open the side panel, even when you have collapsed it; Shift+Enter does the same from the keyboard.
- A "+" on the bottom edge of each card in the Family tree, Pedigree and Descendants charts opens Add relative for that person. It is shown on the people the side panel would offer Add relative for.

### Changed

- The Relationship finder draws the path as a diagram, with each person's photo or initials and years. When two people are linked through brothers, sisters or cousins, the parents they share are drawn above that link, so an in-law or step relationship shows who connects them; the path in words lists those shared parents too. The paragraph explaining how the answer is worked out is gone.
- A surname particle (de, de la, van) is now simply part of the surname. The separate "Surname particle" field is gone, and the upgrade moves each stored particle to the front of its surname ("de la Cruz"). Initials and sorting use the surname as written.
- Prefix and suffix are chosen from a list (Dr., Mrs., Jr., III and others), with "Other…" for anything else. A prefix or suffix typed before that is not in the list is kept as it was.
- The name form starts with Given (and middle) name and Surname, then second and married surname, then prefix, suffix and nickname. Required fields are marked with an asterisk, and the form opens with the cursor in Given name.

### Fixed

- Automated tests that failed now and then (two chart tests, and the backup and restore free-space checks) are fixed. Nothing changes in the app.

## [0.3.0-rc.2] - 2026-11-23

Second release candidate of 0.3.0. If you are on rc.1 this is an image update only; if you are on 0.2.1 read UPGRADE.md first.

### Changed

- Set a person's profile photo from the camera on their picture, on the profile or in the tree's person panel: upload a new photo, or choose one of the photos that already show them. You can also set it straight from the Media page or a profile's Photos card, without opening the photo.
- The tree legend starts hidden behind a small Legend button. Open or close it and it stays that way as you move between people, views and families.
- The sign-in card is centred, with one logo mark and one line for a forgotten password.

### Fixed

- Dropdown arrows stay inside their boxes.
- The backup download link no longer appears in the server logs.
- A restore no longer fails with "pg_restore failed" after the database had been read in full. This could happen at random, more often with many photos; the restore then changed nothing.

## [0.3.0-rc.1] - 2026-11-22

Release candidate of 0.3.0. Back up first and read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md).

### What 0.3.0-rc.1 adds

- Profile photos: add a photo from a profile, set it as the profile picture, and browse every photo on the new Media tab. Photos are encrypted before they are stored, need a file key and a `./data/files` folder (see UPGRADE.md), and are included in backups and restores.
- New Relationship finder: pick any two people and see how they are related, with cousin levels, half and in-law names, and the path between them.
- Admins can change an account's role, disable an account (it is signed out at once and can be enabled again) and delete a disabled account. The last SuperAdmin can never be demoted, disabled or deleted.
- Admins can restore a backup and the photos from Admin, Backups, with a maintenance page while it runs; a safety copy is taken first.
- Dates can be picked from a calendar, and each person chooses which day the week starts on in My settings.

### Changed

- Charts now hide aunts, uncles and cousins by default. Turn them back on in the new gear panel, where you can also choose how the mouse wheel works and which view opens first.

## [0.2.1](https://github.com/officialJCReyes/kinship/compare/v0.2.0...v0.2.1) (2026-11-19)


### Bug Fixes

* **web:** make the good-status pill readable in the four light color schemes ([#121](https://github.com/officialJCReyes/kinship/issues/121)) ([ef5b3b5](https://github.com/officialJCReyes/kinship/commit/ef5b3b5d5638d21f9df338d3356635b6d4f05c70)), fixes [#44](https://github.com/officialJCReyes/kinship/issues/44)
* **web:** show the KinShip logo in the header and on the sign-in, setup and About pages ([#120](https://github.com/officialJCReyes/kinship/issues/120)) ([eb06fc3](https://github.com/officialJCReyes/kinship/commit/eb06fc3ea6e1893971ee2c1b7c0ab82e7c839f72))

## [0.2.0] - 2026-11-18

**KinShip 0.2.0, "A tree you can trust". The data promise starts here:** an upgrade keeps your data, and a safety copy of the database is made before every database change. If you run 0.1.0-alpha.2, read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) before updating: it needs a backups folder and a backup passphrase first. From a 0.2.0 release candidate it is an image update.

### Added

- **Backups and restore.** Encrypted backups (one file, your passphrase), on a schedule or on demand. "Test the latest backup" restores the newest one into a temporary database and compares it with the original. A download asks for your password again, and `kinship restore` restores on the server. A safety copy is also written before every database change. See [ADR 0014](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0014-backup-and-owner-access.md).
- **Updates.** Admin → Updates tells the SuperAdmin when a new version is out (once a day KinShip reads GitHub's public release list; it sends nothing about your install, and the switch is in the app). "What's changing" shows what an update does, with a backup warning when it changes the database, and every admin sees a "What's new" popup after an update. The web and the api must be the same version, and say so if they are not. See [ADR 0015](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0015-update-check-and-whats-new.md).
- **A seven-step first-run wizard** (account, tree, you, partner, parents, children, review) that creates your account, your tree and your closest relatives all at once. Partner, parents and children can be skipped.
- **Invitations and passwords.** Admins invite people with a link they copy, make a set-password link for someone locked out (the account shows that an admin set the password), and everyone can change their password.
- **Link an existing account to a person** ([#8](https://github.com/officialJCReyes/kinship/issues/8)). In Admin → Users an admin can link an account that has no person to a person on the tree, change the link or unlink it, so accounts upgraded from an alpha are not left unlinked.
- **A brother or sister for someone with no parents.** Add relative adds an "Unknown father" and an "Unknown mother" (dashed cards on the chart; give one a name and it becomes an ordinary person). They never appear in the people list, in search or in counts.
- **My settings.** Four color schemes, light, dark or device, a date format, which surname shows, and which family the charts follow for an adopted person.
- **A fuller relationship model.** Second and married surnames; a Married relationship becomes Widowed automatically when a partner is marked deceased; custom relationship labels (Godmother, Guardian); step relatives, and a partner's children from another relationship.

### Changed

- Dates read "Jan 1, 2026" by default (the alpha showed "January 1, 2026"); each person can change it. "My profile" and "About" moved into the account menu.
- Tree cards show the whole name; the border color is the only sign of sex; a selected card is tinted as well as ringed.
- Success messages are a small pill that fades after about 5 seconds.
- **Admin → Updates is quieter.** The long explanations under "Check for new versions" and "Safety copy before a database change" are now a small "i" button next to the name: hover it, focus it with the keyboard, or tap it to read them (Escape closes it). Screen readers still read them as the description of the checkbox. The "What's new" popup no longer starts with a grey paragraph about where it comes from.
- **One-time data change:** every Married relationship with a deceased partner becomes Widowed. The database gains migrations 0007 to 0016, applied at startup after a safety copy: see [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md).

### Fixed

- An invitation can no longer be made for an "Unknown father or mother".

### What it does not include yet

- **Profile photos and media upload**, and an in-app Restore button (restore is a command on the server).
- Changing an account's role, and disabling or deleting accounts.
- The other chart views, the relationship finder, reports, GEDCOM import and export, sources, places, DNA and health history.
- Email (invitations and password links are copied by hand) and single sign-on.

## [0.2.0-rc.3] - 2026-11-18

**A third release candidate for 0.2.0. The database changes twice more (migrations 0015 and 0016, schema 14 to 16, no data changes):** a safety copy is made first, and nothing in your tree is touched. Upgrading from rc.1 or rc.2 is an image update; from 0.1.0-alpha.2 read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) first. Release candidates are offered by the in-app update check only when "Include pre-releases" is on.

### Added

- **A brother or sister for someone with no parents.** Add relative no longer asks you to add a parent first. When the person has no parents on the tree, KinShip adds an "Unknown father" and an "Unknown mother" for them and links both children to them, in one step. They are dashed cards on the chart; give one a name (Add details) and it becomes an ordinary person. They never appear in the people list, in search or in counts.

- **Link an existing account to a person** ([#8](https://github.com/officialJCReyes/kinship/issues/8)). In Admin → Users an admin can link an account that has no person to a person on the tree, change the link, or unlink it. The dialog says what the link changes before anything is saved (for a Member: the person and the people they added below them). One person has at most one account and one account at most one person; a person with an open invitation, and an "Unknown father or mother", cannot be linked. A SuperAdmin links any account, a Family Admin Members, Users and their own. Every link, change and unlink is one line in the api log, with ids only.

### Fixed

- **An invitation can no longer be made for an "Unknown father or mother".** The Invite dialog never offered one, but the API accepted it, and accepting such an invitation would have failed with an unexplained error. It now answers `person_is_placeholder`.

### Changed

- **Success messages are a small pill** at the top centre that fades after about 5 seconds (and waits while the pointer or keyboard focus is on it). Warnings are still bars with a Dismiss button.
- The database changes twice more (migrations 0015 and 0016, no data changes): see [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md).

## [0.2.0-rc.2] - 2026-11-17

**A second release candidate for 0.2.0. No database change** (the schema stays at 0014), so upgrading from 0.2.0-rc.1 is a plain image update; from 0.1.0-alpha.2 read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) first.

### Added

- **A date of birth for your partner in the first-run wizard.** Optional: a year, a month or a full date, exact or approximate, shown in your date format.

### Changed

- **Tree cards show the whole name.** Every card is now the same size, with room for three lines of name; a long name wraps and, if it still does not fit, gets a smaller type size instead of being cut with "…". The male and female icon is gone: the border colour (blue, orange, grey for other or unknown) is the only sign, and the sex is still in the card's name for screen readers. The legend reads "Other or unknown".
- **A selected card is tinted as well as ringed,** so it stands out in every colour scheme.
- **The person panel shows the birth surname** when a married surname is the one shown ("Birth surname: Ruiz").

## [0.2.0-rc.1] - 2026-11-17

**A release candidate for 0.2.0, "A tree you can trust". The data promise starts here:** upgrades keep your data, and a safety copy is made before each database change. Read [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md) before upgrading from an alpha: it needs a backups folder and a backup passphrase first. Release candidates are offered by the in-app update check only when "Include pre-releases" is on.

### What 0.2.0-rc.1 adds

- **Backups and restore.** Encrypted backups (one file, your passphrase), on a schedule or on demand, with a test that restores the newest one into a temporary database, a download that asks for your password again, and `kinship restore` on the server. A safety copy of the database is written before every database change. See [ADR 0014](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0014-backup-and-owner-access.md).
- **Updates.** Admin → Updates tells the SuperAdmin about a new version (a daily read of GitHub's public release list that sends nothing about your install, switched on or off in the app), shows what it changes with a backup warning, and every admin sees a "What's new" popup after an update. The web and the api must be the same version, and say so if they are not. See [ADR 0015](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0015-update-check-and-whats-new.md).
- **A seven-step first-run wizard** that creates your account, your tree, you, and optionally a partner, parents and children, all at once.
- **Invitations and passwords.** Admins invite people by a link they copy; an admin can make a set-password link for someone locked out, and the account shows that an admin set the password; everyone can change their password.
- **My settings.** Four color schemes, light or dark, a date format, which surname shows, and which family the charts follow for an adopted person.
- **A fuller relationship model.** Second and married surnames; Married relationships become Widowed automatically when a partner is marked deceased; custom relationship labels (Godmother, Guardian); step relatives, and a partner's children from another relationship.

### Changed

- Dates now read "Jan 1, 2026" by default (the alpha showed "January 1, 2026"). Each person can change it.
- The top bar's "My profile" and "About" moved into the account menu.
- The database gains migrations 0007 to 0014, applied at startup after a safety copy. **One-time data change:** Married relationships with a deceased partner become Widowed.

### What it does not include yet

- **Profile photos and media upload** (planned for 0.3), other chart views, the relationship finder, reports, sources, places, DNA and health history.
- **A Restore button** (restore is a command on the server) and S3 or other backup destinations.
- **Email** (invitations and password links are copied by hand) and single sign-on.

## [0.1.0-alpha.2] - 2026-11-16

**This is an alpha. Data may be wiped between 0.1.x releases, so nobody should enter real family data.** It is the first release with a family tree: you can add people and relationships and see them on a chart.

### What 0.1.0-alpha.2 adds

- **First run with your own person.** Setup can create the first person and link it to your SuperAdmin account; "My profile" opens it.
- **People and relationships.** Add, edit and delete people; partner relationships with a status (married, divorced, engaged, partner and more) and dates; parents, children and siblings with **Add relative**; name search that ignores case and accents. A child hangs from a relationship (or from one parent), so the children of an earlier marriage stay with that marriage. Dates keep the precision they were typed with ("about 1955", "before 1950").
- **Roles that are enforced.** SuperAdmin and Family Admin edit everything; a Member edits their own profile and adds children below themselves; a User reads. Every rule is checked twice, in the API and by PostgreSQL row-level security. (There are still no invitations, so Members and Users cannot be created in the app yet.)
- **The family tree chart.** Pan, zoom (wheel, pinch, buttons, keyboard) and fit; couples joined by a solid or a dotted line (together, or ended), children hanging from their relationship, a legend, and a person panel with Edit details, Add relative and the person's relationships. A **small green leaf** on a spouse opens that spouse's own family and flips the chart to it; a partner's own children from before are drawn under them. It stays smooth with over a thousand people. Light and dark theme, keyboard navigation and screen-reader names. See [ADR 0006](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0006-tree-view.md).
- **Adoption.** A person can have birth parents and adoptive parents, each with an optional date. Each viewer chooses which family the charts follow (adoptive by default; the profile has a switch), and a second leaf opens the other family. The profile always lists both. Only admins add adoptive links. See [ADR 0007](https://github.com/officialJCReyes/kinship/blob/main/docs/decisions/0007-adoption-parentage.md).
- **Tests and docs.** End-to-end tests in a real browser against the real containers (not a required check), screenshots and the logo in the README, and the decisions in `docs/decisions/`.

### Changed

- The database gains the people, relationship, parent-link and account-setting tables (migrations 0003 to 0006), applied automatically at startup.
- The shared API types and the password rule live in one place (`packages/shared`).
- **Upgrading from 0.1.0-alpha.1:** see [UPGRADE.md](https://github.com/officialJCReyes/kinship/blob/main/UPGRADE.md).

### What it does not include yet

- **Other chart views** (pedigree, fan, descendants), the relationship finder, reports, photos, sources, places, DNA and health history.
- **Users page and invitations** for Members and Users, and the My settings page.
- **No backup or restore feature** (the install guide shows how to dump the database by hand), no update notice, no email, no single sign-on.
- **No upgrade promise.** Until 0.2 a new release may require starting with an empty database.

## [0.1.0-alpha.1] - 2026-11-15

**This is an alpha. Data may be wiped between 0.1.x releases, so do not enter real family data.** It is the first release that can be installed: it proves the whole delivery chain, but there is no family tree yet.

### What 0.1.0-alpha.1 includes

- **Install with Docker Compose**: one `compose.yml`, one `.env`, three services (`web`, `api`, `db`). Images are published to GHCR for linux/amd64 and linux/arm64, with the same version tag for web and api. See [INSTALL.md](INSTALL.md).
- **First-run setup**: a one-time setup token is printed in the api log; with it you create the SuperAdmin account and name your tree.
- **Sign in and out**: local accounts, argon2id passwords (at least 12 characters), server-side sessions, CSRF protection, sign-in rate limits.
- **Recovery**: `docker compose exec -it api kinship set-password <email>` for whoever runs the server.
- **Database**: PostgreSQL 18 with row-level security, an owner role that migrates and a separate app role that serves requests, migrations applied automatically at startup (forward-only, checksummed).
- **About page** with the web and API versions, the database schema number, the build date and commit, the license and the source link; the same version and source link on the sign-in screen.
- **Health checks** on every service; `/api/health`, `/api/version`.
- Light and dark theme following the device; English text as translation keys.

### What it does not include yet

- **People, relationships and the family tree.** There is nothing to put in your tree yet; the home page says so. Adding and editing people, parents, partners and children, the tree view and profile facts come before 0.1.0.
- **Roles are stored** (SuperAdmin, Family Admin, Member, User) but only the SuperAdmin created by setup exists; there are no invitations or screens for the others.
- **No backup or restore feature.** The install guide shows how to dump the database by hand. A built-in backup arrives in 0.2.
- **No update notice, no "What's new" popup, no file storage, no email, no single sign-on, no password reset by email.** Later releases add them.
- **No upgrade promise.** Until 0.2, a new release may require starting with an empty database.

[0.2.0]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.2...v0.2.0
[0.2.0-rc.3]: https://github.com/officialJCReyes/kinship/compare/v0.2.0-rc.2...v0.2.0-rc.3
[0.2.0-rc.2]: https://github.com/officialJCReyes/kinship/compare/v0.2.0-rc.1...v0.2.0-rc.2
[0.2.0-rc.1]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.2...v0.2.0-rc.1
[0.1.0-alpha.2]: https://github.com/officialJCReyes/kinship/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/officialJCReyes/kinship/releases/tag/v0.1.0-alpha.1
