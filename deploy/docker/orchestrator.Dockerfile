# syntax=docker/dockerfile:1.7
# Sayabot orchestrator (Hono + pg-boss + Hocuspocus). Also runs migrations and seeds.
# Build context: repository root.
#   docker build -f deploy/docker/orchestrator.Dockerfile -t sayabot/orchestrator .

ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile --prod

# The orchestrator runs its TypeScript through tsx (a runtime dependency), so there is
# no compile step: install production deps for it and the workspace packages it uses.
FROM deps AS install
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/orchestrator ./apps/orchestrator
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --prod \
      --filter "@sayabot/orchestrator..." --filter "@sayabot/db" \
 && find apps packages -name "*.test.ts" -not -path "*/node_modules/*" -delete

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG GIT_COMMIT_SHA=unknown
ENV NODE_ENV=production \
    PORT=4000 \
    GIT_COMMIT_SHA=$GIT_COMMIT_SHA
WORKDIR /app
COPY --from=install --chown=node:node /repo ./

LABEL org.opencontainers.image.title="sayabot-orchestrator" \
      org.opencontainers.image.revision=$GIT_COMMIT_SHA

USER node
WORKDIR /app/apps/orchestrator
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Single node process (no wrapper) so SIGTERM reaches the graceful shutdown handler.
CMD ["node", "--import", "tsx", "src/index.ts"]
