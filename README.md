# KinShip

Self-hosted family tree for families: relationships, sources, photos, private health history and DNA results. Runs with Docker Compose (PostgreSQL, a TypeScript API, a React UI behind nginx). Licensed under AGPL-3.0-or-later.

> **Status: pre-alpha, not usable yet.** Nothing here runs so far. Release 0.1 ("It runs") is being built first; until a release is published there is nothing to install, and no real family data should ever be entered.

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
