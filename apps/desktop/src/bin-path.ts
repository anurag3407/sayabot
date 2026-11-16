import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process"
import { readdirSync } from "node:fs"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, extname, join } from "node:path"

/**
 * Where agent apps live, and the PATH they run with. Sayabot opened from the Dock gets a bare
 * PATH, and many apps (pi, Gemini CLI, Copilot) are Node scripts whose `#!/usr/bin/env node`
 * needs the `node` that nvm, volta or fnm installed, so every app starts with those folders too.
 */

const UNIX_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  join(homedir(), ".local/bin"),
  join(homedir(), ".bun/bin"),
  join(homedir(), ".npm-global/bin"),
  join(homedir(), ".claude/local"),
]

/** npm, Scoop, WinGet, Chocolatey, and the per-user bin folders a packaged app does not inherit. */
function windowsBinDirs(): string[] {
  const home = homedir()
  const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local")
  const roaming = process.env.APPDATA || join(home, "AppData", "Roaming")
  return [
    join(roaming, "npm"),
    join(local, "pnpm"),
    join(home, "scoop", "shims"),
    join(local, "Microsoft", "WinGet", "Links"),
    join("C:\\ProgramData", "chocolatey", "bin"),
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".claude", "local"),
    process.env.NVM_SYMLINK || "",
    process.env.NVM_HOME || "",
  ].filter(Boolean)
}

/** nvm (newest first), volta and fnm. On Windows, Volta plus the nvm-windows symlink. */
function versionManagerBins(): string[] {
  const out: string[] = [join(homedir(), ".volta/bin")]
  if (process.platform === "win32") {
    if (process.env.NVM_SYMLINK) out.push(process.env.NVM_SYMLINK)
    return out
  }
  out.push(join(homedir(), ".fnm/aliases/default/bin"))
  try {
    const base = join(homedir(), ".nvm/versions/node")
    const versions = readdirSync(base).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }),
    )
    for (const v of versions) out.push(join(base, v, "bin"))
  } catch {
    // no nvm
  }
  return out
}

function searchDirs(): string[] {
  return [
    ...new Set([
      ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
      ...(process.platform === "win32" ? windowsBinDirs() : UNIX_BIN_DIRS),
      ...versionManagerBins(),
    ]),
  ]
}

/** PATHEXT order: a real .exe wins over an npm .cmd shim of the same name. */
export function binaryNames(name: string): string[] {
  if (process.platform !== "win32" || extname(name)) return [name]
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
  return [name, ...exts.map((ext) => name + ext.toLowerCase())]
}

export async function findBinary(name: string): Promise<string | null> {
  const names = binaryNames(name)
  for (const dir of searchDirs()) {
    for (const fileName of names) {
      const candidate = join(dir, fileName)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // keep looking
      }
    }
  }
  return null
}

/**
 * Quote one argument for `cmd.exe /c`. Empty strings and values with spaces or quotes are wrapped.
 * Used only for Windows `.cmd` / `.bat` shims; native executables are spawned directly.
 */
export function quoteForCmd(value: string): string {
  if (value.length === 0) return '""'
  if (!/[\t\n\r "]/u.test(value)) return value
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * Spawn a CLI. On Windows, npm and pnpm shims are `.cmd` files, and `spawn(file.cmd)` fails with
 * EINVAL. Those go through `cmd.exe /c` with a quoted command line. `.exe` files spawn directly.
 */
export function spawnTool(
  file: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    const command = [quoteForCmd(file), ...args.map((arg) => quoteForCmd(arg))].join(" ")
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
      ...options,
      windowsVerbatimArguments: true,
      windowsHide: true,
    })
  }
  return spawn(file, [...args], options)
}

/** The PATH to start `binary` with: its own folder first, then everywhere apps and `node` live. */
export function toolPath(binary: string): string {
  return [...new Set([dirname(binary), ...searchDirs()])].join(delimiter)
}
