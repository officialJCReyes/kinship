# KinShip: surgeries and procedures in the medical record (Nov 15, 2026)

Asked by JC: the medical history only held blood type and conditions, so a person's surgeries had nowhere to go. This adds them. Companion to `kinship-v2-requirements.md` (Medical history, Medical visibility) and `kinship-family-health-history-report.md`. **Status:** JC asked for this to be added to the docs for the build. **Decided by JC (Nov 15): surgeries stay private by default**, like the rest of the medical record (nothing is visible to anyone until the person shares the record; the per-entry Private checkbox stays unchecked by default and only hides one entry from the people the record is shared with). Other details marked *(assumption)* are my defaults and need JC's yes. The HTML mockup has **not** been updated; this doc is the specification until it is. The release plan's v0.6 section now includes surgeries.

## What was missing
- The medical record was blood type plus conditions (name, since-year, status, optional source URL). A surgery does not fit a condition: it is a dated event with no status.
- **Cause of death** is a separate field and the **Events tab** has no health types, so nothing recorded surgeries anywhere.
- The family health history report listed conditions and cause of death only.

## Decision: a section of the medical record, not an event type
The Events tab is visible to every account. A surgery is health information and must follow the same privacy rules as conditions (private by default, shared person by person, visible to all after death). So surgeries are a **second section inside Medical history**, protected by the same row-level security. They are **not** an event type, and health details should not be entered under Events "Other". *(assumption: the Add event dialog gets a one-line note, "Health events go in Medical history, where they stay private.")*

## What is a "procedure"
Operations and invasive procedures a doctor would ask about: appendectomy, joint replacement, bypass, stent, transplant, cesarean, hysterectomy, mastectomy and so on. Not routine tests, vaccines, dental cleanings or screenings. *(assumption)*

## What is recorded for each one
| Field | Notes |
|---|---|
| Procedure | Required. Chosen from a searchable list (below). |
| Date | Flexible entry as everywhere else (YYYY, YYYY-MM, YYYY-MM-DD, with the Exactly / About / Before / After precision). Optional, because many people only know "around 1998". |
| Age at the time | Worked out from the date and birth date, never typed. Shown when both are known. |
| Related condition | Optional pick from that person's own conditions (for example Cancer · Breast → Mastectomy). Gives context without a second diagnosis. Clearing or deleting the condition keeps the surgery and drops the link. |
| Where | Optional, from the Places library (a place of kind *hospital* already exists). |
| Notes | Optional free text (complications, side, "both knees"). |
| Source URL | Optional, same as conditions. |
| Private | Checkbox, same meaning as on a condition: only the person sees it while living. |

A person can have the **same procedure more than once** (two knee replacements), so a procedure already on the record is not greyed out the way a condition is.

## Choosing a procedure (same pattern as conditions)
- A searchable list of about **45 common procedures**, grouped by area, matching common names ("gallbladder", "C-section", "tonsils").
  - Heart and vessels: coronary bypass (CABG), angioplasty or stent, heart valve repair or replacement, pacemaker or defibrillator, aneurysm repair, carotid surgery.
  - Digestive: appendectomy, gallbladder removal, hernia repair, weight-loss (bariatric) surgery, colon resection.
  - Reproductive and urinary: cesarean section, hysterectomy, ovary removal, tubal ligation, vasectomy, prostatectomy, prostate procedure (TURP), kidney removal.
  - Breast: mastectomy, lumpectomy, breast reconstruction.
  - Bones and joints: knee replacement, hip replacement, ACL repair, spinal fusion, rotator cuff repair, fracture repair.
  - Eyes, ears, throat, thyroid: cataract surgery, laser eye surgery, tonsillectomy, sinus surgery, thyroidectomy.
  - Skin, lung, brain, transplants: skin cancer removal, lobectomy, craniotomy, kidney, liver and bone marrow transplant.
  - Other: tumor removal.
- If nothing matches, the user types a new name and adds it. **Custom procedures join the family list for everyone**, and **admins can merge and rename** them, exactly like custom conditions and cancer types.

## Where it appears
- **Medical history tab:** a section **Surgeries and procedures** under the conditions, newest first, each row showing procedure, date, age then, related condition, place, and a Private badge. Button **+ Add surgery or procedure**. The same edit, delete and "who can see my record" controls as conditions.
- **Health and DNA overview (admin):** the "Not shared with you" cards say the record is hidden; they never show surgeries.

## Privacy and permissions (identical to conditions, nothing new to decide)
- **Private by default (decided by JC, Nov 15);** shared with specific people through "Who can see my record". Sharing a record shares its surgeries too, except those marked **Private**.
- Marked Private: visible only to the person while living; visible to all after death.
- Deceased person: every non-hidden surgery visible to all accounts.
- Every account can edit its own linked person's surgeries, whatever its role. An admin can edit another person's only when the record is visible to them; the edit goes in the change history and the "An admin edited your medical record" email goes to the person (its wording already says "medical record", so no new email).
- Duplicate merge: medical records, surgeries included, are never merged (existing rule).
- Files attached to a surgery (an operative report, say) are encrypted like all files but follow **the medical record's visibility**, not the "visible to every account" rule used for sources on birth and death.
- Surgeries are not exported in GEDCOM. *(assumption; GEDCOM export keeps living people as "Living" and medical data was never in scope.)*

## Reports (no AI, fixed templates)
- **Family health history for a doctor:**
  - **Own surgeries and procedures** are a section under own conditions, on by default when the patient can see their own record: procedure, year, age, related condition. Private ones are left out unless "Include conditions I marked private" is ticked (the box also covers private surgeries; its label becomes "Include conditions and surgeries I marked private"). A report made for a child never includes the child's own surgeries, as with conditions.
  - **Relatives' surgeries** are **off by default** *(assumption)*, switched on with "Include relatives' surgeries". When on, each relatives table gets a **Surgeries** column (procedure and age). Only what the viewer can already see appears; private ones of living relatives never do; "Unknown (no record)" and "Not shared with me" work as before, and a relative with a visible record and no surgeries says "None recorded". No flag or risk rule is attached to surgeries.
  - Footer and "left out" counts are unchanged and count a relative once, not once per surgery.
- **Life summary:** the optional "health history on record" section lists surgeries beneath conditions, only if the viewer may see that record.
- **Medical patterns:** unchanged (conditions only). Repeating procedures are not analyzed. *(assumption)*
- **Family book:** the health section, when switched on (off by default), includes surgeries under the same rules. (Ships in 1.1.)

## Data model and build notes
- New shared table `procedure_type` (id, name, category, is_custom, created_by), seeded with the common list; same merge and rename tooling as `condition_type`.
- New table `person_procedure` (id, person_id, procedure_type_id, date as text plus precision, related_condition_id nullable, place_id nullable, notes, source_url, is_private default false, created_by, created_at, updated_at). The record-level default is private: no row is readable by anyone but the person until the record is shared.
- **Row-level security policies copy `person_condition` one for one** (own person; shared with the viewer; deceased person; private rows only for the person while living; writes only by the linked account, or by an admin when the record is visible to them). The role-by-role privacy test suite (release 0.6) must try to read and write `person_procedure` as every role.
- Changes to `person_procedure` write to the same change history as conditions, with the same grouping (edits by one admin within 15 minutes become one email).
- Translation keys for the procedure list so the community can translate it.

## Ships in
**0.6.0 "Health, and privacy done right"**, with the rest of medical history (blood type, conditions, sharing). The family health history report change ships with it. Nothing here needs a different release. The release plan (section 6, v0.6.0, and section 10) says so.

## Mockup sample data to add (fictional)
Walter: prostatectomy (related: Cancer · Prostate, resolved). Carla: mastectomy (related: Cancer · Breast, in remission), shared with Marcus. Marcus: appendectomy and one Private procedure. Rosa: hip replacement. These exercise sharing, private, related condition and the report column.

## Open
- Relatives' surgeries off by default in the doctor report: right default? (assumption)
- Does the procedure list need to follow a particular clinic's form, as with the checklist topics?
- Whether a relative's "may appear in reports I hand to a doctor" switch (already open in the health history doc) should also cover surgeries. It would, if built.
