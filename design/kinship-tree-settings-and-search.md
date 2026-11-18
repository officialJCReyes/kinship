# KinShip: search inside the chart and the tree settings (gear) (Nov 17, 2026; relatives setting added Nov 18)

Companion to `kinship-tree-views-and-dna.md` and `kinship-navigation.md`. Written from JC's review of MyHeritage's tree on Nov 17 (screenshots of the in-chart search box and the gear "Settings" panel). **Nothing here is built.** JC asked for the two features to be recorded so they can be scheduled. Status words: *Proposed* = my suggestion, not yet decided by JC.

## 1. Search inside the chart (requested by JC, Nov 17)

**What MyHeritage does.** A search box sits in the chart's top bar, next to a people counter ("23 of 718 people" shown out of everyone in the tree), a Tools menu, a generations control and the gear. Typing shows a dropdown of matches: a small avatar, the name with the typed part in bold, and one detail line, which is the person's relationship to the viewer when known ("Mother-in-law's aunt's mother") and otherwise the birth year. Clicking a result jumps the chart to that person.

**Request.** Move the people search into the chart so a person can be found and jumped to without leaving it. (Today search lives on the People page.)

**Proposed behavior**
- Search box in the chart's top bar, with an accessible label and keyboard use (type, Up and Down, Enter to jump, Esc to close).
- Matches names the way the People page does, including maiden and other recorded names (the `search_names` column from migration 0007).
- Each result shows the name, the life years, and the relationship to the viewer using the relationship finder's wording, once the finder exists (0.3). Until then, show the years only.
- Choosing a result selects the person, opens the person panel and re-centers the chart on them. If they are on a spouse's hidden side, open that person's family view as when choosing a hidden person from a Relationships list (see `kinship-tree-views-and-dna.md`). In Pedigree, Fan and Descendants, re-center the same way as clicking a node.
- Only people the viewer may see are searched, and nothing private (health, DNA, identity numbers) appears in results.
- Optional, later: a counter such as "23 of 718 people" showing how many are drawn in the current view versus the whole tree.

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
| Married women's name display (4 choices) | My settings → Names has one choice, married surname or birth surname (`surname_choice`, default married), and it applies everywhere | Proposed: grow it to the four forms, applied on cards, the panel and search. The maiden name was kept off the cards on Nov 17 (too little room), so a "Maiden name (Married name)" choice is how someone opts in to seeing both. Ask JC which should be the default. |
| Use the husband's surname when none is given | Not built | **Not adopting.** It assumes gender and naming custom, and many families (including Spanish-style double surnames) keep names. If ever added, off by default and worded neutrally (a partner's surname). |
| Show prefixes and suffixes | Not checked: whether KinShip stores prefixes and suffixes | Check the person model first. If they exist, a simple on/off. |
| Display adoptive parents by default | Done: My settings → Family, `lineage_view` (default adoptive) | Same setting, also reachable from the gear. |
| Preferred tree view | A per-user default chart view is open as issue #48 (moved to 0.3 on Nov 18, ADR 0018) | Proposed: the gear holds it. |
| Show black ribbons for deceased | The legend shows a deceased mark; whether cards show a ribbon was not checked | Proposed on/off if the card style allows it. |
| Use solid card colors | Cards are outlined in the sex color (blue, orange, grey) | Proposed: an option for filled cards. Check contrast in all four schemes. |
| Mouse wheel scrolls or zooms | Not checked what the wheel does today | Proposed: a choice, because it matters for laptop trackpads and accessibility. |
| Show edit icons / add buttons / birth and death icons / birthdays and anniversaries | KinShip cards are simpler by design | Not adopting for now. Revisit if cards gain such controls. |
| Vertical cards | Not built (cards are wide, with photo to the left once photos exist) | Later option, after profile photos exist. |
| Show cards for adding parents | Add relative opens from the profile and shows Add cards around the person; the chart does not draw empty add-parent cards | Not adopting. A chart that draws "add" cards for every missing relative gets crowded. |
| Simplified date editor | Date entry is flexible (partial dates) and a calendar picker is being built (#92) | Covered by the picker work. |
| Edit tree name, Back up tree | Admin pages already do this | No change. |
| Print chart | Chart poster printing is planned for 1.5, reports print in 0.7 | Keep as planned. |
| Tree privacy settings, editing permissions, manage all trees | KinShip uses roles (SuperAdmin, Family Admin, Member, User) and one tree | Not adopting. |
| Hints preferences, Instant Discovery cards, classic design switch | MyHeritage-specific | Not adopting. |
| *(KinShip's own, added Nov 18)* Show aunts, uncles and cousins | The Family tree draws only the person's own line, so aunts, uncles and cousins are not drawn (see `kinship-tree-views-and-dna.md`, "Who the Family tree view draws") | Proposed: an on/off in the gear, **off by default**, because it widens the chart and the layout uses fixed positions. Depends on crossing minimisation (#21, 0.3). A sibling's partner is not part of this setting: the proposal there is to draw it always. |

**Proposed shape**
- A gear button in the chart's top bar opens a small panel with groups **Cards** (deceased marker, solid colors, and later vertical cards), **Names** (married women's name form, prefixes and suffixes if they exist), **Relatives** (show aunts, uncles and cousins) and **Navigation** (mouse wheel, default chart view), plus a Restore defaults link.
- These are per-person display settings stored with the account, like My settings today, never changes to the tree data (same rule as the view switcher). My settings → Display or Names would show the same values, so there is one source of truth.
- A database change (new columns on `users`, or one settings column) is needed, so this is not for 0.2.0. Follow the pattern of migration 0010 (column grants and the update-own policy).

**Fit with the plan.** The name display and card options are small and fit 0.3 ("See the family", the legend and views). The default chart view (#48) moved to 0.3 on Nov 18. Print chart stays on the 1.5 and 0.7 lines. The aunts, uncles and cousins option belongs to 0.3 only if the layout work (#21) lands; otherwise it moves to 1.4 beside the hourglass chart.

## Open
1. Default for married women's names: keep "married name" as now, or match JC's "Maiden name (Married name)"?
2. Does KinShip store name prefixes and suffixes? (Not checked.)
3. What does the mouse wheel do on the chart today, and should the other choice be offered?
4. Should the people counter ("N of M people") be part of the first search release?
5. Aunts, uncles and cousins: an option in the gear, off by default (my proposal), or always drawn, or not drawn at all? (See `kinship-tree-views-and-dna.md`.)
