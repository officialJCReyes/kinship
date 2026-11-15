# KinShip: Family health history report for doctor visits (Nov 15, 2026)

Asked by JC: one of the main reasons for the health records is that a doctor (PCP) asks about family health history at an appointment. This report produces the one-page summary doctors typically ask for. Built in the mockup at **Archive → Reports → Family health history**, and on Home → Jump to as **Health history for my doctor**. Companion to `kinship-v2-requirements.md` (medical visibility) and the **Medical patterns** report, which stays as the analysis view.

## What it contains (top to bottom)
1. **Header:** patient name, age, birth year, sex, date prepared, "from family records kept in KinShip".
2. **Notes from the patient** (optional free text: why they are going, medicines, allergies).
3. **Own conditions** (optional) with since-year, status and blood type.
4. **What doctors usually ask:** a checklist, one row per topic, saying "None recorded" or "Yes" with which relative and the age at diagnosis. Topics: heart disease or heart attack, high blood pressure, high cholesterol, diabetes, stroke, cancer (with type), osteoporosis, thyroid disease, dementia or Alzheimer's, depression, anxiety or other mental health. Heart disease gets a flag when a parent or sibling was diagnosed **before 55 (men) or 65 (women)**, the age doctors ask about. That is the only flag; there is no risk score.
5. **Relatives:** tables for Parents, Brothers and sisters (half-siblings labelled), Children, and, if chosen, Grandparents and Aunts and uncles (labelled paternal or maternal). Columns: relative, age (living) or age at death with the year, conditions with the **age when diagnosed** (since-year minus birth year), cause of death.
6. **Footer notes:** how many relatives were left out because their record is not shared with the person asking, how many have no record ("unknown, not none"), blood relatives only (in-laws and step relatives left out), and "Reported by the patient from family records. Not checked by a medical professional. Not a diagnosis or a risk estimate."

## Rules
- **Only what the person asking can already see.** A living relative's record appears only if they shared it with that person; a deceased relative's record is visible to everyone. Private conditions of living relatives are never included. Cause of death comes from the death fact (visible to all).
- **Unknown is not none.** A relative with no record shows "Unknown (no record)", and a relative whose record is not shared shows "Not shared with me". Only a visible record with no conditions says "None recorded".
- **Names are off by default.** The page says "Father", "Paternal grandfather", "Paternal aunt". A checkbox turns names on. A warning beside the options says relatives shared with the patient, not with the doctor, and suggests checking with a relative before handing over identifying details.
- **Own conditions** are on by default when the patient can see their own record. Conditions the patient marked **private** are left out unless they tick "Include conditions I marked private" (only offered when making the report for yourself).
- **For a child:** anyone can pick a living child as the patient (a parent taking a child to a pediatrician). The child's own conditions are never included; the report shows the relatives the viewer can see.
- Aunts, uncles and grandparents can be switched off ("Include grandparents, aunts and uncles"). Nieces, nephews, cousins and grandchildren are not included.
- No AI: fixed templates and graph logic.

## Output
Print or save as PDF, Word and plain text (the same buttons as other reports), plus **Copy as text** for pasting into a patient portal form or an email. All options are hidden when printing.

## Open
- Sharing a record with you does not mean the relative agreed to it being given to your doctor. The mockup warns and defaults names off. Should a relative have a separate "may appear in reports I hand to a doctor" switch? (Not built.)
- Whether to add nieces and nephews, cousins and ethnic background, which some forms ask for.
- Whether the checklist topics need to follow a particular clinic's form.
