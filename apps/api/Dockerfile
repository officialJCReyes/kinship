# SPDX-License-Identifier: AGPL-3.0-or-later
#
# KinShip API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile \
#     --build-arg VERSION=<version> --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
#     --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) .
# The three build arguments are stamped into the image (shown by /api/version and the About page).
# Targets: "dev" (hot reload, used by compose.dev.yml) and the default, "runtime".

# ---- base: Node plus the pinned pnpm (Node 26 images do not bundle corepack) ----
# Everything up to the compiled JavaScript runs on the machine doing the build, whatever the
# target architecture, so a multi-arch build does not emulate the whole install and compile.
FROM --platform=$BUILDPLATFORM node:26-alpine AS base
RUN npm install -g corepack@0.34.6 && corepack enable
WORKDIR /app

# ---- deps: every dependency, from the lockfile only ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @kinship/api...

# ---- dev: source is bind-mounted by compose.dev.yml; tsx restarts on change ----
FROM deps AS dev
COPY packages/shared packages/shared
COPY apps/api apps/api
# The API imports the shared package as compiled JavaScript.
RUN pnpm --filter @kinship/shared build
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "watch", "src/main.ts"]

# ---- build: TypeScript to JavaScript ----
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
# Builds the shared package first (the api's build script does), then the api.
RUN pnpm --filter @kinship/api build

# ---- prod-deps: production dependencies only, for the TARGET architecture ----
# The argon2 library ships a native binary per architecture, so this is the one stage that
# installs for the platform being built (emulated when it differs from the build machine).
FROM node:26-alpine AS prod-deps
RUN npm install -g corepack@0.34.6 && corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @kinship/api...

# ---- runtime ----
FROM node:26-alpine AS runtime
ARG VERSION=unknown
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="kinship-api" \
      org.opencontainers.image.source="https://github.com/officialJCReyes/kinship" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"
ENV NODE_ENV=production \
    GIT_COMMIT=${GIT_COMMIT} \
    BUILD_DATE=${BUILD_DATE}
WORKDIR /app/apps/api
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./node_modules
# The shared package, linked by the workspace as apps/api/node_modules/@kinship/shared.
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
COPY apps/api/package.json ./
# The owner's command line: docker compose exec -it api kinship set-password <email>
RUN printf '#!/bin/sh\nexec node /app/apps/api/dist/cli.js "$@"\n' > /usr/local/bin/kinship && chmod +x /usr/local/bin/kinship
# Nothing in this image runs npm. Removing it also removes the libraries it bundles (and any
# vulnerabilities reported in them), and a tool an attacker could use.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# The PostgreSQL command-line tools for built-in backups (pg_dump, pg_restore, psql; about 6 MB). The major version must be
# the same as the database image's or newer. They run as separate programs under the PostgreSQL License (ADR 0014); the
# image's busybox tar packs the archive.
RUN apk add --no-cache postgresql18-client
# The backups folder (compose.yml mounts ./data/backups here) and the stand-alone decrypt script for disaster recovery.
RUN mkdir -p /var/lib/kinship/backups && chown node:node /var/lib/kinship/backups && chmod 700 /var/lib/kinship/backups
COPY docs/backup/kinship-decrypt.mjs /usr/local/share/kinship/kinship-decrypt.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
