# 0002. Web app

- Status: **Accepted** (router and data layer confirmed by JC, 2026-11-15; the rest follow from ADR 0001 and CLAUDE.md)
- Date: 2026-11-15
- Builds on: [0001 Stack](0001-stack.md)

## Decisions

| Concern | Choice | Notes |
|---|---|---|
| Routing | **React Router** (library mode, `react-router` package) | Nested routes fit the header tab then sub-tab navigation, and route-level sign-in guards. TanStack Router was the alternative. |
| Server state | **TanStack Query** over plain `fetch` | Loading, error and cache states for API calls. Types come from `packages/shared`. |
| Shared code | **`packages/shared`** (`@kinship/shared`): API response types and the English messages | Consumed as TypeScript source by the web app. The API does not import it yet (see below). |
| Translations | Own tiny `createTranslator` over `Record<MessageKey, string>`; keys are typed, so a missing key is a compile error | No i18n library until a second language needs plural rules or locale loading. |
| Styling | Plain CSS with the mockup's design tokens (Forest scheme, light and dark following the device) | The other three schemes and the per-person theme come with My settings (0.2). |
| Fonts | **System fonts only** | The mockup loads Fraunces and IBM Plex from Google Fonts, which would make every visit contact a third party. Self-hosting needs font packages licensed OFL-1.1, which is not on the dependency license allow list. Revisit with JC. |
| Web server | `nginxinc/nginx-unprivileged:1.30-alpine` (nginx stable branch), port 8080, non-root | `/api/` is proxied to `api:3000` with a per-request Docker DNS lookup, so nginx starts without the api and follows it when it restarts. Connect and DNS timeouts are short so a stopped api fails fast. |
| Browser security | Server-level headers: CSP (`default-src 'self'`, no inline script or style), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`. HSTS is left to the reverse proxy that terminates TLS. | `add_header` is set at server level only, because one inside a `location` would drop the others. |
| Tests | Vitest, jsdom and Testing Library; no jest-dom | Plus a smoke test of the built nginx image in CI. |

## Deferred: web fonts

The approved mockup uses Fraunces (headings) and IBM Plex Sans and Mono. They are **deferred**; the skeleton uses system fonts so the app never contacts a third party. Plan, to be done in a later step:

1. Self-host the fonts from the npm packages (`@fontsource-variable/fraunces`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`) so they are served by our own nginx, with the CSP still `default-src 'self'` and no request to Google.
2. These packages are licensed **OFL-1.1**, which is not on the license allow list. Add a **scoped exception** to `scripts/check-licenses.mjs`, in the same style as the `caniuse-lite` one: only those exact packages, only the license `OFL-1.1`, and the OFL text and font copyright notices are kept with the shipped files.
3. Check the font files' size and load only the weights the mockup uses.

## Consequences and known gaps

- The API's `/api/version` and `/api/health` response shapes are declared twice (in `apps/api` and in `packages/shared`), because `tsc` for the API cannot include TypeScript source from outside its `rootDir`. Drift is possible until the API builds `packages/shared` as a compiled package, or a contract test is added.
- The About page does not show the database schema number (the mockup does), because `/api/version` does not return it. That is an API change for a later step.
- The "api refuses to start if web has a different version" check from the release plan is not built yet.
- Not verified here: hot module reload in a browser through the Docker bind mount.

## Licenses (checked 2026-11-15 by `pnpm licenses:check`)

With the web app the check covers **288 packages: PASS, 0 rejected.** 70 are production dependencies (62 MIT, 4 BSD-3-Clause, 4 ISC), including React 19.3.1, React DOM, React Router 8.5.1 and TanStack Query 5.107.1 (all MIT; they are bundled into the static site). 218 are development tools. This supersedes the 201-package snapshot in ADR 0001, which predates the web app.

One **named exception**, decided by JC: `caniuse-lite` (CC-BY-4.0, browser-support data). It is development-only, pulled in by `eslint-plugin-react-hooks` through Babel and browserslist, and is not in the built site. The exception in `scripts/check-licenses.mjs` matches only that package, that license and the development scope, so it stops applying (and the check fails) if the package ever becomes a production dependency or its license changes.
