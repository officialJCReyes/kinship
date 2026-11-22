# 0032. A calendar beside the typed date, and the week start setting

- Status: **Accepted** (decisions by JC, 2026-11-21)
- Date: 2026-11-22
- Builds on: [0005 People, relationships and who may change them](0005-people-and-relationships.md), [0011 An account's own display settings](0011-display-settings.md), [0027 Chart settings](0027-chart-settings.md)
- Source: issue #109; the text of the first draft is ported from the closed draft pull request #92.

## Context

Every date in KinShip is typed as YYYY, YYYY-MM or YYYY-MM-DD, with how sure it is (exactly, about, before, after), and shown in the account's date format. That is what makes partial and approximate dates possible. A browser date input (`type="date"`) cannot hold a year or a month alone, so it cannot be the storage or the field: measured in Chromium 159, assigning `1903` or `1903-06` to one leaves it empty. One shared date entry (`components/DateInput.tsx`) is used by Edit details, Add relative, the relationship forms, the adoption and link dates and the setup wizard.

## Decision

- **A hand-built picker, no new dependency** (`components/CalendarPicker.tsx`, arithmetic in `lib/calendar.ts`). A library would add a package the "Dependency licenses" job must accept, a bundle cost and a theming layer over four colour schemes; what is needed (a month grid, year and month choosers, partial dates) is about 300 lines, and the one hard part, calendar arithmetic for years 1 to 9999, is a page of integer maths that is tested directly. Libraries tend to build on the JavaScript `Date`, which maps years 0 to 99 to 1900 to 1999; genealogy cannot accept that.
- **It is added to `DateInput`**, so it is in every form that takes a date, and in any date field added later.
- **Typing is unchanged and stays the source of truth.** The picker is a button beside the field that opens a calendar in place (not a floating layer: dialogs would clip it, and it works at phone width). It changes the field's text only when a day, a month or a year is chosen.
- **It writes the field's own format, YYYY-MM-DD, YYYY-MM or YYYY**, not the account's display format (ADR 0011 keeps the display format to how a date is shown). The account's format shows where a date is read: each day's accessible name, "Use Jun 1903", and the "Reads as" line.
- **Partial dates.** The calendar opens on the year, month or day the field holds (today when it is empty or not a date). Besides a day, "Use the year 1903" and "Use Jun 1903" fill the field with just that much. The "how sure" choice is untouched.
- **Distance.** A Year box and a Month list, plus previous and next month, so 1903 is typing a year and choosing a month, not hundreds of clicks.
- **Keyboard and screen reader.** One tab stop in the grid; arrows move by day and week, Home and End to the ends of the week, Page Up and Page Down by month (with Shift by year); Enter or Space chooses; Escape closes the calendar and not the dialog around it, and focus returns to the button. The calendar is a labelled, non-modal dialog; the month on view is announced; the grid is a real table with weekday headings.
- **Colours** come only from the scheme tokens already tested for contrast in all eight scheme and theme combinations.
- **The week start is a setting of the account** (migration 0020, `users.week_start`): `sunday` (the default, for every account including existing ones), `monday` or `saturday`. It does not follow the date format (ISO and day-first formats are not a sign of a Monday week, and the choice is cheap to make once). It is in My settings, Display, next to the date format, with a live example; it is not in the chart's gear panel, which holds chart settings.

## Consequences

- A new column on `users` with the same shape as 0017 and 0018 (additive, a CHECK, a column grant for the app role); the first-run wizard's one write accepts it. Nothing changes for the previous release, which ignores the column.
- Tests that find a date field by a label that is part of the picker button's name ("Birth date" is inside "Choose Birth date on a calendar") must match the label exactly.
- New strings are translation keys (`date.weekdayShort.*`, `date.weekdayLong.*`, `date.picker.*`, `settings.weekStart*`).
- Not built: typing dates in the account's format (a parser per format, ambiguous for 01/02/2026), a range picker, Julian or lunar calendars.
- Screen readers, Safari, Firefox and a real phone were not used to check the first version; a manual checklist is in the pull request.
