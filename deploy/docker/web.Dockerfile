# syntax=docker/dockerfile:1.7
# Sayabot web (Next.js). Build context: repository root.
#   docker build -f deploy/docker/web.Dockerfile -t sayabot/web .

ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ── 1. Fetch dependencies from the lockfile only (cached until it changes) ──
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile

# ── 2. Build ──
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_COLLAB_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ARG NEXT_PUBLIC_GITHUB_AUTH_ENABLED=false
ARG NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
ARG NEXT_PUBLIC_SSO_ENABLED=false
ARG NEXT_PUBLIC_SAYABOT_EDITION=self-hosted
ARG GIT_COMMIT_SHA=unknown
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_COLLAB_URL=$NEXT_PUBLIC_COLLAB_URL \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_GITHUB_AUTH_ENABLED=$NEXT_PUBLIC_GITHUB_AUTH_ENABLED \
    NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=$NEXT_PUBLIC_GOOGLE_AUTH_ENABLED \
    NEXT_PUBLIC_SAYABOT_EDITION=$NEXT_PUBLIC_SAYABOT_EDITION \
    NEXT_PUBLIC_SSO_ENABLED=$NEXT_PUBLIC_SSO_ENABLED \
    GIT_COMMIT_SHA=$GIT_COMMIT_SHA \
    NEXT_OUTPUT=standalone \
    NODE_ENV=production

# Call next directly: the package "build" script expects a repo-root .env file.
RUN cd apps/web && pnpm exec next build --webpack

# ── 3. Runtime: only the standalone server, static assets and public files ──
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG GIT_COMMIT_SHA=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    GIT_COMMIT_SHA=$GIT_COMMIT_SHA
WORKDIR /app

COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next/cache

LABEL org.opencontainers.image.title="sayabot-web" \
      org.opencontainers.image.revision=$GIT_COMMIT_SHA

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
