# SPDX-License-Identifier: AGPL-3.0-or-later
#
# KinShip web image: the built UI served by unprivileged nginx. Build from the
# repository root:
#   docker build -f apps/web/Dockerfile \
#     --build-arg VERSION=<version> --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
#     --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) .
# The three build arguments are stamped into the image (the web version comes from package.json).
# Targets: "dev" (Vite dev server, used by compose.dev.yml) and the default, "runtime".

# ---- base: Node plus the pinned pnpm (Node 26 images do not bundle corepack) ----
# The built files are plain HTML, CSS and JavaScript, the same for every architecture, so
# install and build run on the machine doing the build; only the final nginx stage is per-arch.
FROM --platform=$BUILDPLATFORM node:26-alpine AS base
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
ARG BUILD_DATE=unknown
ENV GIT_COMMIT=${GIT_COMMIT} \
    BUILD_DATE=${BUILD_DATE}
COPY apps/web apps/web
COPY packages/shared packages/shared
RUN pnpm --filter @kinship/web build

# ---- runtime: unprivileged nginx (uid 101), stable branch ----
FROM nginxinc/nginx-unprivileged:1.30.6-alpine AS runtime
ARG VERSION=unknown
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="kinship-web" \
      org.opencontainers.image.source="https://github.com/officialJCReyes/kinship" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"
# Apply Alpine's security updates for the packages in the base image (a pinned nginx tag is only
# rebuilt now and then). The image runs as the unprivileged user again straight after.
USER root
RUN apk upgrade --no-cache
USER 101
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
