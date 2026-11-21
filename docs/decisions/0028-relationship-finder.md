# 0028. The relationship finder

- Status: **Accepted** (decisions by JC, 2026-11-21, step 34)
- Date: 2026-11-21
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0007 Birth and adoptive parent links](0007-adoption-parentage.md), [0009 Custom relationship labels](0009-relationship-labels.md), [0010 Step relatives](0010-step-relatives.md), [0019 Unknown parents](0019-placeholder-parents.md), [0024 Names](0024-names.md)
- Sources: `design/kinship-v2-requirements.md` ("Relationship finder"), `design/kinship-adoption.md`, `design/kinship-navigation.md`, the design mockup's finder, the step 34 phase 1 report.

## Context

0.3.0 lets a person pick any two people and see how they are related: a name (Half-aunt, Father-in-law, Second cousin once removed), the path between them, and a short explanation for removed cousins. The names are worked out from the tree alone: no AI, no stored relationship names, no private data.

## Decision

### Where it runs: an endpoint, with the rules in the shared package

`GET /api/relationship?a=&b=&lineage=` (any signed-in role; `lineage` overrides the viewer's own setting, as on the tree route). The answer says what `b` is to `a`.

- The walk and the naming are one pure function in `packages/shared` (`findRelationship`), working on an in-memory graph (`createRelGraph`). The API loads that graph in three queries (people, relationships, parent links) inside the request's own transaction, so row-level security applies, and calls the function. The same code runs in the unit tests on the fictional Hale family, so the tests and the product cannot drift.
- **Why not the client:** the chart's response is capped at 10 generations, collapses relationships with people it does not draw and carries no spouse's ancestors; an in-law result needs several of those. **Why not recursive SQL per question:** the in-law and step shapes need a set of local expansions that are clearer and testable in one function. **Cost:** about 20 ms and 0.9 to 3.4 KB on the 2,000-person fixture (see "Measured").
- The body carries names and years only (the fields of `RelPerson`): no health, DNA, identity numbers, nickname or account data. The answer is a name as a key plus parameters (`RelName`), rendered in the web app with the translation keys, so every UI string is a key.

### The walk

- Ancestors of each person by generation, over the parents the viewer's lineage view follows (`kinship_effective_kind`: the adoptive set if there is one in the adoptive view, else the birth set). The walk is capped at **30 generations**. A pair with nothing shared inside the cap and a walk that was cut off is "too distant to name" (kind `none`, flag `tooDistant`).
- The **closest shared ancestors** are the shared ancestors that are nobody's parent within the shared set. Each pair of generation counts (dA, dB) through them is a candidate relationship. The headline is the one with the smallest dA + dB; ties go to the smaller larger-side count, then full over half. Up to three other relationships (a cousin marriage, a person related two ways) are listed as "Also related as"; the diagram draws the headline only.
- Counts name the relationship: dA=dB=1 sibling; dA=0 or dB=0 the direct line (parent, grandparent, great-grandchild); dA=1 with dB at least 2 a niece or nephew (grand, great-grand); dB=1 with dA at least 2 an aunt or uncle (great-); both at least 2 a cousin of level min(dA,dB) − 1, removed |dA − dB| times. The wording is the same from either side.

### Full and half (decided by JC)

Two people who share one closest ancestor and have **no second, different known parent below it** are full ("Brother", "First cousin"). They are **half** only when at least one side's person just below the ancestor has a second parent who is known (not an "Unknown father/mother" placeholder) and not shared. This is the rule of `siblingsOf` on the profile (a missing parent is unknown, not proof of half). A shared ancestor couple is always full.

### Marriage hops

- Only **Married and Widowed** relationships give in-law and step names (the rule of ADR 0010, now in `givesStepTitles` in the shared package). Separated does not. A parent through the same relationship is never a step-parent (the blood path is checked first); divorced then remarried gives only the current marriage.
- One marriage hop, no more. The shapes: the blood relative of a spouse (Sister-in-law, Father-in-law, Stepson, Step-grandson, "Wife's nephew"); the spouse of a blood relative (Brother-in-law, Daughter-in-law, Stepmother, Step-grandmother, "Aunt's husband"); a step-sibling (a child of the current spouse of one's parent who is not a blood relative); and a blood relative of a step-sibling or a step-sibling of a blood relative ("Stepbrother's son", "Brother's stepsister"). Anything else has no name: "No relationship found", with no chain drawn.
- **A divorce does not create or keep in-law names.** A former partner of a blood relative is described plainly, by how it ended: Divorced and Annulment read "ex-" ("Father's ex-wife"), Separated reads "separated" ("Aunt's separated husband"); Engaged, Partner, Friends, Unknown and Other are not named. Descendants still find a divorced grandparent through blood. The direct pair is named as the profile names a partner (`unionLabelKey`): Husband, Late wife, Ex-wife, Wife (separated).
- A placeholder may be a hop on a blood path and appear in the ancestor list ("Unknown father"), but never a result and never a picker entry (ADR 0019); the route answers 404 for one.

### Adoption

The finder follows the viewer's lineage view like the chart. Where the closest words are parent, child, brother or sister and the path crosses an adoption, the name says so: "Adoptive father", "Adopted son", "Adoptive half-sister", "Birth father" (the profile's wording). Aunts, cousins and further out use the plain name. When there is no relationship in the viewer's view but there is one in the other, the answer is `none` with `other: 'adoption'`, and the page shows "No relationship found" and "Related through adoption. Switch to the birth (or adoptive) view to see it." Medical, DNA and next-of-kin logic never read this setting.

### Custom labels (#39)

The endpoint returns the pair's labels from the first person's side. The headline stays the derived name, and an admin's label shows under it as "Also called ..." with the "(custom)" pill. The exception is the one of ADR 0010: for a **step title** (Stepmother, Stepbrother) the label replaces the derived title as the headline. Blood and in-law names are never replaced. A label with no reverse seen from the other side reads as a sentence ("Carla is Marcus's Godmother"). The person panel gets one line, "Also known as: ...", from the labels it already loads. A label never changes the tree.

### The explainer

For removed cousins (both counts at least 2, counts different) the page shows "What 'first cousin once removed' means": each person's generation count below the shared ancestor(s), how the cousin number and the removed number are worked out, and that the term reads the same from either side. The generation note says "further down the family tree" (tree generations, never ages).

### The page

`/relationship?a=&b=` (both optional, the pickers are the address), under the Family tree tab with the Chart. The headline is a live region. The path is drawn as HTML (shared ancestors on top, each person's line below, or a chain for an in-law or step result) and listed in words as an ordered list of links; the drawing is hidden from assistive technology and its links are not tab stops, so the list is the one path read out. Below 640 px the two lines stack. No new colour tokens.

## Deliberately not built

- **Print and Download PDF:** reports and printing are 0.7; no buttons in 0.3.0.
- **"With birth places":** no place data is stored until 0.5.
- **Two marriage hops** (an in-law of an in-law), names through an ex, and foster, guardian or godparent links as structure.
- **Place or year search in the picker:** it searches names, as the rest of the app.
- A "Relationships" list for aunts, uncles and cousins on the person panel. The chart legend now points to the finder instead.

## Consequences

- No migration; no breaking change. A new route and a page.
- The graph is read whole (three queries). That is fine at family scale (the 2,000-person fixture); a tree of tens of thousands of people would need the walk moved into SQL.
- Every wording lives in `rel.*` and `finder.*` keys; another language adds a file with the same keys. The relationship words nest inside longer names, so they are lower case and the first letter is capitalised when rendered.
- Mockup differences: the finder follows ADR 0010 (Separated gives no in-law names), "Step-grandson" mirrors "Step-grandmother" where the mockup said "Wife's grandson", former partners are only Divorced, Annulment and Separated (the mockup named any status but Friends, Unknown and Other), and the "With birth places" switch and the Print and PDF buttons are left out.

## Measured

On the generated 1,900-person fixture (`scale.test.ts`), median of nine: second cousins 21 ms, 3,442 bytes; an ancestor and a descendant 20 ms, 1,926 bytes; two people with no common family 19 ms, 891 bytes.
