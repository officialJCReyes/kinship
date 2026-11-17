# 0019. A calendar beside the typed date

- Status: **Proposed** (a draft pull request; not for 0.2.0)
- Date: 2026-11-17
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0011 An account's own display settings](0011-display-settings.md)
- Source: JC's brief for step 19 (the calendar picker).

## Context

Every date in KinShip is typed as YYYY, YYYY-MM or YYYY-MM-DD, with how sure it is (exactly, about, before, after), and shown in the account's date format. That is what makes partial and approximate dates possible. A browser date input (`type="date"`) cannot hold a year or a month alone, so it cannot be the storage or the field. There was one shared date entry (`components/DateInput.tsx`) used by Edit details, Add relative, the relationship forms, the adoption and link dates and the wizard.

## Decision

- **A hand-built picker, no new dependency** (`components/CalendarPicker.tsx`, arithmetic in `lib/calendar.ts`). A library would add a package that the "Dependency licenses" job must accept, a bundle cost, and a theming layer over four colour schemes; what is needed here (a month grid, year and month choosers, partial dates) is about 300 lines, and the one hard part, calendar arithmetic for years from 1 to 9999, is a page of integer maths that is tested directly. Libraries also tend to build on the JavaScript `Date`, which maps years 0 to 99 to 1900 to 1999, which genealogy cannot accept.
- **It is added to `DateInput`**, so it is in every form that takes a date, and in any date field added later, with no per-form work.
- **Typing is unchanged.** The picker is a button beside the field that opens a calendar in place (not a floating layer, so no dialog clips it and it works at phone width). It only changes the field's text when a day, a month or a year is chosen.
- **What it writes is the field's own format, YYYY-MM-DD, YYYY-MM or YYYY**, not the account's display format. The text field has always been typed in that one format and the API takes it; ADR 0011 keeps the display format to how a date is *shown*. The account's format is respected where dates are shown: each day's accessible name ("Jun 15, 1903", "15 Jun, 1903", "15/06/1903"), the "Use Jun 1903" button, and the "Reads as: …" line under the field. (If the field itself should instead be typed in the account's format, that is a larger change to every form and to the parser and is not made here.)
- **Partial dates.** The calendar opens on the year, month or day the field holds, not on today (on today when the field is empty or not yet a date). Besides a day, **Use the year 1903** and **Use Jun 1903** fill the field with just that much. The "how sure" choice is untouched.
- **Distance.** A Year box (type 1903, or the arrow keys) and a Month list, plus previous and next month, so 1903 is typing a year and choosing a month, not hundreds of clicks.
- **Keyboard.** One tab stop in the grid (the day on focus). Arrow keys move by day and week, Home and End to the ends of the week, Page Up and Page Down by month, with Shift by year; Enter or Space chooses; Escape closes the calendar (and not the dialog around it) and puts focus back on the button; a click or focus elsewhere closes it without taking focus. Focus moves to a day when it opens. Names: the button says what it is for ("Choose Birth date on a calendar"), the calendar is a labelled non-modal dialog, the month on view is announced, and the grid and its headings are real table semantics.
- **Weeks start on Sunday** in every format. (Day-first formats often start on Monday; that is a small later option.)
- **Colours** come only from the scheme tokens already tested for contrast in all eight scheme and theme combinations (ink on panel, muted on panel, accent-ink on accent), and an end-to-end test measures the rendered colours in all eight.

## Consequences

- The wizard's partner date of birth (a separate pull request) gets the picker the moment it is merged, because it uses `DateInput`.
- Tests that find a date field by a label that is a part of the picker button's name ("Birth date" is inside "Choose Birth date on a calendar") must match the label exactly.
- New strings are translation keys (`date.pick`, `date.picker.*`, `date.weekday*`).
- A month and year chooser as a grid (instead of a Year box and a Month list) and a Monday start are possible later without changing the contract.
