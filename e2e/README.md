# End-to-end tests

Playwright (Chromium) against the real stack: the shipped `compose.yml` and `.env.example` with throwaway passwords, on port 18090 (`E2E_PORT` changes it). Everything runs in a fresh database that is removed afterwards.

```sh
pnpm install
pnpm --filter @kinship/e2e exec playwright install chromium   # once
pnpm --filter @kinship/e2e e2e                                # builds the :e2e images if they are missing
```

Needs Docker. Rebuild the images after changing the api or the web app: `pnpm --filter @kinship/e2e e2e:build-images`.

- `tests/01-first-run.spec.ts` uses the one-time setup token from the api log, like a real first run; every other file waits for it.
- Each test makes its own people (random surname), so tests do not depend on each other. `03-relatives` and `05-roles` are one story each and run in order.
- Members and Users cannot be invited through the app yet (0.2), so `support/stack.ts` has a clearly marked **test-only** helper that inserts them into the database as the owner role.
- Only fictional, Hale-style data. Nothing here is a secret: passwords are made fresh for every run.
- On a failed CI run the traces, screenshots and the web, api and db logs are uploaded as the `e2e-failure` artifact.

- `screenshots/` is not a test: `pnpm --filter @kinship/e2e screenshots` rebuilds the README pictures (see [docs/assets/README.md](../docs/assets/README.md)). CI never runs it.
