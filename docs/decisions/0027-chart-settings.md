# 0027. The chart's settings (gear), and how the chart opens

- Status: **Accepted** (decisions by JC, 2026-11-18 to 2026-11-21, step 33)
- Date: 2026-11-21
- Amends: [0011 An account's own display settings](0011-display-settings.md) (four more columns), [0026 The view switcher and the chart views](0026-chart-views.md) (the default view and the wheel), [0006 The Family tree chart](0006-tree-view.md) (what the main chart draws, and its opening view)
- Builds on: [0024 Names](0024-names.md), [0025 Fewer crossing lines](0025-layout-crossings.md)
- Sources: `design/kinship-tree-settings-and-search.md`, `design/kinship-tree-views-and-dna.md`, the step 33 phase 1 report.

## Context

0.3.0 adds a gear panel to the chart's top bar. Its settings are per-account display settings, never changes to tree data.

## Decision

### Storage: four columns on `users` (migration 0018)

| Column | Values | Default | API field |
|---|---|---|---|
| `tree_wheel` | `zoom`, `scroll` | `zoom` | `treeWheel` |
| `tree_default_view` | `family`, `pedigree`, `fan`, `descendants` | `family` | `treeDefaultView` |
| `show_extended_relatives` | boolean | **false** | `showExtendedRelatives` |
| `show_deceased_mark` | boolean | true | `showDeceasedMark` |

Separate columns, not one jsonb: a handful of small choices read with the account on every request, each with its own `CHECK`
and column grant (as in 0010 and 0017); jsonb would move the validation out of the database. Existing accounts take the
defaults, so **aunts, uncles and cousins become hidden for every account** (a behaviour change, announced in What's new and
UPGRADE.md). The migration only adds columns (expand-only). `kinship_auth.complete_setup_family` is replaced so the wizard's
optional `settings` object stores them (no wizard screen). `parseUserSettings` is the one validator.

The gear's **Names** group shows and changes the same columns as My settings, Names (`name_form`, `show_prefix`,
`show_suffix`): one source of truth. Everything else lives only in the gear. **Restore defaults** resets only the chart-only
settings (the dagger, relatives, wheel, default view) in one request; it never touches Names, color, theme, date format or
lineage.

### Aunts, uncles and cousins: in the API

`GET /api/tree/:id?collateral=siblings` seeds the collateral walk from the focal person's **parents** only. It keeps the person,
ancestors, siblings and half-siblings, their partners and descendants, the partners of ancestors and the children of in-laws,
and drops the siblings of any ancestor and everything below them. `collateral=true` keeps its meaning (every descendant of the
topmost ancestors). The chart asks for `siblings` while the account's `showExtendedRelatives` is off. A client trim was
rejected: the response omits the parentage of unions whose other partner is not drawn, so the rule cannot be rebuilt exactly on
the client. The layout is a pure function of the response, so ADR 0025 is unaffected; the golden tests gain one family with an
aunt, an uncle, a cousin and a great-uncle in both modes. The Pedigree, Fan and Descendants views never ask for collateral.
Search for someone not drawn re-roots the chart on them, as before. The people counter's total stays everyone the viewer may
see. The Family tree legend says so while the setting is off and in a family flip (which never draws them).

### The † on cards

`show_deceased_mark` (default on, today's behaviour) draws † after the name on the Family tree, Pedigree and Descendants cards and
on the Fan's labels; with it off the legend drops its "Deceased †" row. The profile page, the person panel and the cards'
accessible names (which say "died 2005") are not affected: the setting is only about the chart's drawing. The cards are
memoized, so they carry the account's name choices and this one as props and redraw when one changes.

### The wheel

`treeWheel = scroll` makes the wheel pan (`deltaX`, `deltaY`, line and page deltas normalised; Shift plus a vertical wheel pans
sideways); Ctrl or a trackpad pinch still zooms, the buttons and keys are unchanged, and the pan is not clamped. It is in
`useChartViewport`, so it applies to all four views.

### The default view applies at entry points only

`treeDefaultView` is used where a chart opens fresh: `/tree` (the Tree tab, for an account linked to a person, to the last person seen, or to the person chosen on the "who to start from" page) and the page after the first-run setup (`entryAddress`). Signing in itself lands on Home, which is not a chart. A bare `/tree/:id` is always the
Family tree, an explicit `?view=` always wins, and `of` and `sel` addresses (Family-only) are never reinterpreted. Center on me,
search re-root and leaf clicks keep the current view. Reason: a link must mean the same to everyone who opens it, and the Family
tree has no `view` parameter (ADR 0026). Generations are not remembered (4, 4 and 5 per view).

### How the chart opens

The Family tree fits the whole chart when it fits at a zoom of 0.7 or more (it was 0.45), and otherwise centres on the focal
card at 0.7. **Pedigree, Fan and Descendants keep fitting themselves** (ADR 0026): in the Pedigree and Descendants the root
sits at the left edge, so centring it would leave half the window empty, and a readable Fan would hide most rings. There is no
`start: 'center'` mode.

### The gear panel

A gear button ("Chart settings") in the top-right cluster, next to the view switcher, opens a panel with four disclosure groups:
Cards, Names, Relatives, Navigation (Relatives and Navigation start open, nothing is remembered). It shares one popover hook
(`usePopover`) with the view switcher: Esc, a press or focus outside, focus return, and opening one closes the other. A change is one
`PATCH /api/auth/me`, applied to the session cache at once (`useUpdateSettings`) and rolled back with an alert in the panel on
failure; a polite status says "Saved." or "Defaults restored.".

**No remount.** ADR 0011 keyed the whole routed page on the date format and the name choices, so a change remounted it. On the
tree route the key is now the date format only (it cannot be changed from the chart); the name choices and the † reach the
chart as props and as part of the model's inputs, so the panel stays open, the focus stays and the view does not move (a test
checks it). A change of the Relatives setting keeps the chart on screen (`placeholderData`, for the same person) until the other
response arrives.

**Narrow screens.** At 640 px and below the search box is 112 px narrower than the window (at most 260 px), so the gear and the
view switcher fit beside it at 360 px, and "Center on me" wraps below them in the right cluster.

**Restore defaults** sets `showDeceasedMark`, `showExtendedRelatives`, `treeWheel` and `treeDefaultView` in one request and
says that Names are shared with My settings and are not reset here.

### What a centred opening view means for the legend

A chart that opens centred on the home person at 0.7 can have a card under the open legend (bottom left). The legend can be
folded; the journeys fold it away when they open a chart, because how wide a chart is depends on the fonts of the machine.

### Not in step 33 (deferred)

A black ribbon for the deceased, solid card colors and vertical cards (they need photos), per-view remembered generations, the
hourglass chart and printing.

## Consequences

- Existing accounts see fewer people in the Family tree after the upgrade until they turn the setting on.
- The previous release ignores the new columns, so restoring the safety copy to it is safe.
