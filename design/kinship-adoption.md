# KinShip adoption: adoptive and biological parents (Nov 16, 2026)

Asked by JC: record both the **birth parents** and the **adoptive parents** of an adopted person. **Default to the adoptive parents**, and let each viewer choose which family they see. This replaces the "adoption paused" note in `kinship-v2-requirements.md`. Companion to `kinship-identity-numbers.md` and `kinship-tree-views-and-dna.md`. Anything marked *(assumption)* is my default, not yet confirmed by JC.

**Decided by JC (Nov 16, later the same day):**
1. **Each viewer chooses which family they see.** It is the viewer's own setting and changes nothing for anyone else (not the adoptee's choice for everyone).
2. **No private flag on birth links.** Birth links are visible to every account like other tree facts.
3. **Birth relatives do not automatically become next of kin.** In the eyes of the law the adoptive family is the legal family and the next of kin, so identity-number access follows the adoptive family (see below).

**Built in the mockup (Nov 16):** Samuel Hale (1936 to 2015) was adopted in 1938 by Joseph and Anna Hale. His birth parents are Frank and Ruth Doyle, hidden in the main chart like Priya's family and opened with the leaf. The Display section of My settings has the choice, the profile has a banner with a switch, and the Records request sheet lists both families. **The mockup still has a Private flag on birth links and counts birth relatives as next of kin; both are now superseded by the decisions above.**

## The model
- A parent-child link has a **kind**: **birth** (the default) or **adoptive**. A person can have birth parents, adoptive parents, or both. Each link has its own optional **year**, **place** and **source** (for example the adoption decree or an amended birth record). Place and source arrive with the Places and Sources libraries (0.5); the year can come first.
- An adopted person is just a person with **two sets of parent links**. Nothing is overwritten, so nobody has to choose between the two families when entering data, and both stay on the profile.
- **Added in Add relative:** a "Type of parent-child link" choice (Birth or Adoptive) when adding a parent or a child. Adding adoptive parents to a person who already has birth parents adds the second set.
- Adoption changes **family links only**. It does not change DNA (a DNA test always reflects the birth family), medical history or identity-number *rules by itself*. The medical history and DNA tabs say "birth family" where that matters.
- **Foster, guardian and step relationships stay out** of this model (still paused). Step relatives already come from marriages.
- **Same-sex or single adoptive parents** work with no special case: an adoptive set can have one or two parents.
- **Wording:** the app says **"birth"** (Birth father, Birth family) everywhere. *(assumption; the mockup mixes "birth" and "biological".)*

## Which family is shown (decided by JC, Nov 16)
- **Default: the adoptive family.** The chart, pedigree, fan, descendants, relationship finder and reports follow the adoptive parents.
- **Each viewer can switch** to the birth family: **My settings → Display → "When someone was adopted, show"**, with a quick switch button on an adopted person's profile. It is **the viewer's own setting**, stored on the account, and **does not change what anyone else sees** (decided Nov 16).
- **What each view means:**
  - **Adoptive view:** the adoptive parents are the person's parents and the adoptive siblings are siblings. The birth parents are a **branch behind the leaf**, the same way a spouse's family is opened. Descendants of the adoptive parents include the adopted person.
  - **Birth view:** the birth parents are the person's parents, and the adoptive parents drop out of the person's lines. The adopted person appears under their birth parents when that branch is opened, and the adoptive parents no longer list them as a child in the chart. The relationship finder therefore says **"No relationship found"** between the adopted person and their adoptive relatives, unless the two are related another way, with a line "Related through adoption. Switch to the adoptive view to see it." *(assumption)*
- **The profile always lists both families**, labelled **Adoptive father or mother** and **Birth father or mother**, and the parents' profiles list the child as **Adopted son or daughter** or **Birth son or daughter**. A banner on an adopted person's profile says which family the charts are following and offers the switch.
- **A single account-level default** *(assumption)*: new accounts start on **Adoptive**. The SuperAdmin does not set a tree-wide default.

## Who can see and edit adoption links
- **Visible to every account** (decided Nov 16: no Private flag), like other tree facts.
- Editing follows the usual rules: admins edit everything; a Member edits their own profile and adds descendants. **Adoption links are added by an admin**, because they change two families (Members cannot add parents). A Member adding a child adds a **birth** link only.

## Labels, reports and other features
- **Relationship finder:** labels gain "adoptive" or "birth" when the path crosses an adoption, for example **Adoptive father** or **Adoptive half-sister**. Cousins and further removed relatives use the plain name. A DNA-based hint is **not** attempted.
- **Family health history for a doctor:** the **birth family** is the one that matters for inherited conditions. The report **always uses the birth parents** for the conditions checklist, whatever view the viewer has, and says so. If the birth family is unknown, it says "birth family unknown" and does not guess. The adoptive family appears only as a household note, off by default.
- **Medical patterns:** same rule, birth blood relatives only.
- **DNA:** the DNA tab says "this test reflects the birth family". Tree checks of matches use the **birth** parents.
- **Life summary:** says "adopted in 1938 by Joseph and Anna Hale" and lists both families, labelled. Early life uses the viewer's view.
- **Descendants and Ancestors outlines, family group sheet:** follow the viewer's view. The group sheet for the adoptive couple lists the adopted child with "adopted" beside the name.
- **Family book:** follows the viewer's view when it is made.
- **Records request sheet:** for an adopted person it lists **both** the birth parents and the adoptive parents, and adds a line that **original birth records may be sealed or replaced by an amended record**, asking the office which record to request. English and Spanish.
- **GEDCOM:** export writes each link with `PEDI birth` or `PEDI adopted`. Import reads them. Links with no type are treated as birth.
- **Birthday and notification features** are unchanged.

## Identity numbers (decided by JC, Nov 16; see `kinship-identity-numbers.md`)
- **The adoptive family is the legal family and the next of kin.** A person's **legal parents** are their adoptive parents if they have any, otherwise their birth parents. Next of kin for a deceased person's identity numbers are their **legal parents, legal siblings (half siblings count), children, a legally married spouse and admins**. **Birth relatives of an adopted person do not count automatically**, and there is no Private flag to change that.
- The policy function reads the **link kinds**, never the viewer's display setting. The display setting never affects who can see private data.
- The rule works the other way too: an adopted-away child is not a child of their birth parent for next-of-kin purposes.

## Data model and build notes
- The parent-child link table allows **one set per kind** (a child may have one birth set and one adoptive set) and gains `kind` (`birth` or `adoptive`) and a `year` with precision; `place_id` and source links come with 0.5. **No `private` flag.** Existing links migrate as `birth`.
- A person has **zero or more links of each kind** (at most two parents per set). A person with adoptive links and birth links is "adopted". A person with only adoptive links and no birth parents known is still adopted; the birth side shows "Not recorded".
- Cycle and self-parent rules apply across both kinds. The same person cannot be both a birth parent and an adoptive parent of the same child.
- The display setting is a column on the account (`lineage_view`, `adoptive` by default). Every query that walks parents (chart, finder, reports, ancestors, descendants) takes the **viewer's** value; the **privacy rules never do**.
- Medical and DNA features use `kind = birth` links explicitly.
- A role-by-role test checks that switching the setting changes the chart and finder but not the identity-number or medical visibility.
- Mockup: sample data is one adoptee (Samuel) with `adp` and `bio` lists swapped into `par` according to the viewer's setting. The real app does this in queries, not by rewriting data.

## Ships in
**0.1, before 0.2 starts the data promise** (decided: the schema must allow two parent sets while alpha data can still be wiped). A first build step covers the schema, API, Add relative type choice, profile, the chart in the adoptive view with the leaf to the birth family, and the per-viewer switch. The My settings page itself is 0.2; the relationship finder labels are 0.3; reports are 0.6/0.7.

## Open
- **Step-parent adoption** (a stepparent adopts the stepchild, and the birth parent stays a legal parent): with the rule above, the adoptive link would replace the birth parent as a legal parent. Does that case need a way to keep the remaining birth parent as next of kin?
- **Biological view and the finder:** is "No relationship found" with a hint acceptable, or should the finder show "related through adoption" whichever view is on?
- **Adoption details:** is year, place and source enough, or do you want fields for the agency, court and decree number? (Record numbers belong on the source, as with birth certificates.)
- **Adults adopted later:** works as an added adoptive link. Confirm.
