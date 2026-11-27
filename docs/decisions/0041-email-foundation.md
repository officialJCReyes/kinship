# 0041. Sending email: environment-only settings, an outbox, two providers

- Status: **Accepted** (JC, step 48 decisions 11 to 14 and 18, and the step 53 answers, 2026-11-27; built in step 53)
- Date: 2026-11-27
- Migration: 0026 (`mail_outbox`, `mail_template_overrides`)
- Related: [0003 Accounts](0003-accounts-and-sessions.md), [0012 Account links](0012-account-links.md),
  [0014 Backups and owner access](0014-backup-and-owner-access.md), [0035 Restore with photos](0035-restore-with-photos.md),
  [0042 Sign-in limits](0042-sign-in-limits.md)
- Later in 0.4.0: step 54 (invitations, reset requests and the "password changed" notice by email) and step 57
  (notifications) send through what this ADR builds; 53b adds the templates and their editor (the api in 53b-api, the Emails
  tab in 53b-web), 53c the Deployment page.

## Context

Up to 0.3.0 KinShip sent no email: an admin passed on a show-once link. 0.4.0 adds invitations and reset links by email, the
"password changed" notice and notifications. They need one sender that is safe to leave misconfigured, never slows a request,
loses nothing on a restart, and never puts a secret in the database, the API or a log.

## Decisions

### Settings live only in the environment
`MAIL_FROM`, and either `RESEND_API_KEY` (or `_FILE`) or `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`
(or `_FILE`). `MAIL_PROVIDER` (`resend`, `smtp`, `off`) is optional: the provider is inferred from which key is set, and is
required only when both are. Links in emails start with `PUBLIC_URL`. The key and the password are removed from the process
environment once read, like the other secrets. Nothing about mail settings is stored in the database or editable in the app.

- **Nothing set: "not set up".** The app behaves exactly as 0.3.0 did. Step 54 asks `mail.isConfigured()` before offering
  "Send by email" or "Forgot password?".
- **Half set: KinShip refuses to start**, with a message that says what is missing (a provider with no `MAIL_FROM`, a user
  without a password or the other way round, both providers with no choice). Every other setting already works this way, and a
  mailer that is quietly off would make invitations fall back without the operator noticing. Nobody has these variables before
  0.4.0, so the rule cannot break an upgrade.
- **`SMTP_SECURE=none` with `SMTP_USER` is refused at start**: the password would cross the network in clear. `none` without
  credentials (a local relay on a trusted network) starts with a loud warning, and Storage & email shows "not encrypted".
- **Separate variables, not one `SMTP_URL`** (the mockup's): a password inside a URL cannot use `_FILE`, and ends up in process
  lists, logs and copy-pastes.

### Two providers
- **Resend**: plain `fetch` to the fixed address `https://api.resend.com/emails` (no SDK). Redirects are refused. Nothing in
  the environment or a request can change the address; only tests pass a local server. `HTTPS_PROXY` applies, as for the update
  check. The outbox id is sent as Resend's `Idempotency-Key`, so a retry after a lost answer is not a second email.
- **SMTP**: [nodemailer](https://nodemailer.com) 10.5.0, pinned exactly. It has no dependencies, no install scripts, and its
  own types (so no `@types/nodemailer`). Its licence is MIT-0, which was added to the Dependency licenses allow list for it
  (MIT without the attribution clause, compatible with the AGPL). 10.5.0 was the newest release at least two weeks old.
  - TLS: `starttls` (the default) requires STARTTLS, `tls` is TLS from the first byte, and `none` is above.
  - Certificates are always checked, TLS 1.2 is the oldest accepted, and there is no setting to turn checks off.
  - nodemailer is told never to read a file or a URL for a message part.
  - A server with a private certificate authority is not supported yet (#292).
- Every message carries `Auto-Submitted: auto-generated`. There are no tracking pixels and no remote images except the logo
  (53b).

### Every message goes through an outbox
`mail_outbox` holds each message from the moment it is queued until it is sent, given up or cancelled.

- **Queued in the caller's transaction**, through `kinship_mail_enqueue()` (SECURITY DEFINER), so a message exists only if
  the change that asked for it commits. Step 54 calls `mail.enqueue(trx, …)` inside its own transaction, then `mail.kick()`
  after the commit.
- **Sent by the api itself**: by a job in the existing runner every minute, and at once after a `kick()`. A slow or
  failing provider never holds up a request.
- **The lock is a row claim, not an advisory lock.** A sender takes up to 10 due rows at a time with
  `FOR UPDATE SKIP LOCKED`, marks them `sending`, and holds them for 5 minutes (`locked_until`).
  - With several api containers, each takes different rows instead of waiting on one lock.
  - A sender that dies mid-send leaves its rows to run out, and the next claim takes them back. Delivery is therefore
    **at least once**: a duplicate is possible in that rare case. Resend's idempotency key removes it there; SMTP has no
    such guard.
  - At most 50 messages are sent per pass.
- **Retries:** 7 attempts in all, waiting 1 min, 5 min, 15 min, 1 h, 3 h and 6 h between them (about 10 hours).
  - **Permanent** (fails at once): a refusal of this message itself. That is SMTP 5xx on the envelope or the message, and
    Resend 400 or 422.
  - **Temporary** (retried): anything the operator can fix, or that time can. That is a refused sign-in, a wrong key, an
    unverified sender domain, a missing STARTTLS, a certificate problem, no connection, 4xx, 429 and 5xx. So queued messages
    still go once the setting is fixed and KinShip restarted.
- **Expiry:** a message whose link stops working (`expires_at`, step 54) is cancelled rather than sent late.
- **Privacy:**
  - The subject and both bodies are cleared the moment a row is sent, given up or cancelled. A body can hold a one-time
    link, which is a credential, and the subject can hold a name. The table's CHECK makes that a rule, not a habit.
  - Finished rows (template, recipient, times, the cleaned error) are deleted after **30 days**.
  - Logs name the message id, its template and the attempt, never the address, subject or body.
- **Who sees it:**
  - The app role has no grant on the table at all. It queues through the function above.
  - The SuperAdmin's status page reads counts, the last failure and the last test through `kinship_mail_status()`. That
    returns no address, subject or body, and refuses anyone but the SuperAdmin.
  - The sending side connects as the owner role, like backups and the update check.
- **Errors are cleaned before they are stored or shown:**
  - the configured key and password, and their base64 and SMTP AUTH forms, are replaced;
  - `Authorization` and bearer values, `re_` keys and AUTH lines are removed;
  - every address is masked to its domain;
  - control characters go, and the text is cut at 300 characters.
  - A few common causes then get one plain sentence of advice on the page (fixed translation keys, never the provider's words):
    - Resend: domain not verified, key refused, no connection;
    - SMTP: sign-in refused, certificate not trusted, STARTTLS missing, no connection.

### Backups leave the outbox rows out
The table is in every dump, but its rows are not. This covers the encrypted archives and the plain pre-upgrade copy, both
using `--exclude-table-data`. The backup manifest counts the outbox as empty, and a restore clears it as it clears
sessions.

Restoring old queued mail could send stale or duplicate messages, including links that no longer work. `mail_template_overrides`
is the family's own text and **is** backed up. A pre-0026 archive restores and then gains both tables, empty.

### Storage & email (53a) and "Send test to me"
`GET /api/admin/mail` and `POST /api/admin/mail/test` are **SuperAdmin only** (403 for everyone else) and never cached
(`Cache-Control: no-store`).

- **The status shows:**
  - the provider, `MAIL_FROM` and `PUBLIC_URL` (with a warning when it is still the default, or `http://` on a real host);
  - for SMTP, the host, port, TLS mode and user name, and whether a password is set;
  - for Resend, only that a key is set;
  - the queued count, the failures of the last week, the last failure and the last test.
- **The test goes only to the signed-in SuperAdmin's own account address.**
  - The recipient is never read from the request: a body with anything in it is refused with 400, and a query parameter is
    ignored.
  - Mail not set up answers 409 `mail_not_configured`.
- **Limits**, with ADR 0042's `FailureLimiter` in block mode, counting every test sent or not:
  - 5 per account in 15 minutes;
  - 20 an hour for the whole install;
  - a flat cap of 10 requests a minute per account on the route.
- **The limiters, the test-send limit included, are per process and forget everything on a restart**, as ADR 0042 says. The
  outbox itself is safe with several api containers (the row claims above). Only the counting of test sends is per container.

### The Storage & email page (53a-web)
- **Admin → Storage & email** (`/admin/storage`) is a SuperAdmin tab. Everyone else has no tab and gets the not-found page,
  as on Backups. The tabs follow the mockup's order: Users, Storage & email, Backups, Updates.
- It holds the **Photos and files** card, moved from Backups (`GET /api/admin/files` is unchanged; Backups still reads it
  for the photo size beside "Include uploaded files"), and the **Email** card with the status above.
- "Not set up" links to "Sending email" in INSTALL.md on `main`, and the test button is disabled with the reason beside it.
- After a 202 the page asks for the status every 2 seconds for at most 30 seconds, and stops as soon as the test is sent or
  failed. It does not ask while the page is hidden (a hidden tab runs no interval). A 429 shows `retryAfterSeconds`.
- Every value from the api is shown as text, never as HTML. The cleaned error is shown as the api returned it, with the
  plain-sentence hint (`mail.hint.<code>`) under it.

### Email text and translation
Email text is not UI text: emails are rendered by the api, and later per recipient. The built-in wording lives with the
templates in `apps/api/src/mail/` (English only, like the app at launch). The page around it uses translation keys as usual.
53b adds the templates, the editor and the rules for admin-edited text.

### Templates (53b)
**One source, two parts.** An email is a list of nodes: heading, paragraph, card (initials circle, title, detail), quote
(someone's own words and who wrote them), button, small print and list. `layout.ts` prints them once as HTML and once as plain
text, so the two parts always say the same thing. `render.ts` fills a template, and `templates/*.ts` holds one file per
template.

**The look** follows `design/kinship-email-templates.md`:
- one 560 px column on the cream page (#F6F4EC), a white card with a thin border (#D9E0DB);
- a deep teal header (#1E4D4A) with the logo, Georgia headings, a system sans body, text #17231F, muted #5B6A65;
- one teal button.

It is built for the strictest clients (Outlook on Windows draws with Word):
- tables for all layout, every style inline;
- no `<style>`, no `class`, explicit `width` and `bgcolor`;
- light theme only (`color-scheme: light`).

**Images and links:**
- The only image is the logo, `PUBLIC_URL/email/logo.png`, with alt text. It is the reversed (teal-background) logo from the
  brand kit, scaled to 258 × 96, and served by the web container without sign-in. There is no tracking pixel.
- A test checks the file is in `apps/web/public/`, and an e2e step checks the built web image serves it as `image/png`.
- Every button address must start with `PUBLIC_URL`, or rendering throws. Links come only from the caller (step 54 builds them),
  never from text.

**What ships in 0.4:**

| Template | Editable fields (besides subject and preview) | Fixed in code |
|---|---|---|
| `invitation` | heading, intro, extra "worth knowing" items, footer | the note, the person card, the role sentence, **Accept invitation**, the expiry and full link, the two privacy lines |
| `password_reset` | heading, intro, "good to know" items, footer | **Choose a new password**, the expiry and full link, "a new request cancels it", "KinShip never emails your password" |
| `password_changed` | heading, body, "if this was not you" (may be reworded, never emptied) | the family-admin line, the security-notice footer, and **Secure my account** |
| `test` | nothing: fixed text | everything |

- **"Secure my account"** in `password_changed` is drawn only when the caller passes a link. Step 54 decides whether that
  route exists; until it does, the email tells the reader to ask a family admin. It never promises a link "coming later".
- **Step 57's templates are reserved:** `birthday_today`, `birthday_tomorrow`, `birthday_week`, `weekly_digest` and
  `medical_edit`. They are listed as "Next", have no content, and answer 404 when opened. DNA-added is not in 0.4.
- **Wording:** sections 1 and 3 of the templates doc, with these changes:
  - the invitation link is the caller's `link`, and how long it works is the caller's `expires` ("7 days", "1 hour");
  - the reset email never says whether an address has an account (step 54 sends it only to an account that can use it).

**Placeholders.** A placeholder is `{name}`, and each field allows its own short list:

| Template | Placeholders |
|---|---|
| `invitation` | `inviter`, `tree`, `role`, `expires` |
| `password_reset` | `name`, `email`, `tree`, `expires` |
| `password_changed` | `name`, `tree`, `when` |

- No placeholder can carry health, DNA or a birth date, and the person and the note are code, not placeholders.
- Filling in is one pass: a value that contains `{tree}` is printed as written.
- **Literal braces** (left open by 53a): braces are for placeholders only. There is no way to write a literal `{` or `}`, and
  the editor's help text says so. Family text has no use for them, and an escape such as `{{` would be one more rule to learn.

**Admin text is always text.** It is escaped, a blank line starts a paragraph, and a single line break is kept. No HTML from
an admin ever reaches an email. The subject and preview become header-safe: line breaks and control characters turn into
spaces, and they are cut at 200 characters.

**Checks on a draft.** A failed check answers 400 `invalid_template` with every problem listed (`field`, `problem`, and
`placeholder` or `max`):
- an unknown placeholder;
- a stray brace;
- a subject or preview over 150 characters, or with a line break (a heading also stays on one line);
- a block over 1,000 characters;
- an empty subject, heading or security-notice text;
- an unknown field.

**Storage.**
- Only the fields that differ from the default are stored, so a default improved in a later release still reaches every family
  that did not change it.
- The subject goes in `mail_template_overrides.subject`, and every other field (the preview included) goes in `blocks`.
- Saving the defaults removes the row.
- **Reset to default** is `DELETE …/:id` for the whole template, or `?field=<key>` for one field.
- The fixed test email answers 409 `mail_template_fixed` to an edit, and its stored overrides would be ignored anyway.

**Routes** (SuperAdmin only, `no-store`, 403 for everyone else):

| Route | What it does |
|---|---|
| `GET /api/admin/mail/templates` | The list: id, editable, reserved, overridden. The web app names each template from its own translation keys, so the api sends no display name. |
| `GET /api/admin/mail/templates/:id` | The fields: key, kind, required, limit, allowed placeholders, default. Also the current overrides. |
| `PUT /api/admin/mail/templates/:id` | Saves `{ fields }`. |
| `DELETE /api/admin/mail/templates/:id` | Reset to default. |
| `POST /api/admin/mail/templates/:id/preview` | Renders a draft (or, with no body, the saved text) and returns `{ subject, html, text }`. |
| `POST /api/admin/mail/templates/:id/test` | Sends a test of the saved text. |

- **The preview** uses the Hale sample and a link on `PUBLIC_URL` with the token `SAMPLE-not-a-real-link`. It saves nothing,
  queues nothing and creates no invitation or reset.
- **The test** sends the saved text with the same sample, "Test: " in front of the subject, to the signed-in SuperAdmin's own
  address only. A body is refused, as on `POST /api/admin/mail/test`, and the two routes share one set of limits.
  - It is queued as template `test`, so it shows as "the last test" on Storage & email and never looks like a real
    invitation in the outbox.
  - With mail not set up it answers 409 `mail_not_configured`. Editing and previews still work.

**Queueing a templated email (for step 54).**
- `enqueueTemplate(trx, mail, publicUrl, { template, to, toUserId, params, expiresAt })` reads the overrides in the caller's
  transaction (any signed-in user may read them), renders, and queues through `mail.enqueue`.
- `params` is typed per template:
  - invitation: `inviter`, `tree`, `person`, `role`, `expires`, `link`, `note`;
  - reset: `name`, `email`, `tree`, `expires`, `link`;
  - changed: `name`, `tree`, `when`, `secureLink`.
- `mail.enqueue` from 53a is unchanged. It still takes a finished message, for callers that render their own.

**Privacy.** A test renders every template with Hale fixtures whose health, DNA and under-18 values are unique markers, and fails
if a marker appears. It also fails on a short list of words: diagnosis, medication, condition, haplogroup, centimorgan, ethnicity,
genetic, DNA, health and match. The one listed exception is the invitation's two fixed privacy lines, which say that health and
DNA stay private.

### The Emails tab (53b-web)

- A SuperAdmin tab right after Storage & email: Users, Storage & email, Emails, Backups, Updates. Prompt 12 places it there; the
  mockup puts Emails after Updates, among tabs not built yet. A Family Admin, a Member and a User get the not-found page, as on
  Storage & email. `/admin/emails` opens the invitation; each template has its own address (`/admin/emails/<id>`).
- The list names each template from the web app's translation keys (the API sends ids). It marks the changed ones and the fixed
  test email; the five reserved templates show "Next" as plain text, not links, and their addresses give the not-found page.
- Each field is a plain textarea with its rules (one line, or a blank line starts a paragraph or a list item), its note where
  KinShip keeps fixed lines around it, and its placeholders as buttons that put `{name}` at the cursor. The help text says that
  braces are only for placeholders.
- Live errors: 400 ms after the last key press the draft goes to `POST …/preview`. A 200 redraws the preview; a 400
  `invalid_template` marks each field it names, and the last good preview stays with a note. Nothing is saved until Save.
- Save sends the whole draft (the API keeps only what differs from the defaults). Reset to default deletes every change after
  a confirm. The status line ("Unsaved changes.", "Uses your family's text.", "Uses KinShip's default text.") and the saved,
  reset and error banners are elements of their own, so a test or a screen reader finds each one by its exact text.
- Send test to me sends the saved text, not the draft, and says so when there are unsaved changes. It is off with the reason
  when email is not set up, and shows the wait on a 429. It does not ask for the result: Storage & email shows the last test.
- The preview is the API's HTML in `<iframe srcdoc sandbox="">`: no script, no forms, no same-origin access, no navigation.
  The switches are Email / Plain text and Desktop / Phone (360 px). There is no "Copy HTML".
- The UI around the email is translated; the email's own text is the API's and is not in `en.ts`.

## Consequences
- An install with no mail settings runs as before. The two new tables exist and stay empty.
- One new production dependency (nodemailer, MIT-0).
- The outbox can briefly hold a reset or invitation link in clear in the database, until it is sent, which is normally
  seconds. A backup never carries it.
- Delivery is at least once. A rare duplicate email is accepted over a lost one.
- Notification time zone (decision 14): `app_settings.time_zone` already exists for backups, and step 57 can use it. Nothing
  here blocks that.
