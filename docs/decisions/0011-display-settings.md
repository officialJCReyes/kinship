# 0011. An account's own display settings

- Status: **Accepted** (decisions by JC, 2026-11-16). The surname choice is amended by [0024](0024-names.md): it became four name forms plus prefix and suffix switches.
- Date: 2026-11-16
- Builds on: [0003 Accounts and sessions](0003-accounts-and-sessions.md), [0007 Birth and adoptive parent links](0007-adoption-parentage.md), [0008 Second and married surnames](0008-names-and-widowed.md)
- Sources: `design/kinship-color-schemes.md`, `design/kinship-v2-requirements.md` (dates, surnames), `design/kinship-adoption.md`, the mockup's My settings page. Where the mockup differs (the surname choice sits in the relationship forms there, the theme only in the preview bar, the family view is not on its My settings page), the step brief won.

## The settings

Five choices, saved on the account, applying to that account only and changing nothing about who can see what: **color scheme** (`forest` default, `sand`, `slate`, `graphite`), **theme** (`device` default, `light`, `dark`), **date format** (`mdy` default "Jan 1, 2026", `dmy` "1 Jan, 2026", `dmy2` "1 Jan 2026", `long` "January 1, 2026", `iso` "2026-01-01", `us` "01/01/2026" month first, `eu` "01/01/2026" day first; only how a date is shown, the stored text is untouched), **surname choice** (`married` default: the married surname when someone has one, which replaces both birth surnames; or `birth`: the surname and the second surname), and **lineage view** (unchanged, `adoptive` default). The codes are the mockup's.

## Storage: columns on `users`

Migration 0010 adds `color_scheme`, `theme`, `date_format` and `surname_choice` to `users`, each `NOT NULL` with its default and a `CHECK` on the list, next to `lineage_view`. They are a handful of small choices read with the account on every request, the `me` response and the `users_update_own` policy already exist, and `complete_setup` needs no change because the defaults apply. The app role gets `SELECT` and `UPDATE` on exactly these four columns (like `lineage_view`), so an account can change its own settings and nothing else about itself: role, email, name, password and the person link stay untouchable, and another account's row is not visible to it.

A separate settings table waits for the **0.4 notification settings** (eight or more fields: reminders, lead times, email and in-app, digest), which are many more and not read on every request. Then the display settings can stay here.

**A family default scheme** (a SuperAdmin choosing what new accounts start with) is not built; new accounts start on Forest. It stays possible without changing these columns: a later `family_tree` default would be copied into a new account's column when the account is created.

## The API

`PATCH /api/auth/me` takes any non-empty subset of the five settings, checked by one shared function, `parseUserSettings` (in `packages/shared`): an unknown key or an empty body is `invalid_request`, and a value not on its list is that setting's own code (`invalid_color_scheme`, `invalid_theme`, `invalid_date_format`, `invalid_surname_choice`, and the existing `invalid_lineage`), with nothing saved when any part is refused. A request with only `lineageView` works as before. The reply is the same `MeResponse`; `GET /api/auth/me`, login and setup return the four new fields flat on the user, like `lineageView`. `POST /api/setup` may carry an optional `settings` object, checked by the same function and saved on the new account, so the first-run wizard needs no second validation.

## The client

Date text and names go through one helper each: `formatPartialDate` (`packages/shared`; month names from translation keys, no `Intl`; a bare year stays a year; the stored text is never changed) and `displayName` / `displaySurname` (`apps/web/src/lib/names.ts`), which read the account's choice from a small display store fed from `/api/auth/me`. The routed page is keyed by the date format and the surname choice, so a change remounts it once (memoized chart nodes included); My settings itself is not remounted by what is changed on it, so the focus stays on the control.

The color scheme and theme are attributes on `<html>` (`data-scheme`, `data-theme`) set before the first paint by `public/theme-init.js`, a plain same-origin script (the nginx CSP is `default-src 'self'`: no inline scripts). It reads a two-word mirror of the account's choice from `localStorage` (`kinship.display`), resolves Device with `matchMedia`, follows the device while the page is open, and updates the `theme-color` meta. The account is the source of truth: sign-in, `/api/auth/me` and a save rewrite the mirror, and it survives sign-out so `/login` and `/setup` keep the look. nginx serves the script with `Cache-Control: no-cache` (revalidated by ETag) and a 404 when missing. A contrast test reads `styles.css` and checks WCAG ratios in all 8 scheme and theme combinations; one pair is below 4.5 : 1 and reported, not changed (the good-status pill in the light schemes, issue #44).

## Design docs that are now behind

These live in `design/` and are not edited by the build; they are listed so the Project copies can be updated.

- **Release plan, 0.2:** "flexible date entry and per-user date format" and "My settings; the four color schemes" are built; "light and dark theme following the device" is now one of three choices (Device, Light, Dark).
- **Requirements doc, "Dates" and "Maiden and married surnames":** the date format and the surname choice are in My settings as described; the format codes are the mockup's. The mockup's "Surname shown on the tree" select inside the relationship forms is replaced by the My settings choice (the mockup also rewrites the stored surname; the build never does).
- **Color-schemes doc:** "Remembered in the browser in the mockup. In the real app it would be saved on the account" is built: saved on the account, with a browser mirror only to paint the page before sign-in. The first-run swatches and the family default scheme are not built (step 15 and an open issue).
- **Adoption doc:** "My settings, Display, 'When someone was adopted, show'" is built under a **Family** section on My settings (the mockup's My settings page does not have it).
- **Navigation doc:** the account menu now exists with My profile (only for an account linked to a person), My settings, About KinShip and Sign out; Import & export, Admin and Deployment join it with their steps. "My profile" and "About" are no longer in the top navigation.
- **Mockup, default date format:** "Jan 1, 2026" is now the default (the alpha showed "January 1, 2026").
