# 0006. The Family tree chart

- Status: **Accepted** (brief approved by JC, 2026-11-16)
- Date: 2026-11-16
- Builds on: [0002 Web app](0002-web-app.md), [0005 People, relationships and who may change them](0005-people-and-relationships.md)
- Sources: `design/kinship-mockup.html` (Family tree chart, spouse's-family leaf and flip), `design/kinship-tree-views-and-dna.md`, `design/kinship-v2-requirements.md` (tree line convention, children hang from the relationship)

## Context

Release 0.1 needs one tree view. This is the Family tree chart: everyone around the person it is rooted on, with couples and children hanging from the relationship. The leaf and flip for a spouse's family are built here as well, although the release plan schedules them for 0.3.

## What the chart asks the API for

`GET /api/tree/:id?up=3&down=2&collateral=true`, with no generation control. A spouse's family view asks `up=3&down=1&collateral=true` and the browser then keeps only the person's ancestors, full siblings, partners and the partners' children (`familyView` in `apps/web/src/tree/family.ts`). Half-siblings are drawn on the main chart and dropped in a family view.

Two changes to the response, both tested in `apps/api/test/tree.test.ts`:

- **Every relationship in the response has both partners in it**, and every parent link points at a relationship or a parent that is in it. The query used to filter relationships on one partner only, so an in-law with earlier marriages came back with a line to somebody who was not drawn (or lost a line between two who were), depending on id order. If a child's relationship is dropped because one partner is not drawn, the child stays and hangs from its drawn parent alone.
- **`ancestorCount`** on a person who has parents that are not in the response (the people who get a leaf): all known blood ancestors at any depth, counted once each, from one recursive query for all of them. Cost, measured with 60 such people who each have 62 ancestors (a 1,272-person response): the query takes about 45 to 50 ms, the whole response 70 to 130 ms. With few leaves it is below the noise.

## The layout (`apps/web/src/tree/layout.ts`)

Pure functions, run again only when the data or the root changes, never on pan or zoom.

1. Partners are grouped (everyone connected by a relationship). A group is one row; its row is the deepest of its members' parents' rows plus one.
2. Inside a group the person with the most relationships sits in the middle, the earliest relationship on their left and the later ones on their right. A couple with one relationship is the member with drawn parents first.
3. A group with drawn parents hangs under them. Its anchor is the member on the focal person's own line, then the one with most relationships, then the earlier birth. A partner with no drawn parents is never a root.
4. A tidy-tree pass. Each subtree keeps a contour (left and right edge in every row), siblings are packed with a minimum gap, and the children of a relationship are centred under the middle of its couple line. When a person has several relationships with children, the couple lines stretch so each marriage's children stay under their own line. Single-parent children hang from that parent's box and sit between the relationships.
5. Siblings are in birth order (no birth date last, then name, then id).
6. Edges are orthogonal with a bus line, as in the mockup.

There is no crossing minimisation beyond keeping partners adjacent, siblings contiguous and children in birth order. It is "good enough", not crossing-free; barycenter sweeps were not needed for the families tried.

### Accepted limits

- A third or later relationship goes further right. The couple line is a **bracket under the boxes between** (not over them), because the children hang from the line and a line over the boxes could not connect to them.
- If both partners have drawn parents (cousins who married) the couple sits under one family and the other parent's link is a long line.
- A remarried in-law is one node with long lines, never drawn twice.
- A very wide set of siblings does not wrap.

### Measured

Layout alone (Node, a generated family of couples with three children each): 162 people 3 ms, 2,000 people 27 ms. In Chrome, a 1,333-person response (the largest this 2,000-person database gives) loads and draws in about 200 ms, 67 ms of it the request.

## Rendering

Own SVG, no diagram library. Dragging pans and the wheel and pinch zoom around the pointer; both move one `<g>` transform without a React render. The pointer is captured only once a drag really starts, so a click on a box or a leaf still arrives where it was aimed (the mockup's leaf bug), and a click right after a drag is ignored.

Without culling, panning 1,333 boxes took about 30 ms a frame. The canvas now draws only the window plus a margin of three quarters of a window on each side, looked at again 90 ms after the view stops moving (about 6 ms a frame), and below 0.3 zoom draws boxes without their text. The selected and focused boxes are always drawn.

Boxes: a border by gender (blue, coral, grey) and a small male or female glyph so colour is never the only cue, an initials circle, the name (cut at about 17 characters, full name in the tooltip), life years and a dagger. Photos, the DNA badge, places and a married surname do not exist yet and are left out.

Keyboard: one tab stop (roving), arrows along the row, up to a parent (to the leaf when there is no parent), down to a child, Enter or Space to select, `+`, `-` and `0` (fit) to zoom. Couple lines are not keyboard stops: the keyboard path to a relationship is the person panel's partner list.

## The leaf and the flip

A leaf is drawn on every drawn person who has parents who are not drawn, labelled "Show <Name>'s family (N people)" from `ancestorCount`. A click does one of three things:

- on the main chart, a blood ancestor of the root cut off by the generation limit **re-roots** the chart on them; anyone else (an in-law) **flips** to their family;
- in a family view, a person whose parents are drawn on the main chart **flips back**; anyone else flips to their own family.

The flip is a 0.5 s 3D turn (skipped under reduced motion). The address says where you are: `/tree/:id?of=:personId&sel=:personId`.

## Decisions made while building

- An account linked to nobody goes to the last root remembered in this browser (`localStorage`, optional), else a "Choose who to start from" page.
- The `0` key fits the whole chart (there is no 100% reset).
- Initial zoom: the whole chart when it is readable (fit at least 0.45), otherwise 0.7 around the root.
- The wide in-app page is `/tree/:id` only; `/tree` redirects.
- The test fixture in `apps/web/test/family.ts` now answers tree requests by the API's own rules.

## Consequences

- 0.3 (Pedigree, Fan, Descendants) can reuse `TreeCanvas`, `viewport.ts`, the node drawing, the panel and `familyView`; they need their own layouts. `layout.ts` is specific to the Family tree.
- Changing a relationship's status or a person's data invalidates `['people']`, so the chart refetches and lays out again; pan and zoom stay where they are unless the root changes.
