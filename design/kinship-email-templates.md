# KinShip email templates (Nov 14, 2026)

Asked by JC: mock up the emails the app sends, starting with the welcome/invite email and the birthday reminder, then the password reset, weekly digest, medical-edit notice and DNA-added notice, matching the rest of the app. Companion to `kinship-v2-requirements.md` (notifications, email provider) and `kinship-navigation.md`.

## Where it is in the mockup
Admin → **Emails** tab (admins only; Members and Users cannot reach Admin). A list of templates on the left, a preview on the right with From, To, Subject and Preview text, switches for **Desktop / Phone** width and **Email / Plain text**, and buttons "Send test to me" and "Copy HTML". Six templates are designed; the rest are listed as "Next".

## Look (matches the app)
- One column, 560 px wide, on the app's cream background (#F6F4EC). White card with a thin border and rounded corners.
- Deep teal header (#1E4D4A) with the KinShip logo (the version for dark backgrounds), so the brand is the first thing seen.
- Headings in a serif (Fraunces in the app, Georgia as the email-safe fallback); body in a system sans font. Text #17231F, muted text #5B6A65, borders #D9E0DB.
- One primary button in the same teal, and an outlined secondary button where a second choice is needed. Person cards use the app's initials avatar (light green circle, serif initials). Digest sections use small teal capital headings with a rule.
- Table layout with inline styles so it holds up in Outlook and on phones. Plain-text part generated from the same content, so the two always agree.
- Emails are light-theme only for now (many clients ignore dark styles). No tracking pixels, no remote images except the logo.
- **No health details and no DNA results or matches ever appear in any email.** The medical-edit notice says only that something changed; the DNA notice names only the provider and kind of test.

## 1. Welcome and invitation (designed)
Subject: "<Inviter> invited you to the <Tree name> tree". Preview text: "Accept your invitation to the family tree. The link works for 7 days."
Content, in order: heading "You're invited to the Hale Family tree"; who invited you and what KinShip is; **optional personal note** from the inviter (quoted block); a card saying either "Your account is linked to <Person>" or "You are not linked to a person yet"; your role and what it allows (Member: view the tree, add photos and sources, edit your own profile, add your children; User: view the tree and photos); **Accept invitation** button; small print with the expiry (link works once, 7 days) and the full address to copy if the button fails; "A few things worth knowing": health is private and shared person by person, DNA results are visible to family accounts but match lists and files stay with you, reminders are chosen in My settings. Footer: sent by the tree, and "if you were not expecting this, ignore it; nothing happens until you accept."
Variants in the mockup: linked to a person / not on the tree; personal note on or off.
Rules: the link is single-use and expires after 7 days; an admin can resend or revoke it from Users (the Users tab already shows an "Invited" status).

## 2. Birthday reminder (designed)
Sent to each account at the lead time that person chose in My settings: on the day, 1 day before, or 1 week before.
- **On the day:** subject "<Name> turns 68 today", heading "It's Daniel's birthday today", one person card (initials, name, "Turns 68 · Father", date), button "Open Daniel's profile".
- **1 day before:** subject "Sofia Hale turns 37 tomorrow", same layout.
- **1 week before:** a short list, subject "2 birthdays this week", a card for each person with the weekday and date, button "See everyone coming up".
The relationship ("Father", "Sister") is worked out from the tree for the person receiving the email. **Children under 18 are never included**, and the footer says so. The footer links to My settings to change or turn off reminders.

## 3. Password reset (designed)
Local accounts only. Two emails:
- **Reset link.** Subject "Reset your KinShip password". Heading "Reset your password"; says someone asked to reset the password for the account (shows the account address); **Choose a new password** button; small print: the link works once and expires in 1 hour (with the clock time) and the full address to copy; "Good to know": ignore it if you did not ask, your current password keeps working; KinShip never emails or asks for your password; people who sign in with Authentik change their password there. A new request cancels the older link.
- **Password changed.** Subject "Your KinShip password was changed". Says when it changed and that every other device was signed out; if it was not you, a **Secure my account** button (signs out everything and forces a new password) and a note that a family admin can lock the account. This is a security notice and **cannot be turned off**.

## 4. Weekly digest (designed) - off by default
**Decided by JC: the weekly digest is off by default.** Nobody gets it unless they turn it on. In the mockup:
- My settings → notifications has a **Weekly digest** checkbox, unchecked, described as "A Sunday email with the week's birthdays, new photos and changes to the tree. Off by default." (It no longer means "instead of single emails"; it is an extra email.)
- Admin → Storage & email → Notification defaults has a **Weekly digest (off by default)** checkbox, unchecked, so an admin can switch it on for new accounts.
- The digest preview shows a banner saying this.
Content ("Busy week"): heading "This week in the Hale Family tree", the date range, then sections **Birthdays this week** (person cards with weekday and date), **New photos and documents** (title, who added it, date) and **New on the tree** (who was added or changed, by whom, date), and an **Open KinShip** button. "Quiet week" variant: "A quiet week in the Hale Family tree", only the birthdays. If there is nothing to report and no birthdays, the email is not sent (my assumption). Sent on Sunday at the send time set in Admin (my assumption). The footer says why they are getting it and that it is off unless chosen.
Privacy: never mentions health, DNA, or who shared what; children under 18 are left out of the birthday list. Each item links to the app, where normal permissions apply.

## 5. An admin edited your medical record (designed, added Nov 14)
Sent to the person whose record was edited. Subject "An admin edited your medical record". Heading the same; says **who** (the admin's name and that they are a family admin) and **when**, then a card "What changed is not shown here" explaining the email never says what was edited. **Open my change history** button (the change history on the Medical history tab lists each edit and who made it). "Good to know": an admin can edit your record only because you shared it with them, and you can stop sharing any time under "Who can see my record"; if you did not expect the change, tell a family admin or undo it yourself from the change history; conditions marked Private stay hidden while you are living.
Variants: **One change**, and **Several changes** (subject "An admin made 3 changes to your medical record", with the time span). Edits by the same admin within 15 minutes are grouped into one email (my assumption). Sent right away. It is on by default (the existing "An admin edits my medical history" setting, "Recommended") and the person can turn it off in My settings; the change history keeps the full record either way.

## 6. DNA added on your behalf (designed, added Nov 14)
Sent to a person with an account when an admin uploads DNA for them. Subject "<Admin> added DNA results for you". Heading "DNA results were added for you"; says who added it, when, and that they recorded the person's permission (for example "agreed by email"); a card with the provider, kind of test, year and markers read (for example "23andMe · Autosomal + mtDNA, taken in 2021, about 640,000 markers read"); **Yes, this is right** (primary) and **Remove these results** (outlined) buttons. "Who can see what": the test, haplogroups and ethnicity estimate are visible to every account; match lists and the raw file are visible only to the tested person and the admin who added them cannot open either; removing deletes the results and the file and tells the admin who added them.
Assumptions to confirm: confirming is optional and the results stay visible if the person does nothing (the footer says nothing changes if you do nothing); people without an account cannot be emailed, so for them the admin keeps the permission note only.

## Next templates (listed in the mockup, not designed)
Anniversary and remembrance (optional, off by default); "Your account was linked to a person".

## Sending rules
Sent through the provider set in Admin → Storage & email (Resend API or SMTP), from `MAIL_FROM`; links are built from `PUBLIC_URL`. No AI: every sentence is fixed text filled with the family's recorded facts.

## Open
- Whether unconfirmed DNA results should stay visible until the person confirms (currently they stay visible).
- Whether the tree name, logo or footer wording should be editable by an admin (currently fixed).
- Whether to offer a dark-mode version later.
- Whether the digest day (Sunday) should be a setting.
- Which template to design next (suggested: "Your account was linked to a person", then anniversary and remembrance).
