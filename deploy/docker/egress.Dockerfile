# syntax=docker/dockerfile:1.7
# Sayabot Egress MITM HTTP(S) proxy and secret broker swap service.
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
COPY patches ./patches
COPY packages ./packages
COPY apps/egress ./apps/egress
RUN pnpm install --filter "@sayabot/egress..." --filter "@sayabot/core"

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG GIT_COMMIT_SHA=unknown
ENV NODE_ENV=production \
    PROXY_PORT=8080 \
    ADMIN_PORT=8081 \
    GIT_COMMIT_SHA=$GIT_COMMIT_SHA
WORKDIR /app
COPY --from=install /repo ./

USER node
WORKDIR /app/apps/egress
EXPOSE 8080 8081
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--import", "tsx", "src/index.ts"]
