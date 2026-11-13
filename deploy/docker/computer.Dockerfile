# syntax=docker/dockerfile:1.7
# Sayabot bot computer container image (runs inside gVisor runsc).
# Standard profile: bash, git, python3, nodejs 24, ripgrep, jq, agentd.

# agentd is pre-bundled to plain JS so neither the daemon nor the docker-exec
# fallback CLI pays a TypeScript compile on start.
FROM node:24-bookworm-slim AS agentd-build
WORKDIR /build
COPY apps/computerd/agentd/ ./agentd/
RUN npm install --no-save --package-lock=false --no-audit --no-fund esbuild@0.28.2 \
  && npx esbuild agentd/agentd.ts agentd/agentd-cli.ts --bundle --platform=node --target=node24 \
     --format=esm --external:typescript --outdir=dist --out-extension:.js=.mjs

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    ripgrep \
    python3 \
    python3-pip \
    python3-venv \
    tini \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 and tsx
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g pnpm tsx \
  && rm -rf /var/lib/apt/lists/*

# Create bot user (uid 10001)
RUN groupadd -g 10001 bot \
  && useradd -u 10001 -g bot -m -s /bin/bash bot

# Create agentd directory and run dir
RUN mkdir -p /opt/agentd /run /home/bot/.saaya \
  && chown -R bot:bot /home/bot \
  && chown -R bot:bot /run \
  && chmod 1777 /run

# Bundled agentd + entrypoint. typescript stays external (code intelligence loads it).
COPY --from=agentd-build /build/dist/ /opt/agentd/
# Keep this compiler version aligned with apps/computerd/package.json.
RUN npm install --prefix /opt/agentd --no-save --package-lock=false --ignore-scripts --no-audit --no-fund typescript@5.9.3

COPY <<'EOF' /opt/agentd/agentd-cli
#!/bin/bash
exec node /opt/agentd/agentd-cli.mjs "$@"
EOF

RUN chmod +x /opt/agentd/agentd-cli && ln -sf /opt/agentd/agentd-cli /usr/local/bin/agentd-cli

COPY <<'EOF' /opt/agentd/entrypoint.sh
#!/bin/bash
set -e

# Update CA certs if mounted from egress
if [ -d /usr/local/share/ca-certificates/saaya ]; then
  update-ca-certificates --fresh > /dev/null 2>&1 || true
fi

# Ensure .bashrc sources .saaya/env
if ! grep -q ".saaya/env" /home/bot/.bashrc 2>/dev/null; then
  echo '[ -f "$HOME/.saaya/env" ] && source "$HOME/.saaya/env"' >> /home/bot/.bashrc
fi

# Start agentd (listens on /run/agentd.sock, plus $AGENTD_CTL_SOCK when computerd mounted one)
exec node /opt/agentd/agentd.mjs
EOF

RUN chmod +x /opt/agentd/entrypoint.sh

WORKDIR /home/bot
VOLUME ["/home/bot"]

ENTRYPOINT ["tini", "--", "/opt/agentd/entrypoint.sh"]
