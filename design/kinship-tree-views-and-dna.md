# KinShip: home, tree views and DNA (Nov 14, 2026; Family tree coverage added Nov 18)

Companion to `kinship-v2-requirements.md`. Navigation lives in `kinship-navigation.md` (five header tabs for admins, four for others; Health and DNA are on each profile).

## Home tab (draft)
**JC decided to keep all of the draft cards:** Memory of the day, Coming up (next birthdays, children excluded, honouring My settings), Recent activity, The family at a glance (people, living, generations, relationships, sources, DNA results), Needs attention (admins only: missing birth places, events without sources, link to the data check report) and Jump to shortcuts (includes "My health and DNA"). Activity items must never reveal private health data (who a record is shared with). Details of Memory of the day are in `kinship-navigation.md`.

## Tree views (built)
All views share the person panel, pan, zoom, fit button and the same person nodes. Clicking anyone selects them and, in the three new views, re-centers the chart on them. **The chart background is plain: the dot grid was removed at JC's request (Nov 14).**

**View switcher (decided by JC, Nov 14; not built: the app has the Family tree only until step 32 of 0.3.0):** one icon button at the top right of the chart shows the current view. Clicking it opens a panel of icons only (no words): Family tree, Pedigree, Fan, Descendants, then the generations choice as numbers (3, 4, 5; 2 to 5 for Descendants) for every view except Family tree. Tooltips and accessible labels carry the names. Choosing a view closes the panel; clicking elsewhere closes it too.

| View | What it shows | Notes |
|---|---|---|
| Family tree (default) | Your own line by generation, with couples and kids hanging from the union. **A spouse's parents and ancestors are hidden** and opened with a small green leaf on the spouse's card (see below). **Siblings' partners and aunts and uncles are not drawn (see "Who the Family tree view draws")** | Solid line together, dotted line ended or not a marriage |
| Pedigree | Direct ancestors of the selected person, left to right. Father above, mother below | 3, 4 or 5 generations. Column titles (Parents, Grandparents...). Missing parents show a dashed "Father/Mother not on the tree" slot |
| Fan | Half-circle of ancestors, one ring per generation | 3, 4 or 5 generations. Left half is the father's side (green), right half the mother's side (amber). Names turn radial in outer rings. Missing ancestors are dashed outlines |
| Descendants | Everyone below the selected person, left to right, children grouped under their parent | 2 to 5 generations. Each card lists partners ("m. Rosa", "div. Lucia", "sep. Anthony"). Stepchildren are not shown. A card at the depth limit says "N children below" |

- Pedigree and fan follow blood parents only (adoption is paused).
- Each view fits itself to the canvas when you switch view, change generations or click a new person; the fit button returns to that fit.
- Not built yet: hourglass (ancestors left, descendants right), a per-user default view in My settings, printing a chart as PDF/poster.

## Who the Family tree view draws (checked against the running app, Nov 18)
JC compared the app (0.2.0 release candidate) with a real family and found that two groups of relatives are missing from the Family tree view. The behavior below is **what is built today**; it follows the rule "your own line", which is what the Family tree row above has always said. No requirement doc and no release in the plan promised the missing groups, so this is a gap in the specification, not a regression.

**Drawn today**
- The person in focus, their blood ancestors by generation, and the people on their own line.
- The partner of the person in focus and of each person on the line, with the couple line, and the children hanging from the union.
- In a family view (after a leaf flip): that person's parents and grandparents above, their partner and children below, and their **full** siblings next to them.

**Not drawn today**
- **A sibling's partner** (a sister's husband, a brother's wife, that is, the focus person's brother-in-law or sister-in-law by blood). Example from the app: in Melise's family view, her sister Marielis is drawn next to her under their father, but Marielis's husband Juan Jose is not. He still appears in the person panel (Partners) and in the Relationships lists.
- **Aunts and uncles** on either side (the siblings of a parent or grandparent) with their partners, and the cousins below them.
- Half-siblings in a family view (already documented below; they stay in the full chart and the other views). Stepchildren in Descendants (already documented).
- I did not check nieces and nephews (a sibling's children); the same rule probably leaves them out.

**Where these relatives can already be found:** the person panel and profile (Partners, Relationships), the relationship finder (0.3), and the family health history report, which lists aunts and uncles when asked.

**Decided by JC, Nov 18: yes to both (release 0.3.0).** Text below is the approved design; the build prompt carries it.
1. **Siblings' partners (and their children): draw them.** A sibling's partner is drawn beside the sibling with the couple line, and the partner's own parents stay behind the green leaf, exactly like an in-law such as Priya. It reuses a pattern that already exists and adds one card per sibling, so it is always on, in 0.3.
2. **Aunts, uncles and cousins: an option, off by default.** A setting "Show aunts, uncles and cousins" in the chart's gear panel (see `kinship-tree-settings-and-search.md`). When on, the siblings of each parent are drawn beside that parent with their partners, and cousins hang below. It widens the chart a lot and the chart uses fixed positions (the same reason the in-law parents could not be expanded inline), so it needs the crossing-minimisation work (#21, now in 0.3) first. **JC (Nov 18): a wide chart is fine.** Width is not the concern, so the option is not held back for it; the build order still puts crossing minimisation first because crossing lines make cousins hard to read. If #21 slips, JC decides then whether the option ships anyway or moves to 1.4 (the information is reachable elsewhere).
3. **Navigation (JC, Nov 18):** the chart opens **centered on the home person** (the person in focus), and the viewer **scrolls or pans left, right, up and down** to move around. The whole tree does not have to fit in the view, so a wider tree is accepted. Fit-to-screen stays available as a button but is not the opening view; Center on me stays. Phase 1 reports what the chart does today (opening view, wheel and drag behavior) so the change is small.
4. **Whichever is chosen, say so on the chart:** the legend gets a line, for example "Brothers- and sisters-in-law and aunts and uncles open from the person panel", so the missing relatives do not look like missing data.

## A spouse's side of the family (decided by JC, built Nov 14)
**Decision:** one tree, with the spouse's family hidden until asked for. Not separate linked trees. Reasons: real families overlap (cousins marry, spouses remarry, shared ancestors), so separate trees would duplicate people and need constant merging; the relationship finder, reports, health history and DNA checks all need one connected graph; permissions and backups stay per person. Separate trees are kept only for families that genuinely do not connect (the setup wizard already says more trees can be added later). This matches MyHeritage, where the icon is a view change on one tree.

**How it works (mocked up)**
- **The control lives on the tree itself, not in the person panel (JC, Nov 14).** In the Family tree view, a person whose own parents are on the tree but not drawn (an in-law such as Priya) gets a **small green leaf growing from the top of their card** (a short stem from the card edge, a white outline and a soft shadow so it stands out). The tooltip reads "Show Priya's family (4 people)", the count being her ancestors. The person panel has no button for this.
- **Leaf size and color (JC, Nov 14/15):** the first leaf was too large, so it was shrunk twice; it is now about half the size of the second version (full chart about 0.5x, family view about 0.35x of the original drawing). Its green is **the logo's leaf green**: #4F8A4B in light mode and #8CC488 in dark mode (the same two greens as the logo files). The clickable area has a minimum size so the small leaf is still easy to hit. It uses the logo green in every color scheme.
- **Clicking the leaf flips the tree** (a short 3D turn, about half a second, skipped for people who ask their device to reduce motion) to her side: her parents and grandparents above, her partner (with a couple line) and children below, and her full siblings next to her. A small label at the top left says "Priya's family".
- **There is no "Back to full chart" button (JC, Nov 14).** Both the normal chart and a family view are full charts, just centered differently. To move between them, use the leaf: in Priya's view, the leaf on Marcus (whose parents are on the main chart) flips back to the normal chart. A leaf on a hidden ancestor (for example Raj, whose parents are not drawn) flips to that person's family.
- Choosing a hidden person from a Relationships list (for example Raj) opens the view centered on him.
- Switching to Pedigree, Fan or Descendants goes back to the normal chart. The view is a display setting only: nothing in the data changes, and each person has their own.
- Half-siblings are not drawn in a family view (for example Gabriel in Marcus's view); they stay in the full chart and the other views.
- Bug fixed Nov 14: the first version did nothing when clicked, because the chart's drag-to-pan handler captured the press before the click could reach the control. The leaf, the label and the zoom buttons are now excluded from panning.
- The in-law side is real data: five people were added to the sample family (Priya's parents Raj Nair and Meera Iyer Nair, her brother Arjun, and Raj's parents Hari and Lakshmi Nair), so the relationship finder, reports and the family health history now see them (Raj is Marcus's father-in-law). The sample family is now 29 people.
- Not built: expanding the in-law parents inline in the main chart (the chart uses fixed positions, so there was no room without stretching the divorced couple's line), a family-wide setting for which branches start open.

## DNA badge on the tree (built, decided by JC)
A small orange DNA badge sits on the person's avatar in the Family tree, Pedigree and Descendants views (and on fan segments and the fan centre), tooltip "DNA results on file (contents may be private)". It shows for everyone who has uploaded DNA, for every role. The tree legend explains the badge.

## DNA (mocked up)
Third-party tests (AncestryDNA, 23andMe, MyHeritage, FamilyTreeDNA) give a raw data file, an ethnicity estimate, a list of DNA matches (shared cM and a predicted relationship) and sometimes haplogroups.

**Where it lives (decided by JC):** on each person's profile, in the **DNA** tab (next to **Medical history**). The header tab **Health and DNA** is an **admin-only overview** of everyone's data, with an "Open in profile" button. Members and Users go to a person's profile; opening the overview URL sends them to their own profile tab.

**Decided by JC:** admins can upload DNA results for another user. A person can have results from several providers.

**Visibility (decided by JC, Nov 14, replaces the earlier sharing choices)**
- **DNA results are visible to every account, living or deceased.** The tests table, haplogroups, ethnicity estimate and the Y-DNA and mtDNA lines are open to all. There is no "Only me" option, no lock screen and no upload receipt any more.
- **Health stays private** and is shared person by person (see the requirements doc). The DNA page does not reveal health.
- Match lists and raw files stay private to the tested person in every case (admins included) because they name living people who never joined KinShip. This is an assumption, since JC did not say otherwise.
- The DNA badge therefore shows for everyone with an upload, and a person's own page says "Visible to every account. Match lists and files stay with you."

**How upload works (as mocked up)**
- "Add DNA results for someone" (admins) or "Add my DNA results" (Members and Users, own results only). Fields: person, provider, year, what it contains (autosomal, Y-DNA men only, mtDNA), raw file or match export, optional haplogroups, and a required permission checkbox when the person is not the uploader (wording adds executor or next of kin for a deceased person). The visibility choice was removed; the dialog says results are visible to every account and match lists and files stay private.
- Admin uploads are marked "Admin, on behalf" in the tests table, with the permission note, and the tested person is notified.

**Several providers (mocked up).** A person's record holds a list of tests. Each test keeps its own ethnicity estimate (shown side by side, never blended), raw file and match list. The Matches tab merges the lists into one row per relative with each company's cM and label, a "Seen at both" or "Only at <company>" tag and the tree check (flagged if any company's figure is out of range). Haplogroups stay per person.

**Tabs on a person's DNA page**
- **Overview:** tests table, haplogroups (Y paternal line, mtDNA maternal line; "Tested" or "Inferred from <person>"; a woman's Y line is her father's), ethnicity estimate with provider and version.
- **Matches (own page only):** match name, shared cM with segment counts, what the provider says, what the tree says (from the relationship finder), and a check against a typical range worked out from the tree (expected cM = 6,800 × shared ancestors × 0.5^(steps up on both sides), with a tolerance band that widens for distant cousins). Results read Fits the tree, Lower than expected or Higher than expected; unlinked matches offer "Link to tree person". The mockup ranges are estimates; before building, check them against published shared-cM data.
- **Y-DNA and mtDNA lines:** everyone who shares the Y line (father to son from the oldest known paternal ancestor) or the mtDNA line (mother to child), with pills filled for people with results. One tested person stands in for the whole line.
- **Files (own page only):** the raw data file, encrypted at rest, download and delete. Never shown to admins.

**Also in the mockup:** "Good people to test next" (oldest living relatives without results). Sample data: Marcus (AncestryDNA 2022 and 23andMe 2024, 6 matches including one flagged and two not on the tree), Daniel (Y-DNA uploaded by Marcus as admin), Carla (23andMe uploaded by Marcus) and Sofia (own MyHeritage results). Carla and Sofia have linked accounts; the profile shows "Linked (Member)" for them.

**Still proposed (not mocked up)**
- Highlighting the paternal or maternal line on the tree views.
- Import of a provider's match export where the provider offers one (formats and availability vary; no scraping of provider accounts, it breaks their terms).
- GEDCOM export with living people shown as "Living", so the tree can be attached to Ancestry, MyHeritage, FamilyTreeDNA or GEDmatch.
- Later: compare two raw files on the server (lower accuracy because providers use different marker sets); manual "genetic finding" entries in the medical record; no automatic health reading of raw files.
- The app never changes the tree from a DNA result; a mismatch (possible unknown parent, half-sibling) is shown only to the tested person.

## Open
- Which DNA parts are in v1 (JC unsure). The release plan (`kinship-release-and-deployment-plan.md`) recommends a basic DNA release before 1.0 and match checking after it.
- Confirm that match lists and raw files stay private (assumed).
- **Siblings' partners and aunts and uncles in the Family tree (Nov 18): decided.** Both approved for 0.3.0 (siblings' partners always drawn; aunts, uncles and cousins as an option, off by default). Open: what the chart does today when it opens, and whether nieces and nephews are drawn (to be checked in 0.3 phase 1).
