#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "  Sayabot macOS Daemon & Local Host Auto-Updater  "
echo "=================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$REPO_ROOT"

echo "==> Fetching latest changes from origin/main..."
git fetch origin main

CURRENT_HASH="$(git rev-parse HEAD)"
UPSTREAM_HASH="$(git rev-parse origin/main)"

if [ "$CURRENT_HASH" = "$UPSTREAM_HASH" ]; then
  echo "==> Already up to date at commit $CURRENT_HASH"
  exit 0
fi

echo "==> New commits detected. Updating: $CURRENT_HASH -> $UPSTREAM_HASH"
git pull origin main

echo "==> Installing workspace dependencies..."
pnpm install --frozen-lockfile=false

echo "==> Typechecking computerd..."
pnpm --filter @sayabot/computerd typecheck

echo "==> Update completed successfully!"
