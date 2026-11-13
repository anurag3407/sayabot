# syntax=docker/dockerfile:1.7
# Sayabot computer daemon (container lifecycle, gVisor integration, exec, files).
# Build context: repository root.

ARG NODE_VERSION=24.21.0
ARG PNPM_VERSION=10.33.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

FROM base AS install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/computerd ./apps/computerd
RUN pnpm install --filter "@sayabot/computerd..." --filter "@sayabot/core"
# Bundled agentd, uploaded into cloud (E2B) computers on first boot.
RUN pnpm --filter @sayabot/computerd build:agentd

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG GIT_COMMIT_SHA=unknown
ENV NODE_ENV=production \
    PORT=4100 \
    GIT_COMMIT_SHA=$GIT_COMMIT_SHA
WORKDIR /app
COPY --from=install /repo ./

USER node
WORKDIR /app/apps/computerd
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--import", "tsx", "src/index.ts"]
