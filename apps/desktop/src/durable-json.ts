import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Reads a JSON file, and if that write was torn, the previous good copy beside it.
 * A hard quit during an update must not look like "there is no login".
 */
export function readJsonFile<T>(filePath: string): T | null {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue
      return JSON.parse(fs.readFileSync(candidate, "utf-8")) as T
    } catch {
      // Try the backup.
    }
  }
  return null
}

/** Writes JSON by temp file, fsync, and rename, and keeps the previous file as `.bak`. */
export function writeJsonAtomic(filePath: string, value: unknown, mode = 0o600): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`)
  const fd = fs.openSync(tmp, "w", mode)
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), "utf-8")
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, `${filePath}.bak`)
    } catch {
      // The new file still replaces the old one.
    }
  }
  fs.renameSync(tmp, filePath)
}

/** Removes a JSON file and the backup kept beside it. */
export function removeJsonFile(filePath: string): void {
  for (const candidate of [filePath, `${filePath}.bak`]) {
    if (fs.existsSync(candidate)) fs.unlinkSync(candidate)
  }
}
