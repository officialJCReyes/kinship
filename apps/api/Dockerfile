# SPDX-License-Identifier: AGPL-3.0-or-later
#
# KinShip API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) .
# Targets: "dev" (hot reload, used by compose.dev.yml) and the default, "runtime".

ARG NODE_IMAGE=node:26-alpine

# ---- base: Node plus the pinned pnpm (Node 26 images do not bundle corepack) ----
FROM ${NODE_IMAGE} AS base
RUN npm install -g corepack@0.34.6 && corepack enable
WORKDIR /app

# ---- deps: every dependency, from the lockfile only ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @kinship/api...

# ---- dev: source is bind-mounted by compose.dev.yml; tsx restarts on change ----
FROM deps AS dev
COPY apps/api apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "watch", "src/main.ts"]

# ---- build: TypeScript to JavaScript ----
FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @kinship/api build

# ---- prod-deps: production dependencies only ----
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @kinship/api...

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.title="kinship-api" \
      org.opencontainers.image.source="https://github.com/officialJCReyes/kinship" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV NODE_ENV=production \
    GIT_COMMIT=${GIT_COMMIT}
WORKDIR /app/apps/api
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
COPY apps/api/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
