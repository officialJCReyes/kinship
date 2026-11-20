# 0026. The view switcher and the Pedigree, Fan and Descendants views

- Status: **Accepted** (design by JC, 2026-11-14 and 2026-11-18; the answers of 2026-11-21, step 32)
- Date: 2026-11-21
- Amends: [0006 The Family tree chart](0006-tree-view.md) (0.3 "can reuse `TreeCanvas`"; "never cut" for a name)
- Builds on: [0007 Adoption](0007-adoption-parentage.md) (which parents a chart follows), [0024 Names](0024-names.md), [0025 Fewer crossing lines](0025-layout-crossings.md)
- Sources: `design/kinship-tree-views-and-dna.md` ("Tree views"), `design/kinship-mockup.html` (the views, the switcher), the step 32 phase 1 report.

## Context

0.3.0 adds three views of the tree that follow one person, next to the Family tree: the **Pedigree** (blood ancestors in
columns), the **Fan** (blood ancestors as rings) and **Descendants** (everyone below). A switcher chooses between them.
The Family tree stays the default and does not change.

## Decision

### The address

The view is a display setting kept in the address, next to `of`, `lineage` and `sel`:
`/tree/:id?view=pedigree|fan|descendants&gen=N`. The Family tree has no `view`, so its addresses do not change.
`treeView.ts` reads it: a view that is not on offer (the list `AVAILABLE_VIEWS` is data) or not known falls back to the
Family tree, `gen` is clamped (3 to 5; 2 to 5 for Descendants) and falls back to the view's own default (4, 4 and 5)
when it is missing or not a whole number. The generations choice is **not** remembered between visits (a remembered view
or default is #48, step 33). In the new views `of`, `lineage` and `sel` are ignored.

### Which person, and what a click does

A view is about one person, the **root** (`/tree/<root>`). Switching view goes to the selected person
(`sel ?? of ?? id`) with no `of` or `lineage`, so a family view (the leaf flip) goes back to the normal chart. In the
three new views clicking a person, choosing them in the search box and Center on me **make that person the root**, in
the same view and with the same `gen`; search always does this, drawn or not. There are no leaves and no flip. The
previous chart stays on screen (`aria-busy`) until the next one's data has arrived, so a click does not blink to
"Loading". Staying in the Family tree keeps its own loading behaviour.

### What each view asks the API for (no API change, no migration)

| View | Request |
|---|---|
| Pedigree, Fan | `up=N-1&down=0&collateral=false&lineage=birth` |
| Descendants | `up=0&down=N&collateral=false`, with the viewer's own lineage view |

`lineage=birth` is the existing override, so the ancestor walk follows **birth parents only whatever the viewer's setting
is** (blood). Descendants follow the viewer's lineage view (an adopted child is drawn under the family the viewer
follows), with no marker. The client trims what the response adds for the Family tree: partners of ancestors and, one hop
on, a partner's own children. For Descendants that removes **stepchildren**. The Descendants request is one generation
deeper than what is drawn, which is how a card at the limit says "N children below" without a new API field. Tests:
`apps/api/test/tree.test.ts`.

### Layouts (pure functions, deterministic)

- **Pedigree** (`pedigreeLayout.ts`): column `c` has `2^c` slots, the parents of the person in slot `i` are in slots `2i`
  (father, above) and `2i+1` (mother, below). The man is the father; a woman the mother; a person of another or no recorded
  sex takes the first free place; two of the same sex go by birth date, then id. A missing parent is a dashed slot
  ("Father not on the tree"); an unknown-parent placeholder is a real card.
- **Descendants** (`descendantsLayout.ts`): one column for each generation, leaves stacked, a parent beside the middle of
  their children, children in birth order (then name, then id). A child of two drawn descendants appears once, under the
  first parent in that order. Partners are listed on the card (`m.` for married and widowed, `div.`, `sep.`, `eng.`,
  otherwise `with`), in order of the relationship's start, wrapped on up to two lines at 11 px and never cut. A card is 30 px
  taller than a Family tree card for them.
- **Fan** (`fanLayout.ts`, `FanCanvas.tsx`): own SVG, no diagram library. The person is a circle (radius 60); ring `c` is
  96 px thick and has `2^c` wedges across 180°. The left half is the father's side (green), the right half the mother's
  (amber); missing ancestors are dashed outlines (one ring only: nothing is drawn beyond a missing person).
- **Order**: every layout depends only on the response, so the same data gives the same chart whatever the order it
  arrives in (tested with shuffled input), and selecting, the panel and search never move a card.

All views draw cards with the existing `TreeNode`, the panel, the search box and counter, the zoom and Fit buttons and the
keyboard (`+`, `-`, `0`), through `useChartViewport` (a pure move out of `TreeCanvas`). Each view **fits itself** when it
opens, when the generations change and when a new person is chosen; the Fit button returns to that fit. The Family tree
keeps `initialView` (ADR 0006).

### The fan's names: an exception to ADR 0006

ADR 0006 says a card's name is never cut. In the Fan a wedge in an outer ring is too narrow for horizontal text, so from
ring 3 on the text runs along the radius, up to three lines. A name is wrapped, and the type steps down from 11 px to
**9 px**; only if it still does not fit is it **shortened** ("Nova H.", then an ellipsis), and only in those rings.
Rings 1 and 2 keep the whole name (down to any size). The whole name stays in the tooltip and in the accessible name.
The rings are 96 px thick (the mockup's are 88) so that fewer names need it. In the test family a name of 43 characters
fits whole; one of 60 is shortened.

### Keyboard and accessibility

- The switcher is a button with `aria-expanded` and the label "Chart view: <name>"; its panel has two groups ("View",
  "Generations") of toggle buttons (`aria-pressed`, icons only, `title` and `aria-label` carry the names). Opening puts
  focus on the current view; each group has one tab stop with the arrow keys (and Home and End) moving inside it; Esc,
  a press or focus outside and choosing a view close it and give focus back to the button. Choosing a number of
  generations keeps the panel open.
- Each layout supplies `navigate(id, key)`. Pedigree and Descendants: left and right along the generations, up and down in
  a column. Fan: up to the father (then the mother), down to the middle, left and right around the ring. One tab stop in
  the chart; Enter or Space makes the person the root.
- A Fan wedge is `role="button"` with the whole name, the dates, the sex and the side ("father's side"); a ring is a labelled
  group ("Parents", "Grandparents"); empty places are `aria-hidden`. Colour is never the only cue: the side is also the half
  of the circle and part of the name.
- `styles.css` has four new tokens, fixed in every scheme (light and dark): `--side-father`, `--side-father-line`,
  `--side-mother`, `--side-mother-line`. `theme.test.ts` checks text on both fills and both lines against the page in all
  8 scheme and theme combinations.

### Not in this step

- **The DNA badge** (tree-views doc, "DNA badge on the tree"): the app has no DNA data, so nothing is drawn or reserved.
  It comes with DNA in **1.2** (the release plan), on cards, wedges and the fan centre.
- A per-user default view and generations (#48), the gear panel and the wheel choice (step 33), the hourglass chart and
  printing.

## Consequences

- `TreeCanvas` is smaller; the Fan reuses its viewport, legend and zoom controls. `Layout` has optional fields (card
  height, column titles, empty slots, `navigate`, per-link bounds, a note) that the Family tree layout never sets (a golden
  test pins this).
- A click in a new view is one request (cached by the query client).
- Wide Descendants charts rely on the existing culling: a 1,555-person, five-generation family (six children each) lays out
  in about 6 ms.
