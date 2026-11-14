import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/** Quote a path for a bash single-quoted string. */
export function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Replaces /Applications/Sayabot.app after this process exits.
 * The DMG is downloaded by the app (curl), so macOS does not treat the new copy as a
 * browser download and does not show "Apple could not verify".
 */
export function macUpdateInstallScript(opts: { dmgPath: string; pid: number }): string {
  const dmg = bashSingleQuote(opts.dmgPath)
  return `#!/bin/bash
set -euo pipefail
DMG=${dmg}
PID=${opts.pid}
while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
ATTACH=$(hdiutil attach "$DMG" -nobrowse -readonly)
MOUNT=$(printf '%s\\n' "$ATTACH" | awk '/\\/Volumes\\// { print substr($0, index($0, "/Volumes/")); exit }')
SRC=$(find "$MOUNT" -maxdepth 2 -name 'Sayabot.app' -print -quit)
rm -rf /Applications/Sayabot.app
cp -R "$SRC" /Applications/Sayabot.app
xattr -dr com.apple.quarantine /Applications/Sayabot.app >/dev/null 2>&1 || true
hdiutil detach "$MOUNT" -quiet || true
open /Applications/Sayabot.app
`
}

export function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      ["-fL", "--retry", "3", "--retry-delay", "2", "-o", dest, url],
      { stdio: "ignore" },
    )
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Download failed (curl exit ${code ?? "unknown"})`))
    })
  })
}

/** Writes the helper and returns its path. The caller starts it, then exits. */
export function stageMacUpdate(dmgPath: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-update-"))
  const scriptPath = path.join(dir, "install.sh")
  fs.writeFileSync(scriptPath, macUpdateInstallScript({ dmgPath, pid: process.pid }), {
    mode: 0o755,
  })
  return scriptPath
}

export function runDetached(scriptPath: string): void {
  spawn("bash", [scriptPath], { detached: true, stdio: "ignore" }).unref()
}
