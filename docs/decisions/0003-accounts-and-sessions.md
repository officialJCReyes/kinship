# 0003. Accounts, first-run setup and sessions

- Status: **Accepted** (requested by JC, 2026-11-15; where the design docs differ from the request, the docs were followed, see "Changes after reading the design docs")
- Date: 2026-11-15
- Builds on: [0001 Stack](0001-stack.md), [0002 Web app](0002-web-app.md)

## Context

The stub user is gone. A person can set up a fresh install, sign in, and every request then runs as that person under Postgres row-level security. KinShip is public-internet facing with login required, started as one user and grows to 10 to 50 people. Scope is deliberately small: local accounts only. Invitations, SSO, two-factor, email recovery and the other roles' screens come later (see "Follow-ups").

## Changes after reading the design docs

These differ from the defaults in the request. The docs won.

1. **First-run setup also takes the tree name.** The release plan puts "account, tree name, you" in 0.1 and the mockup's setup wizard asks for the account then the tree name. The "You" step (the first person on the tree, linked to the account) needs the people tables and the colour-scheme step belongs to the 0.2 wizard, so both wait.
2. **The sign-in name is the email address.** The mockup login screen labels the field "Username" but the setup screen collects no username, and the email designs speak of "the account address". Email it is. (To confirm with JC.)
3. **The login screen footer shows the version and a source-code link**, as the AGPL decision requires.
4. **The four roles are stored** (`superadmin`, `familyadmin`, `member`, `user`, fixed codes; display names can change later). The setup account is a SuperAdmin. There is no way yet to create the others.
5. **Rate limiting is only for sign-in and setup.** The release plan lists "rate limiting and session management extras" under 1.1; that is read as API-wide limits and a sessions page. Throttling credential guessing cannot wait for a public-internet app.
6. **Sessions must be revocable per account**, because the "password changed" email says every other device is signed out. The recovery command does that.

## Decisions

### Setup
- `GET /api/setup/status` returns `{ needsSetup }`. `POST /api/setup` creates the first account (SuperAdmin), the tree, and signs the person in.
- **One-time setup token.** When the API starts with no accounts it makes a random 192-bit token, stores only its SHA-256, and prints the token once in its log. `POST /api/setup` requires it. This stops a stranger who finds a fresh instance first from claiming it. A restart before setup replaces the token (the old one stops working). The token row is deleted in the same transaction that creates the account.
- **Fails closed and race-safe.** The decisive work is in one Postgres function (`kinship_auth.complete_setup`), under an advisory lock, in one transaction: refuse if any account exists, refuse if the token does not match, create the account and tree, delete the token. Six simultaneous attempts produce exactly one account (tested). The API checks the token first, before hashing a password, so a wrong token costs almost nothing.
- Setup failures are rate limited per IP (10 per 15 minutes) and globally (30 per 15 minutes).

### Passwords
- **argon2id** through `@node-rs/argon2` (MIT; prebuilt binaries as optional packages, no install script, works on Alpine and arm64). `argon2` (the other maintained package) was not chosen because it runs a native build step at install, which this repo keeps switched off. License check: passes, no exception needed.
- Parameters are the OWASP minimum (19 MiB, 2 passes, 1 lane). They are stored in each hash; a hash with weaker parameters is upgraded the next time its owner signs in.
- The only rule is a **minimum length of 12**. The API answers `password_too_short` and the form says so before sending.
- Sign-in answers the same for an unknown email and a wrong password, and verifies against a dummy hash when the account does not exist, so the two take the same time. A failed attempt also waits 300 ms.

### Sessions
- **Server-side, in the database.** The cookie holds a random 256-bit token; only its SHA-256 is stored, so a database leak yields no usable cookies.
- Cookie: `HttpOnly`, `SameSite=Lax`, path `/`, `Secure` when the request is HTTPS. HTTPS is detected from `X-Forwarded-Proto` **only when `TRUST_PROXY` is set** (default off, so a visitor cannot make the API believe anything). The same setting decides whether `X-Forwarded-For` is used for rate limits.
- **Sliding idle expiry (14 days) with an absolute cap (90 days)**, both settable (`SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS`). Renewal writes at most once a minute per session. Logout deletes the session row. Expired sessions are removed hourly.

### CSRF
- Every state-changing request must carry `X-KinShip-Request: 1`, and an `Origin` header, when present, must match the request's host; `Sec-Fetch-Site: cross-site` is refused. No tokens in forms. Another site cannot add the custom header without a CORS preflight, which the API never grants.
- Because the host is compared, the nginx `web` container now forwards `Host` with its port (`$http_host`).

### Rate limiting
- **A plain request cap** (`@fastify/rate-limit`, MIT): at most 30 requests a minute per IP address to sign-in and to setup, successful or not. Every attempt costs an argon2 check, and the failure counters below only count failures. Found by CodeQL (`js/missing-rate-limiting`), which does not recognise the custom limiter.
- Failures are counted in memory per IP and per account (email, whether or not it exists), in a 15-minute sliding window: 20 per IP, 10 per account. Over the limit the answer is 429 with `Retry-After`, the same for real and unknown accounts. Held in memory means a restart clears the counters and it assumes one API process. Limiting per account lets an attacker lock a victim out for up to 15 minutes by failing deliberately; that is accepted as the lesser harm, and the owner's recovery command is not affected.

### Database
- Migration `0002` adds `users`, `sessions`, `setup_token` and `family_tree`.
- **The app role cannot read password hashes, sessions or the setup token, however it asks.** It gets column-limited `SELECT` on `users` (no `password_hash`) and on `family_tree`, and nothing on `sessions` and `setup_token`. Everything that must work before anyone is signed in (setup status, setup, finding a login, creating, resolving and deleting sessions) goes through a few `SECURITY DEFINER` functions in schema `kinship_auth`, each with a fixed `search_path`, executable by the app role only. Sign-in is the one place the app sees a hash, because argon2 is verified in Node.
- **Row-level security** is on for `users` (a person sees only their own row) and `family_tree` (only people who are signed in see the name). `public.kinship_user_id()` reads the transaction-local setting `kinship.user_id`, which the API sets for each request's transaction from the session. An unauthenticated request has no user and sees nothing. The setting is trusted: code that can run SQL as the app role could set it, which is the trust boundary of the whole design, so RLS protects against bugs and data leaks in queries, not against a compromised API.
- The stub user and its production guard are removed. A published image can now run in production.

### Recovery
- No email yet, so the owner can run `docker compose exec -it api kinship set-password <email>`. It prompts twice with no echo (or reads one line with `--password-stdin`); the password is never accepted as an argument, so it stays out of shell history and `ps`. It connects as the owner role from the container's own settings, sets the hash and deletes all of the account's sessions. It is not an HTTP route (tests check that no such route exists).

## Consequences and known gaps

- Only local accounts, no email, so a lost password needs shell access to the server.
- Rate-limit counters are lost on restart and are per process.
- `MIN_PASSWORD_LENGTH` and the API response types exist in both `apps/api` and `packages/shared` (see ADR 0002); a mismatch would show up as a form that accepts what the API refuses.
- `request.ip` behind two proxies is only right when `TRUST_PROXY` covers both hops. `.env.example` explains this.
- There is no way to list or revoke other sessions yet (planned with session management).

## Follow-ups (not in this change)

Invitations by link (0.2), password change (0.2), the 0.2 wizard steps (You, colour scheme, partner, parents, children), OpenID Connect single sign-on (0.4; provider-agnostic, tested with Authentik, group claims set the role, enforced while on, with `OIDC_ENABLED=false` as the break glass: see kinship-sso-oidc.md), email and password reset by email (0.4), linking an account to a person (0.4), authenticator-app (TOTP) login for SuperAdmin accounts, the break-glass path when single sign-on is off (0.4, decided Nov 18), two-factor for other roles and passkeys (1.4), session management and API-wide rate limits (1.1), admin visibility of other accounts under row-level security (with the Users page).
