# 0025. Fewer crossing lines in the Family tree layout

- Status: **Accepted** (scope decided by JC, 2026-11-20, step 31)
- Date: 2026-11-20
- Amends: [0006 The Family tree chart](0006-tree-view.md) (the layout: "no crossing minimisation beyond ... children in birth order"; "Siblings are in birth order")
- Sources: issues #21 and #23; the step 31 phase 1 and phase 2 reports.

## Context

0006 left the layout "good enough, not crossing-free". Measured on seven fictional families, a tidy tree already draws
three married siblings, a remarriage with children from both unions and a widow who marries her late husband's brother
with no crossing at all. What was left was:

- **Overlaps.** When a partner's own parents are drawn too (cousins who married), the partner's family's children line
  ran along the other family's, at the same height, so two families looked like one.
- **Crossings** around a third partner (the bracket) and where a person's group is pushed several rows down because
  their partner is a generation younger.
- **Length**, from a brother or sister who married a cousin standing on the far side from the family the partner
  came from.

## Decision

### The metric (`apps/web/src/tree/layoutMetrics.ts`)

`measureLayout(layout)` counts, on the drawn lines (every link and every couple line, taken apart into horizontal and
vertical pieces):

- **crossings**: a horizontal piece of one line strictly inside a vertical piece of another (a line that only ends on
  another does not count);
- **overlaps**: two horizontal pieces of different lines on the same y that share more than 1 px;
- **throughCards**: a vertical piece strictly inside a card's width, covering part of its height;
- **length**: the total length of all pieces, in px (reported, never optimised).

`defects` is crossings + overlaps + throughCards. It is also what the tests pin on the named families
(`apps/web/test/tree-layout-metrics.test.ts`, fixtures in `layout-fixtures.ts`).

### Bus lanes (constant `BUS_LANES`, option `busLanes`)

Children lines of different families that share a stretch of the same gap get their own lane (14 px apart,
`LANE_PITCH`). A line that shares nothing stays on the middle line, where it always was, so a family without a cousin
marriage is laid out exactly as before. The gap keeps its height for up to three lanes (`FREE_LANES`); each lane
beyond that makes the gap 14 px taller. Within a group of overlapping lines the lanes are chosen by trying every order
of first-fit colouring (up to six lines; more use the left-to-right order) and keeping the fewest crossings, then the
fewest lanes; ties go to the earliest order.

An overlap that cannot be avoided becomes a crossing. That is a gain in clarity (the lines are no longer merged), not
in the defect count.

### Order of brothers and sisters (constant `REDUCE_CROSSINGS`, option `reduceCrossings`)

Siblings stay in birth order, which stays the default and the tie-break. The one exception: when a brother or sister's
partner has drawn parents (a second family to follow) and the layout has defects, the layout is made again with those
brothers and sisters sorted by the average place of the parents' hang points (their own parents' and the partner's
parents'), ties by the earlier order. The new order is kept only if `defects` is lower, never for a shorter length
alone. At most `EXTRA_LAYOUTS` = 8 extra layouts are made per chart, whatever the size, so the same data always gives the
same result and the cost is bounded (2,000 people: about 20 to 32 ms; 20 cousin marriages beside them: about 145 ms).
Nothing here depends on the selected person, the panel or the search box, so cards never move when those change.

With both constants off the layout equals the layout of 0.2 byte for byte (golden file, every named family and the Hale
sample).

## Known limits (kept, not fixed)

- **The bracket case.** A third or later partner gets a bracket under the cards in between. The children of a couple in
  between hang through it, so it crosses their line. A fix would put the relationships with no children in between,
  which changes "earlier left, later right" for people with three partners; deferred.
- **A cross-generation line.** A person whose partner is a generation younger is pushed to the partner's row, and the
  line from their own parents then runs down past the families in between. A child must stay below its parents, so
  this stays.
- Two cousin marriages between the same two families keep one crossing.
- Wide sibling sets do not wrap (step 33 accepts wide rows). #23 stays open for wide sets and in-laws with several
  partners.
- The cap leaves defects in a chart with more than eight such sibling sets.

## Consequences

- A cousin marriage can bring a brother or sister out of birth order; the change is small and only made when it removes
  a defect.
- `layout.ts` imports `layoutMetrics.ts`, which imports the card size from `layout.ts` (used only when a function runs).
