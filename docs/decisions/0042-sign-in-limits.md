# 0042. Sign-in limits: block the address, slow down the account

- Status: **Accepted** (JC, step 48 decision 9; built in step 52, 2026-11-26)
- Date: 2026-11-26
- Amends: [0003 Accounts, first-run setup and sessions](0003-accounts-and-sessions.md) ("Rate limiting": the per-account lock
  "accepted as the lesser harm"), [0012 Account links](0012-account-links.md) (the global link limit now slows down instead of
  refusing)
- Issue: #227
- Migration: none. The limiters are held in memory.

## Context

ADR 0003 counted failed sign-ins per address (20 in 15 minutes) and per account (10 in 15 minutes), and refused both
over the limit, before the password was checked. So anyone who sent 10 wrong passwords for an email locked that account
for 15 minutes, and the owner's **correct** password from their own address got 429 too (#227). Changing your password,
the backup download ticket and restore had the same pattern keyed on the signed-in account, and 200 bad invitation or
set-password links from anywhere stopped every link in the install for 15 minutes.

## Decisions

### One limiter, two modes
`FailureLimiter` (`apps/api/src/auth/limiter.ts`) counts failures per key in a sliding window, in one of two modes:
- **block**: past `maxFailures` the key is refused (429 `rate_limited`, `Retry-After`) until its oldest failure leaves
  the window;
- **delay**: never refused; past `maxFailures` each attempt **waits first**, 1 s, then doubling, at most 10 s.

`check(key)` answers allow, delay or block. A `GuardSet` combines the limiters of one attempt: any block wins (with the
longest wait), else the longest delay. A block costs no password check. A delay is waited out **before** the account is
looked up and the password checked, so it is the same for a right and a wrong password, and for a known and an unknown
email.

### Sign-in (`POST /api/auth/login`)

| Limiter | Key | Mode | Limit (15 min window) | On success |
|---|---|---|---|---|
| `loginPair` | address + normalised email | block | 10 failures | cleared |
| `loginIp` | address | block | 30 failures, across accounts (was 20) | kept |
| `loginAccount` | normalised email | delay | free up to 10 failures; then 1, 2, 4, 8, 10 s | kept |

What the real owner sees:
- **An attacker on another address**: the attacker's pair is blocked after 10 guesses. The owner is **never refused**:
  they sign in at once, or after at most 10 s while the account has more than 10 recent failures.
- **An attacker behind the same address** (the same home NAT, or a misconfigured proxy, below): they share the pair, so
  the owner is refused for up to 15 minutes, as before. Accepted: we cannot tell them apart.
- **Many attackers on many addresses**: each address gets 10 guesses per account and 30 in all per window; the owner
  waits at most 10 s, then signs in. A delay does not cap a parallel attacker: what bounds the guesses is the number of
  addresses times 10. That is the trade decision 9 chose over locking the owner out.

The address limit went from 20 to 30 so a family behind one address survives a few people's typos (and an e2e run).
The plain request cap (30 requests a minute per address, ADR 0003) is unchanged.

### Typing your password again while signed in
Changing your password (`POST /api/auth/password`), the backup download ticket and restore (`reauthenticate()`):

| Limiter | Key | Mode | Limit (15 min window) | On success |
|---|---|---|---|---|
| `passwordSession` | session (token hash) | block | 10 failures | cleared |
| `passwordIp` | address | block | 20 failures, across accounts | kept |
| `passwordAccount` | account id | delay | free up to 10 failures; then 1 s to 10 s | kept |

So someone with a stolen cookie gets 10 guesses, and those guesses never stop the owner's own session from changing the
password, which is how the owner ends the stolen one.

### Links and setup
- Invitation and set-password links: `linkIp` still blocks after 20 bad links per address; `linkGlobal` (200 from
  anywhere) now **slows** every link down (1 s to 10 s) instead of refusing all of them. Link tokens cannot be guessed;
  the global limit is a brake, not a lock.
- Setup (`setupIp` 10, `setupGlobal` 30, both block) is unchanged: it only matters before the first account exists, with
  a one-time token from the server's log.
- `restore-check` has no password and keeps its plain cap of 6 requests a minute.

### Unknown emails
Keys use the normalised email whether or not an account exists, nothing in the limiters reads the database, and the
answer (status, body, `Retry-After`, the 300 ms pause after a failure, the argon2 check against a dummy hash) is the
same. A known and an unknown email use the same memory: one entry per key, whatever is behind it.

### Memory, restarts and processes
- Every limiter remembers at most `maxKeys` keys (10,000; 20,000 for the pair and account limiters, whose keys multiply)
  and drops the oldest first. To push a blocked pair out, an attacker needs about 20,000 fresh pairs inside the window.
- Held in memory: **restarting the API clears every count.** One API process is assumed, which is how KinShip is deployed;
  several processes would each count on their own.

### The client address
Per-address rules depend on `request.ip`, which is right only when `TRUST_PROXY` matches the reverse proxy (ADR 0004,
`.env.example`):
- **Too narrow** (a proxy on a public address that is not listed): every visitor has the proxy's address, so the address
  and pair limits cover everyone, like one big NAT: one attacker can block every sign-in for that email, or all sign-ins
  after 30 failures. Accounts still are never locked by the account limiter.
- **Too wide** (`true` with the web port reachable from the internet): an attacker picks any `X-Forwarded-For` and gets
  round the address and pair limits. Only the per-account slow-down and the argon2 cost remain.

### CPU
Every attempt that is not blocked costs one argon2id check (19 MiB, t=2, p=1) on libuv's pool of 4 threads, so at most 4
run at once. Per address it is bounded by the request cap and the address and pair limits; a delayed attempt is still
checked. There is no install-wide cap: many addresses can slow sign-in for everyone, but cannot block it. Not changed here.

### Ready for the TOTP code step (step 55, ADR 0043)
A 6-digit code has a million values; with the ±1 time step three are valid at once. Once an attacker has the password,
only the code stands between them and the account, so "slow down, never block" is wrong there: a delay does not cap
parallel guesses. The code step gets **its own route and its own limiters**, all blocking:
- **pair** (address + account): **5 failures in 15 minutes**;
- **account: 10 failures in 1 hour, blocking**, the code step only, never the password step.

At most 240 guesses a day per account: about a 0.07 % chance a day, about 2 % over a month, for an attacker who already
has the password (and the owner is told nothing until email notifications exist; that is step 55's to weigh). The cost:
an attacker with the password can block the owner's code step for an hour. Recovery codes count against the same
limiters. Step 55 only adds configuration: the limiter class and `GuardSet` already support it.

## Consequences

- #227 is fixed: failures from other addresses can slow the owner down by at most 10 s, never refuse them.
- An attacker behind the owner's own address (or a misconfigured proxy) can still lock the owner out for 15 minutes.
- The per-account delay holds a connection open for up to 10 s; nginx allows 60 s on `/api`, and the sign-in form
  keeps its button disabled ("Signing in…") until the answer comes.
- The error codes, messages and the e2e run (6 sign-ins, one address, all correct) do not change.
- No `UPGRADE.md` entry: no migration and nothing an admin has to do.
