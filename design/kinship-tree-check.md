# KinShip: Tree check (consistency report) (Nov 22, 2026)

Asked by JC on Nov 22: a way to find inconsistencies in a tree, such as an ancestor too old to be alive or a parent too young to have children. Companion to `kinship-v2-requirements.md` and `kinship-release-and-deployment-plan.md`.

## Decided (JC, Nov 22)
1. **Release 0.5** (research records, merge, change history). Not in 0.3, so step 37 and the 0.3.0 scope are unchanged.
2. **An admin can dismiss a finding** ("checked, this is correct"). Dismissals are stored.
3. **Findings show in three places only: the Tree check report, inline while editing, and the profile.** Never on the tree chart, its legend, person cards or the person panel.
4. **The default thresholds below are accepted.** The partner age gap, sibling spacing and marriage age rules are dropped.

Fixed rules only: no AI, no network call, nothing invented (ADR 0021). Findings are warnings and never block saving.

## What exists today
`parent_too_young` (`MIN_PARENT_AGE_YEARS = 12`, `packages/shared/src/people.ts`) is returned by the API as `warnings: [{code}]` when a child or parent is added or a birth date changes (ADR 0005). It compares birth years, covers birth links only, and is never stored. The Tree check keeps this rule and reuses its code and wording; it does not replace the inline warning.

## Rules (thresholds accepted by JC; constants first, settings later only if asked)
A finding is raised only when the dates conflict **even in the most favourable reading of their precision** (a year-only date gives the widest window; "about", "before" and "after" widen it). A missing date never produces a finding.

| Code | Severity | Rule |
|---|---|---|
| `death_before_birth` | Error | Death date earlier than birth date. |
| `born_before_parent` | Error | Child born before the parent was born. |
| `parent_too_young` | Warning | Parent under 12 at the child's birth (birth links only; existing rule; any gender). |
| `mother_too_old` | Warning | Female parent over 55 at a child's birth (birth links only). |
| `father_too_old` | Warning | Male, other or unknown-gender parent over 90 at a child's birth (birth links only). |
| `born_after_mother_death` | Error | Child born after a female parent's death. |
| `born_after_father_death` | Warning | Child born more than 9 months after a male, other or unknown-gender parent's death. |
| `too_old_to_be_alive` | Warning | No death date, not marked deceased, and older than 120. |
| `marriage_after_death` | Error | A relationship starts after a partner's death. |
| `ended_before_started` | Error | Relationship end date earlier than its start date. |
| `own_ancestor` | Error | A cycle in the parent links (the API already refuses one; this catches imported or restored data). |

Adoptive links are excluded from the age rules (an adoptive parent can be any age). Placeholders are included in the structural rules and excluded from the age rules.
GEDCOM import (0.7) runs the same module over imported data, so no new rule logic is needed there.

### Mother and father rules (decided approach)
The data model has no mother or father role. A child links to a union (two partners) or to one parent, and `gender` is an optional field on the person (male, female, other, unknown). So the rules go by each parent's own `gender`:
- Female: the 55 limit, and a child born after her death is an Error.
- Male, other or unknown: the more lenient limits (90, and 9 months after death as a Warning). The rule may miss a real problem but never accuses someone wrongly.
- Same-sex couples, a parent whose recorded gender differs from their biological role, and surrogacy are not modelled; a finding that does not fit is dismissed with a note.
- Phase 1 should confirm this against the gender values the API accepts and report anything that differs.

## Dismissing a finding
- **Who:** SuperAdmin and Family Admin. Members and Users see findings about people they may see, but cannot dismiss.
- **What it stores:** a table `tree_check_dismissals` with the rule code, the people involved, a **fingerprint of the dates that caused the finding**, an optional note, who and when. If someone edits one of those dates and the rule still fails, the dismissal no longer matches and the finding returns; if the rule no longer fails, the finding is gone either way. A dismissal can be undone from a "Dismissed" tab.
- **Dismissed findings** disappear from the report's main list, the profile count and the inline warnings. The note is visible to admins only, since it may mention private facts.
- **Migration:** forward-only, hand-written, expand-then-contract; row-level security like the other tables (read for any signed-in role through the viewer's visibility, write for admins only). The next migration number follows whatever is latest when 0.5 starts.

## Where findings appear
1. **Report: "Tree check"** (under Reports, with the other fixed-template reports). A table by severity: rule, the people involved (links), the dates that caused it, and a Dismiss button for admins. Filter by rule and by severity; a Dismissed tab. A one-line summary at the top ("12 findings in 2,011 people"). Print and Copy as text like the other reports. English only at launch; every string is a translation key.
2. **Inline, while editing:** Add relative, Edit details and the relationship editor show the matching findings as a warning under the date field, in plain words ("Mary would be 11 at Anna's birth. Saving is still allowed."). It never blocks. This extends the existing `warnings` in the API response with the new codes.
3. **Profile:** a collapsible "Things to check" card on the person's profile listing the findings that involve them, with Dismiss for admins. Hidden when there are none.
- **Not shown:** the tree chart, its legend, the cards, the person panel, search results, the gear panel. No setting is needed because there is no tree display.

## Privacy
Findings are computed only over people and relationships the viewer may see (same row-level security as the people endpoints). A finding that involves a person the viewer cannot see is omitted for that viewer, not shown with a blank name. Living people: their dates follow the existing visibility rules, so a Member does not learn a living person's birth date from a finding.

## Technical shape
- **Rules in `packages/shared`** as pure functions over a small input (people with date parts and gender, links by kind, unions), like the relationship finder, so web and API share them. A `Finding` type with `code`, `severity`, `personIds`, `unionId?`, `fingerprint` and the dates involved.
- **API:** `GET /api/tree-check` (filters, paging), `GET /api/people/:id/findings`, `POST /api/tree-check/dismissals`, `DELETE /api/tree-check/dismissals/:id`. The report reads the whole visible graph in a few queries (the finder does this at about 20 ms per 1,900 people); a 50,000-person guard test is needed.
- **Tests:** Hale family gives none; a set of deliberately broken fixtures gives one finding per rule; precision cases (year-only, "about", "before") prove no false positives; gender cases (female, male, other, unknown) for the mother and father rules; role and RLS tests for dismissing and for hidden people; a dismissal returns after a date edit; e2e journey for the report, inline warning and dismiss (reusing the shared admin sign-in; no new sign-ins).
- ADR needed (next free number at the time): one shared rules module, stored dismissals keyed by fingerprint, gender-based parent rules with lenient fallback.

## Interaction with 0.5 date work
0.5 adds date forms (between X and Y, from-to, estimated, calculated, Julian). The rules read dates through one helper that returns an earliest and latest possible date, so those forms plug in without changing the rules. Phase 1 should confirm this helper against the date-forms design before building.
