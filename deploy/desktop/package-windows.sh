#!/usr/bin/env bash
# Entry point for the Windows desktop build. The installer itself is produced on Windows
# (NSIS). From macOS or Linux this script tells you the command to run there.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
uname_s="$(uname -s 2>/dev/null || echo unknown)"
case "$uname_s" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$root/deploy/desktop/package-windows.ps1"
    ;;
  *)
    if command -v pwsh >/dev/null 2>&1 && [[ "${SAYABOT_FORCE_WIN_BUILD:-}" == "1" ]]; then
      pwsh "$root/deploy/desktop/package-windows.ps1"
      exit 0
    fi
    echo "Sayabot for Windows is packaged on Windows."
    echo "On a Windows machine, from the repo root:"
    echo "  pnpm desktop:package:win"
    echo "or:"
    echo "  pwsh deploy/desktop/package-windows.ps1"
    exit 1
    ;;
esac
