import { execFile, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { NotPublishedError } from "./updater"

/** Quote a path for a bash single-quoted string. */
export function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

const FALLBACK_TARGET = "/Applications/Sayabot.app"

/**
 * Where the running app lives, so the update replaces that copy. Runs from a disk image or from
 * macOS's App Translocation (a quarantined app opened in place) install to /Applications instead.
 */
export function installTarget(exePath: string): string {
  const marker = exePath.indexOf(".app/Contents/MacOS/")
  if (marker === -1) return FALLBACK_TARGET
  const bundle = exePath.slice(0, marker + 4)
  if (bundle.startsWith("/Volumes/") || bundle.includes("/AppTranslocation/"))
    return FALLBACK_TARGET
  return bundle
}

/** Whether this user may replace `target` (its folder must be writable, and the app itself). */
export function canReplace(target: string): boolean {
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
    if (fs.existsSync(target)) fs.accessSync(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Replaces the app after this process exits. It copies the new app next to the old one, swaps
 * them, and puts the old one back if any step fails, so a failed update never leaves you without
 * Sayabot. Everything it does goes to ~/Library/Logs/Sayabot/update.log.
 */
export function macUpdateInstallScript(opts: {
  dmgPath: string
  pid: number
  target: string
  version: string
}): string {
  const q = bashSingleQuote
  return `#!/bin/bash
set -uo pipefail
DMG=${q(opts.dmgPath)}
TARGET=${q(opts.target)}
EXPECTED=${q(opts.version)}
PID=${opts.pid}
LOG="$HOME/Library/Logs/Sayabot/update.log"
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "[$(date)] installing Sayabot $EXPECTED into $TARGET"
MOUNT=""
fail() {
  echo "update failed: $1"
  if [ -n "$MOUNT" ]; then hdiutil detach "$MOUNT" -quiet || true; fi
  rm -rf "$TARGET.new"
  if [ ! -d "$TARGET" ] && [ -d "$TARGET.old" ]; then mv "$TARGET.old" "$TARGET"; fi
  if [ -d "$TARGET" ]; then open "$TARGET"; fi
  exit 1
}
for _ in $(seq 1 300); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$PID" 2>/dev/null; then fail "Sayabot did not quit"; fi
ATTACH=$(hdiutil attach "$DMG" -nobrowse -readonly -noautoopen) || fail "could not open the disk image"
MOUNT=$(printf '%s\\n' "$ATTACH" | awk '/\\/Volumes\\// { print substr($0, index($0, "/Volumes/")); exit }')
SRC=$(find "$MOUNT" -maxdepth 2 -name 'Sayabot.app' -print -quit)
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then fail "no Sayabot.app in the disk image"; fi
GOT=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SRC/Contents/Info.plist" 2>/dev/null || true)
if [ "$GOT" != "$EXPECTED" ]; then fail "the disk image has version '$GOT', expected $EXPECTED"; fi
rm -rf "$TARGET.new" "$TARGET.old"
ditto "$SRC" "$TARGET.new" || fail "could not copy the new app"
if [ -d "$TARGET" ]; then mv "$TARGET" "$TARGET.old" || fail "could not move the old app aside"; fi
mv "$TARGET.new" "$TARGET" || fail "could not put the new app in place"
rm -rf "$TARGET.old"
xattr -dr com.apple.quarantine "$TARGET" >/dev/null 2>&1 || true
hdiutil detach "$MOUNT" -quiet || true
rm -f "$DMG"
echo "[$(date)] installed Sayabot $EXPECTED"
open "$TARGET"
`
}

/** Downloads with progress (0-100, or null when the size is unknown). 404 means not published yet. */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number | null) => void = () => {},
): Promise<void> {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20 * 60_000) })
  if (res.status === 404) throw new NotPublishedError(url)
  if (!res.ok || !res.body) throw new Error(`The download failed (HTTP ${res.status}).`)
  const total = Number(res.headers.get("content-length")) || 0
  let received = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length
      onProgress(total ? Math.min(100, (received / total) * 100) : null)
      done(null, chunk)
    },
  })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(res.body as never), counter, fs.createWriteStream(dest))
  if (total && received !== total) throw new Error("The download was cut short. Try again.")
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(file, args, { timeout: 60_000 }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    ),
  )
}

/** Opens the DMG just long enough to read the version of the Sayabot.app inside. */
export async function inspectDmg(dmgPath: string): Promise<string | null> {
  let mount: string | null = null
  try {
    const attached = await run("hdiutil", [
      "attach",
      dmgPath,
      "-nobrowse",
      "-readonly",
      "-noautoopen",
    ])
    const line = attached.split("\n").find((row) => row.includes("/Volumes/"))
    mount = line ? line.slice(line.indexOf("/Volumes/")).trim() : null
    if (!mount) return null
    const candidates = [
      path.join(mount, "Sayabot.app"),
      ...fs.readdirSync(mount).map((name) => path.join(mount!, name, "Sayabot.app")),
    ]
    const app = candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, "Contents", "Info.plist")),
    )
    if (!app) return null
    const version = await run("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleShortVersionString",
      path.join(app, "Contents", "Info.plist"),
    ])
    return version.trim() || null
  } catch {
    return null
  } finally {
    if (mount) await run("hdiutil", ["detach", mount, "-quiet"]).catch(() => undefined)
  }
}

/** Writes the helper and returns its path. The caller starts it, then quits. */
export function stageMacUpdate(opts: { dmgPath: string; target: string; version: string }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-update-"))
  const scriptPath = path.join(dir, "install.sh")
  fs.writeFileSync(scriptPath, macUpdateInstallScript({ ...opts, pid: process.pid }), {
    mode: 0o755,
  })
  return scriptPath
}

export function runDetached(scriptPath: string): void {
  spawn("bash", [scriptPath], { detached: true, stdio: "ignore" }).unref()
}
