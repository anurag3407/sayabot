import { app } from "electron"
import { readdir, stat } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

/**
 * What Sayabot takes up on this computer: the app's own data and each local-runner agent's
 * working folder (~/Sayabot/agents/<handle>). Walks are capped so a huge folder can't stall
 * the app; a capped size is marked approximate.
 */

const MAX_ENTRIES = 200_000

async function folderSize(root: string): Promise<{ bytes: number; files: number; approximate: boolean }> {
  let bytes = 0
  let files = 0
  let seen = 0
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) return { bytes, files, approximate: true }
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try {
          bytes += (await stat(full)).size
          files += 1
        } catch {
          // vanished while walking
        }
      }
    }
  }
  return { bytes, files, approximate: false }
}

export interface LocalStorageReport {
  measuredAt: string
  appData: { bytes: number; approximate: boolean }
  agents: Array<{ handle: string; bytes: number; files: number; approximate: boolean }>
}

export async function measureLocalStorage(): Promise<LocalStorageReport> {
  const appData = await folderSize(app.getPath("userData"))
  const agentsRoot = path.join(os.homedir(), "Sayabot", "agents")
  let handles: string[] = []
  try {
    handles = (await readdir(agentsRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).slice(0, 100)
  } catch {
    // no local runner folders yet
  }
  const agents = await Promise.all(
    handles.map(async (handle) => ({ handle, ...(await folderSize(path.join(agentsRoot, handle))) })),
  )
  return {
    measuredAt: new Date().toISOString(),
    appData: { bytes: appData.bytes, approximate: appData.approximate },
    agents: agents.sort((a, b) => b.bytes - a.bytes),
  }
}
