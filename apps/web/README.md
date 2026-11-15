# apps/web

The React UI (Vite, TypeScript) and the nginx configuration for the `web` container.

Today it is a skeleton: a layout, light and dark theme following the device, an About page (versions, license, source link, API status) and a not-found page. Sign-in and the tree come next.

## Run it for development

From the repository root:

```sh
docker compose -f compose.dev.yml up --build     # db, api and web with hot reload
open http://localhost:5173                       # the Vite dev server; it proxies /api to the api
```

Or run only the UI against an api on port 3000: `pnpm --filter @kinship/web dev`.

## Tests and checks

```sh
pnpm --filter @kinship/web test        # Vitest and Testing Library (jsdom), no database needed
pnpm typecheck && pnpm lint
```

## The production image

`apps/web/Dockerfile` builds the static files and serves them with unprivileged nginx (stable branch) on port 8080. `nginx/default.conf` serves the single-page app, proxies `/api/` to the `api` service, sets security headers and has a `/healthz` check. It speaks plain HTTP; your reverse proxy terminates TLS.

## Conventions

- Every UI string is a key in `packages/shared/src/messages/en.ts`, used as `t('key')`. Add a language by adding a file with the same keys.
- No third-party requests at runtime: system fonts only, no CDN.
- The Content-Security-Policy forbids inline scripts and inline styles, so use CSS classes, never `style` attributes.
