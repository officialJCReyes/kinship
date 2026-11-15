# KinShip

Self-hosted family tree for families: relationships, sources, photos, private health history and DNA results. Runs with Docker Compose (PostgreSQL, a TypeScript API, a React UI behind nginx). Licensed under AGPL-3.0-or-later.

> **Status: pre-alpha, not usable yet.** The development stack runs (setup, sign-in, an About page), but there is no family tree yet and no published release or install guide. Release 0.1 ("It runs") is being built first. Do not enter real family data.

## First run

1. Start KinShip (for now, the development stack: `docker compose -f compose.dev.yml up --build`, then open <http://localhost:5173>).
2. A fresh install shows the **setup page**. It needs a **one-time setup token**, which the `api` container prints in its log when it starts with no accounts:

   ```sh
   docker compose -f compose.dev.yml logs api
   ```

   Look for the box that says "KinShip is not set up yet". If you restart before finishing, a new token is made. The token only works until the first account exists.
3. Enter the token, your name, email, a password of at least 12 characters, and a name for your tree. You become the SuperAdmin and are signed in. The setup page never appears again.

## Locked out? Set a new password

There is no email yet, so whoever runs the server can set a new password from the command line. It asks for the password twice (nothing is shown) and signs that account out everywhere:

```sh
docker compose exec -it api kinship set-password you@example.com
# in the development stack: docker compose -f compose.dev.yml exec -it api kinship set-password you@example.com
```

For scripts, pipe the password in instead: `printf '%s' "$NEW_PASSWORD" | docker compose exec -T api kinship set-password you@example.com --password-stdin`. The command exists only inside the container; it is not reachable over HTTP.

## Where to look

- [`design/`](design/) holds the approved UI mockup (`kinship-mockup.html`, with a fictional sample family) and the requirement docs. Start with [`design/kinship-v2-requirements.md`](design/kinship-v2-requirements.md).
- [`design/kinship-release-and-deployment-plan.md`](design/kinship-release-and-deployment-plan.md) says what ships in which version, how images are built and how upgrades work.
- [`docs/decisions/`](docs/decisions/) records the technical decisions (the stack is in [0001](docs/decisions/0001-stack.md)).

## Contributing and security

- [CONTRIBUTING.md](CONTRIBUTING.md): how to propose changes (Conventional Commits, DCO sign-off).
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [TRADEMARK.md](TRADEMARK.md).

## License

[AGPL-3.0-or-later](LICENSE). If you run a modified copy of KinShip as a network service, you must offer your users the source of your changes. The KinShip name and logo are not covered by this license; see [TRADEMARK.md](TRADEMARK.md).
