import { readdirSync } from "node:fs"
import { access, constants } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"

/**
 * Where agent apps live, and the PATH they run with. Sayabot opened from the Dock gets a bare
 * PATH, and many apps (pi, Gemini CLI, Copilot) are Node scripts whose `#!/usr/bin/env node`
 * needs the `node` that nvm, volta or fnm installed, so every app starts with those folders too.
 */

const BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  join(homedir(), ".local/bin"),
  join(homedir(), ".bun/bin"),
  join(homedir(), ".npm-global/bin"),
  join(homedir(), ".claude/local"),
]

/** nvm (newest first), volta and fnm. */
function versionManagerBins(): string[] {
  const out: string[] = [join(homedir(), ".volta/bin"), join(homedir(), ".fnm/aliases/default/bin")]
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
      ...BIN_DIRS,
      ...versionManagerBins(),
    ]),
  ]
}

export async function findBinary(name: string): Promise<string | null> {
  for (const dir of searchDirs()) {
    const candidate = join(dir, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

/** The PATH to start `binary` with: its own folder first, then everywhere apps and `node` live. */
export function toolPath(binary: string): string {
  return [...new Set([dirname(binary), ...searchDirs()])].join(delimiter)
}
