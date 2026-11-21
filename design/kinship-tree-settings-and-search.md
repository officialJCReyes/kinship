# KinShip: search inside the chart and the tree settings (gear) (Nov 17, 2026; relatives setting added Nov 18; open questions answered Nov 19)

Companion to `kinship-tree-views-and-dna.md` and `kinship-navigation.md`. Written from JC's review of MyHeritage's tree on Nov 17 (screenshots of the in-chart search box and the gear "Settings" panel). **Status (Nov 20):** the in-chart search and the "N of M people" counter are built (step 29 of 0.3.0, #146 and #147); the gear panel is built (step 33, Nov 21, ADR 0027, migration 0018; PRs #163 to #171). JC asked for the two features to be recorded so they can be scheduled. Status words: *Proposed* = my suggestion, not yet decided by JC.

## 1. Search inside the chart (requested by JC, Nov 17)

**What MyHeritage does.** A search box sits in the chart's top bar, next to a people counter ("23 of 718 people" shown out of everyone in the tree), a Tools menu, a generations control and the gear. Typing shows a dropdown of matches: a small avatar, the name with the typed part in bold, and one detail line, which is the person's relationship to the viewer when known ("Mother-in-law's aunt's mother") and otherwise the birth year. Clicking a result jumps the chart to that person.

**Request.** Move the people search into the chart so a person can be found and jumped to without leaving it. (Today search lives on the People page.)

**Proposed behavior**
- Search box in the chart's top bar, with an accessible label and keyboard use (type, Up and Down, Enter to jump, Esc to close).
- Matches names the way the People page does, including maiden and other recorded names (the `search_names` column from migration 0007), and prefixes and suffixes once they exist.
- Each result shows the name, the life years, and the relationship to the viewer using the relationship finder's wording, once the finder exists (0.3). Until then, show the years only.
- **Built (step 29):** choosing a person who is drawn selects them, opens the panel and scrolls the card into view without changing zoom; choosing a person who is not drawn re-roots the chart on them (`/tree/<id>?sel=<id>`), and Center on me brings you back. There is no family-view flip for hidden people (that behaviour exists only in the mockup text). In Pedigree, Fan and Descendants (built in step 32), choosing anyone, drawn or not, re-roots the chart the same way as clicking a node, keeping the view and generations.
- Only people the viewer may see are searched, and nothing private (health, DNA, identity numbers) appears in results.
- **The people counter is part of the first search release (decided by JC, Nov 19):** a counter such as "23 of 718 people" in the top bar showing how many people the current view draws out of everyone the viewer may see (the total never counts people the viewer cannot see).

**Fit with the plan.** The release plan puts "people search and a quick find box" in 0.3, together with the relationship finder, so this belongs in 0.3 and the relationship wording depends on the finder.

## 2. The gear panel (tree display settings)

**What MyHeritage offers** (collapsible groups; the panel has a Restore defaults link):

*Tree preferences, card display:* show edit icons; show add buttons; show birth and death icons; show birthdays and anniversaries; show icons for confirmed matches (DNA/record matches); show black ribbons for deceased people; use solid card colors.
*Layout:* show vertical cards (photo above the name); show cards for adding parents (with a MyHeritage-only "Instant Discovery" sub-option).
*Other:* use the simplified date editor (marked NEW); use the mouse wheel for scrolling the tree (instead of zooming); display adoptive parents by default.

*Name preferences:* how to display married women, four choices: "Married name (born Maiden name)", "Maiden name (Married name)", "Married name", "Maiden name"; a checkbox "When a wife's married name is not provided, show the husband's last name as her married name"; show prefixes (Dr., Sir) and show suffixes (Jr., II).

*Hints preferences:* MyHeritage's record and match suggestions. Not applicable to KinShip.

*More actions:* preferred tree view (Family view and others); edit tree name; back up tree; print chart; tree privacy settings; tree editing permissions; manage all trees; switch back to classic design.

JC's own MyHeritage choice for married women is **"Maiden name (Married name)"**.

**How each maps to KinShip** (what KinShip has today comes from the build handoff and ADR 0011):

| MyHeritage setting | KinShip today | Proposal |
|---|---|---|
| Married women's name display (4 choices) | **Built in step 28 (Nov 20, ADR 0024, migration 0017):** My settings → Names has the four forms (`name_form`, default `maiden_married`) and the prefix and suffix switches; it replaced the old two-way `surname_choice` and applies on cards, the panel, profile, lists and search. The gear panel will show the same settings (step 33) | **Decided (JC, Nov 19): the default is the maiden-name form, "Maiden name (Married name)", for everyone, existing accounts included.** Grow the setting to the four forms, applied on cards, the panel and search. The maiden name was kept off the cards on Nov 17 (too little room), so check the card layout with the new default. Because the default changes what existing accounts see, decide in the phase 1 report how the migration treats `surname_choice` and whether the What's new popup needs a line. |
| Use the husband's surname when none is given | Not built | **Not adopting.** It assumes gender and naming custom, and many families (including Spanish-style double surnames) keep names. If ever added, off by default and worded neutrally (a partner's surname). |
| Show prefixes and suffixes | **Built in step 28 (Nov 20, migration 0017):** the fields are in Add relative and Edit details; the on/off switches are in My settings, Names (the gear shows them in step 33). | **Added to the 0.3.0 scope (JC, Nov 19):** a prefix (Dr., Sir) and a suffix (Jr., II) on each person, in Add person and Edit details, **not required, shown by default for new and existing accounts (JC, Nov 19)**, searchable, with an on/off in the gear's Names group. This is a database change (new person columns, forward-only, expand-then-contract), so it needs its own migration, an ADR, a mockup update before the build and a GEDCOM note for 0.7 (GEDCOM has NPFX and NSFX). **A nickname and surname particles (de, de la, van) join the same migration (JC, Nov 19; see `kinship-gedcom-coverage.md`).** |
| Display adoptive parents by default | Done: My settings → Family, `lineage_view` (default adoptive) | Same setting, also reachable from the gear. |
| Preferred tree view | A per-user default chart view is open as issue #48 (moved to 0.3 on Nov 18, ADR 0018) | **Built in step 33:** a gear choice (Navigation), applied only at entry points (the Tree tab and the page after first-run setup), never to a bare `/tree/:id`, a `?view=` link or `of`/`sel`. |
| Show black ribbons for deceased | The legend shows a deceased mark; whether cards show a ribbon was not checked | **Built in step 33 as one switch, "Show † on people who have died" (default on). The black ribbon was dropped (the † already says it).** |
| Use solid card colors | Cards are outlined in the sex color (blue, orange, grey) | **Deferred (JC, Nov 21).** If built later: a light tint, text at 4.5:1 and a distinct selected ring in all 8 scheme and theme combinations. |
| Mouse wheel scrolls or zooms | **Today the wheel zooms** (`TreeCanvas.tsx` calls `preventDefault` and zooms with the wheel; Ctrl-pinch zooms much faster); there is no scroll option (phase 1, Nov 20). **Decided (JC, Nov 20): a gear choice, zoom or scroll, in step 33** (zoom stays the default). | **Built in step 33:** Zoom (default) or Scroll in the gear; Ctrl or pinch still zooms in Scroll mode; all four views; no pan clamp. |
| Show edit icons / add buttons / birth and death icons / birthdays and anniversaries | KinShip cards are simpler by design | Not adopting for now. Revisit if cards gain such controls. |
| Vertical cards | Not built (cards are wide, with photo to the left once photos exist) | Later option, after profile photos exist. |
| Show cards for adding parents | Add relative opens from the profile and shows Add cards around the person; the chart does not draw empty add-parent cards | Not adopting. A chart that draws "add" cards for every missing relative gets crowded. |
| Simplified date editor | Date entry is flexible (partial dates) and a calendar picker is tracked as issue #109 for 0.3.0 (draft PR #92 closed Nov 18, branch kept) | Covered by the picker work. |
| Edit tree name, Back up tree | Admin pages already do this | No change. |
| Print chart | Chart poster printing is planned for 1.5, reports print in 0.7 | Keep as planned. |
| Tree privacy settings, editing permissions, manage all trees | KinShip uses roles (SuperAdmin, Family Admin, Member, User) and one tree | Not adopting. |
| Hints preferences, Instant Discovery cards, classic design switch | MyHeritage-specific | Not adopting. |
| *(KinShip's own, added Nov 18)* Show aunts, uncles and cousins | **Aunts, uncles and cousins are drawn in the main chart today** (the API returns them; only the family view trims them; see `kinship-tree-views-and-dna.md`, "Who the Family tree view draws") | **Decided (JC, Nov 18, 0.3.0):** an on/off in the gear, **off by default**. Because they are drawn today, step 33 makes hiding them the default and announces it as a behaviour change. A wide chart is fine (the chart opens centered on the home person and the viewer scrolls). Built after crossing minimisation (#21, 0.3). A sibling's partner is not part of this setting: it is always drawn. **Built in step 33: off by default for every account, existing ones included; hiding is done in the API (`collateral=siblings`), because a client trim loses the children of in-laws; a legend row says they are hidden; nieces and nephews stay.** |

**Proposed shape**
- A gear button in the chart's top bar opens a small panel with groups **Cards** (deceased marker, solid colors, and later vertical cards), **Names** (married women's name form, prefixes and suffixes), **Relatives** (show aunts, uncles and cousins) and **Navigation** (mouse wheel, default chart view), plus a Restore defaults link.
- These are per-person display settings stored with the account, like My settings today, never changes to the tree data (same rule as the view switcher). My settings → Display or Names would show the same values, so there is one source of truth.
- A database change (new columns on `users`, or one settings column) is needed, so this is not for 0.2.0. Follow the pattern of migration 0010 (column grants and the update-own policy). **Built (step 33): migration 0018 added `tree_wheel`, `tree_default_view`, `show_extended_relatives` and `show_deceased_mark`. Restore defaults resets Cards, Relatives and Navigation, not Names (shared with My settings). Relatives, Navigation and Cards are in the gear only.**

**Fit with the plan.** The name display and card options are small and fit 0.3 ("See the family", the legend and views). Prefixes and suffixes are new person data and are the largest addition here. The default chart view (#48) moved to 0.3 on Nov 18. Print chart stays on the 1.5 and 0.7 lines. The aunts, uncles and cousins option is decided for 0.3.0 (JC, Nov 18), built after the layout work (#21); if #21 slips, JC decides whether it ships anyway or moves to 1.4 beside the hourglass chart.

## Answered (JC, Nov 19) and still open
1. ~~Default for married women's names~~ **Answered:** the maiden-name form, "Maiden name (Married name)", for existing accounts too.
2. ~~Does KinShip store name prefixes and suffixes?~~ **Answered: no. Added to the 0.3.0 scope** (see the table above), shown by default, not required.
3. **Answered (JC, Nov 20):** the wheel zooms today; step 33 adds a gear choice, zoom or scroll.
4. ~~People counter~~ **Answered:** part of the first search release.
5. ~~Aunts, uncles and cousins~~ **Answered (JC, Nov 18):** an option in the gear, off by default, in 0.3.0. (See `kinship-tree-views-and-dna.md`.)
6. ~~Prefixes and suffixes shown by default? Maiden-name default for existing accounts?~~ **Answered (JC, Nov 19):** shown by default and not required; yes, for existing accounts too.
