#!/usr/bin/env bash
# Install Sayabot for Mac without a browser download.
# curl does not mark the app as "downloaded from the internet", so macOS opens it
# directly. A DMG saved by Chrome or Safari still shows "Apple could not verify".
#
#   curl -fsSL https://<your-server>/install-mac.sh | bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) dmg_name="Sayabot-arm64.dmg" ;;
  x86_64) dmg_name="Sayabot-x64.dmg" ;;
  *)
    echo "This Mac architecture is not supported: $(uname -m)" >&2
    exit 1
    ;;
esac

url="https://github.com/anurag3407/sayabot/releases/latest/download/${dmg_name}"
workdir="$(mktemp -d)"
mount=""

cleanup() {
  if [[ -n "$mount" ]]; then
    hdiutil detach "$mount" -quiet >/dev/null 2>&1 || true
  fi
  rm -rf "$workdir"
}
trap cleanup EXIT

echo "Downloading Sayabot…"
curl -fL --retry 3 --retry-delay 2 -o "$workdir/Sayabot.dmg" "$url"

attach="$(hdiutil attach "$workdir/Sayabot.dmg" -nobrowse -readonly)"
mount="$(printf '%s\n' "$attach" | awk '/\/Volumes\// { print substr($0, index($0, "/Volumes/")); exit }')"
src="$(find "$mount" -maxdepth 2 -name 'Sayabot.app' -print -quit)"
if [[ -z "$src" || -z "$mount" ]]; then
  echo "The download did not contain Sayabot.app." >&2
  exit 1
fi

osascript -e 'tell application "Sayabot" to quit' >/dev/null 2>&1 || true
sleep 0.4

dest="/Applications/Sayabot.app"
rm -rf "$dest"
cp -R "$src" "$dest"
# Harmless when curl already left the file unmarked. Clears the flag if a browser copy is replaced.
xattr -dr com.apple.quarantine "$dest" >/dev/null 2>&1 || true

echo "Opening Sayabot."
open "$dest"
