# SPDX-License-Identifier: AGPL-3.0-or-later
#
# KinShip web image: the built UI served by unprivileged nginx. Build from the
# repository root:
#   docker build -f apps/web/Dockerfile --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) .
# Targets: "dev" (Vite dev server, used by compose.dev.yml) and the default, "runtime".

# ---- base: Node plus the pinned pnpm (Node 26 images do not bundle corepack) ----
FROM node:26-alpine AS base
RUN npm install -g corepack@0.34.6 && corepack enable
WORKDIR /app

# ---- deps: every dependency, from the lockfile only ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @kinship/web...

# ---- dev: source is bind-mounted by compose.dev.yml; Vite reloads the browser ----
FROM deps AS dev
COPY apps/web apps/web
COPY packages/shared packages/shared
# Vite writes a temporary file next to its config and a cache in node_modules.
RUN chown -R node:node /app/apps/web
WORKDIR /app/apps/web
USER node
EXPOSE 5173
CMD ["node_modules/.bin/vite", "--host", "0.0.0.0", "--port", "5173"]

# ---- build: static files ----
FROM deps AS build
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @kinship/web build

# ---- runtime: unprivileged nginx (uid 101), stable branch ----
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
LABEL org.opencontainers.image.title="kinship-web" \
      org.opencontainers.image.source="https://github.com/officialJCReyes/kinship" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
