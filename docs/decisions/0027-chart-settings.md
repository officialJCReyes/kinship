# 0027. The chart's settings (gear), and how the chart opens

- Status: **Accepted** (decisions by JC, 2026-11-18 to 2026-11-21, step 33). First version, finished in the last PR of step 33.
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

### The wheel

`treeWheel = scroll` makes the wheel pan (`deltaX`, `deltaY`, line and page deltas normalised; Shift plus a vertical wheel pans
sideways); Ctrl or a trackpad pinch still zooms, the buttons and keys are unchanged, and the pan is not clamped. It is in
`useChartViewport`, so it applies to all four views.

### The default view applies at entry points only

`treeDefaultView` is used where a chart opens fresh: `/tree` (the Tree tab) and the sign-in landing. A bare `/tree/:id` is always the
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
Cards, Names, Relatives, Navigation (Relatives and Navigation open, nothing remembered). It shares one popover hook with the
view switcher (Esc, outside press, focus return; opening one closes the other). A change is one `PATCH /api/auth/me`, applied to
the session cache at once and rolled back with an alert on failure. A name change used to remount the whole routed page
(0011); now only what must be redrawn is, so the panel, focus and the viewport stay.

### Not in step 33 (deferred)

A black ribbon for the deceased, solid card colors and vertical cards (they need photos), per-view remembered generations, the
hourglass chart and printing.

## Consequences

- Existing accounts see fewer people in the Family tree after the upgrade until they turn the setting on.
- The previous release ignores the new columns, so restoring the safety copy to it is safe.
