# KinShip: GEDCOM coverage and where each gap is closed (Nov 19, 2026; particle line updated Nov 24)

Asked by JC on Nov 19: is anything from the GEDCOM standard missing? The release plan (0.7) only says "GEDCOM 5.5.1 import and export". This note lists what GEDCOM 5.5.1 and 7.0 carry that KinShip does not yet store, and the release that closes each gap. It was written from knowledge of the specifications, not re-checked against the published text; verify a tag before building on it. Companion to `kinship-release-and-deployment-plan.md` (sections 0.3, 0.5, 0.7 and 1.x).

**Decided (JC, Nov 19): spread the changes across releases as below; do not bundle them into 0.6.** 0.6 is the privacy release (medical history, surgeries, identity numbers, the row-level-security test suite) and carries none of this. Small forward-only migrations are easier to test than one large "GEDCOM" migration. Import needs somewhere to put every value, so the data model is finished in 0.5, before 0.7.

Related decision (JC, Nov 19): name prefixes and suffixes are shown by default and not required, for new and existing accounts alike.

## 0.3.0 (in the same name migration as prefix and suffix)
- **Nickname** (GEDCOM `NICK`), in Add person and Edit details, searchable.
- **Surname particles (de, de la, van, von; `SPFX`): changed on Nov 23 (JC).** There is no separate particle field. A particle is just part of the surname ("de la Cruz" is one surname). It was built in rc.1 and rc.2 and folded into the surname by migration 0024 in step 43 (ADR 0038); the column is dropped in a later contract migration. Consequences: a surname starting with "de la" sorts under D and its initials start with D; search is unchanged. **Mapping for 0.7:** on import an `SPFX` is joined to the front of the surname (with a space); on export the whole surname goes in `SURN` and no `SPFX` is written.
- Prefix, suffix and nickname rode on one name migration (0017), ADR and mockup update. Prefix and suffix are pre-populated drop-downs with an "Other..." choice since step 43 (the stored value is still plain text, so `NPFX` and `NSFX` map as before).

## 0.5 (research records; the data model is finished here)
- **Alternate names** (pulled forward from 1.5 on Nov 19): several names per person, each typed (birth, married, also known as, religious, immigrant). Import from MyHeritage and Ancestry brings many of these. Date ranges for names stay in 1.5.
- **Associations** (`ASSO` with a role): links between people who are not kin: godparent, witness, guardian, friend, neighbor. Fits transcription mentions that carry roles (witness, informant) and godparents (compadrazgo).
- **Date forms:** between X and Y, from-to periods, calculated vs estimated vs about, Julian-calendar dates, and the date as originally written. Today: exactly, about, before, after (issue #12 is related).
- **More event types:** christening, cremation, confirmation, first communion, bar or bat mitzvah, ordination, graduation, retirement, probate, will, title, nationality.
- **Marriage detail:** ceremony type (civil or church), banns, license, contract, annulment, divorce filed.
- **Source detail:** quality 0 to 3 (maps to Primary, Secondary, Questionable), call number at the repository, and the quoted text from the source (where a transcription excerpt belongs).

## 0.7 (import and export)
- **Mapping check first:** phase 1 of 0.7 parses a real MyHeritage export (JC's own; GEDCOM files are never committed) read-only and lists every tag with no home. That list guides the rest.
- **Foster parent link** (`PEDI` foster; also sealing): the parent link has birth and adoptive today.
- **External IDs and the original GEDCOM ID** (FamilySearch, WikiTree, Find a Grave, `REFN`, `UID`, `EXID`): a re-import can recognise people it already has. Fits the duplicate merge with 30-day undo.
- **Restriction notices** (`RESN` privacy, confidential, locked): map to KinShip's privacy rules on import.
- **`DEAT Y`** (deceased, date unknown): import and export it.
- **Parser rules:** accept UTF-8, UTF-16 and ANSEL; join `CONC` and `CONT` lines; unknown vendor tags (`_MARNM`, `_UID`, `_PRIM`) go to the "skipped" list, never silently dropped; a comma-separated `SURN` maps to surname plus `secondSurname`; `HUSB` and `WIFE` are partner slots only, with no assumption about gender; KinShip "Not specified" exports as `U`.
- Prefixes and suffixes map to `NPFX` and `NSFX`; `TITL` (nobility title) is a separate event and is not the same field. An imported `SPFX` is joined to the front of the surname (see 0.3.0 above).

## 1.x
- GEDCOM 7.0 export and `.gdz` (zip with media; 5.5.1 only points to file paths). Import accepts both. Ancestry and MyHeritage still export 5.5.1.
- Name transliteration for non-Latin scripts.
- Contact details (address, phone, email) for living relatives, only with strict visibility rules; only if JC wants it.

## Skipped on purpose
LDS ordinances (kept in the skipped list), number of children and number of marriages (worked out), caste, and medical data and identity numbers (already excluded from export; identity numbers only with the export checkbox, see `kinship-identity-numbers.md`).
