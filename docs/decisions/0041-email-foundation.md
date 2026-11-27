# 0041. Sending email: environment-only settings, an outbox, two providers

- Status: **Accepted** (JC, step 48 decisions 11 to 14 and 18, and the step 53 answers, 2026-11-27; built in step 53)
- Date: 2026-11-27
- Migration: 0026 (`mail_outbox`, `mail_template_overrides`)
- Related: [0003 Accounts](0003-accounts-and-sessions.md), [0012 Account links](0012-account-links.md),
  [0014 Backups and owner access](0014-backup-and-owner-access.md), [0035 Restore with photos](0035-restore-with-photos.md),
  [0042 Sign-in limits](0042-sign-in-limits.md)
- Later in 0.4.0: step 54 (invitations, reset requests and the "password changed" notice by email) and step 57
  (notifications) send through what this ADR builds; 53b adds the templates and their editor, 53c the Deployment page.

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

## Consequences
- An install with no mail settings runs as before. The two new tables exist and stay empty.
- One new production dependency (nodemailer, MIT-0).
- The outbox can briefly hold a reset or invitation link in clear in the database, until it is sent, which is normally
  seconds. A backup never carries it.
- Delivery is at least once. A rare duplicate email is accepted over a lost one.
- Notification time zone (decision 14): `app_settings.time_zone` already exists for backups, and step 57 can use it. Nothing
  here blocks that.
