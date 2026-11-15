# apps/api

The TypeScript API (Fastify, Kysely on `pg`), the numbered SQL migrations in `migrations/` and, later, the background jobs.

## Run it for development

From the repository root:

```sh
docker compose -f compose.dev.yml up --build    # db (Postgres 18) and api, restarts when you save
curl localhost:3000/api/health
curl localhost:3000/api/version
```

## Tests

The tests use a real Postgres. Start the dev database, then run:

```sh
docker compose -f compose.dev.yml up -d db
pnpm test            # from the repository root
```

Each test file creates its own throwaway database and app role, and drops them afterwards.

## Database roles

- **Owner role** (`DB_OWNER_USER`): runs migrations at startup, and nothing else.
- **App role** (`DB_APP_USER`): serves every request. It cannot create objects, does not bypass row-level security, and only gets access to tables the owner creates after migration 0001. The API creates it (or refreshes its password) on each start, because its password is a secret and cannot live in a `.sql` file.

## Migrations

Numbered files like `migrations/0002_people.sql`, forward-only. Never edit one that has been applied: the runner stores each file's SHA-256 and refuses to start if an applied file changed. See [ADR 0001](../../docs/decisions/0001-stack.md).
