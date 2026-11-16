import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readJsonFile, removeJsonFile, writeJsonAtomic } from "./durable-json"

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-json-"))
  dirs.push(dir)
  return dir
}

describe("durable json", () => {
  it("reads the backup when the main file was torn", () => {
    const file = path.join(tempDir(), "sayabot-session.json")
    writeJsonAtomic(file, { refreshToken: "first" })
    writeJsonAtomic(file, { refreshToken: "second" })
    fs.writeFileSync(file, "{not json")
    expect(readJsonFile<{ refreshToken: string }>(file)?.refreshToken).toBe("first")
  })

  it("forgets the backup on purpose", () => {
    const file = path.join(tempDir(), "sayabot-session.json")
    writeJsonAtomic(file, { refreshToken: "keep" })
    removeJsonFile(file)
    expect(readJsonFile(file)).toBeNull()
    expect(fs.existsSync(`${file}.bak`)).toBe(false)
  })
})
