import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { hashBytes, readFilePage, within, writeFileAtomic, editFileAtomic, MAX_FILE_BYTES } from "../../agentd/files"

let home: string
let prev: string | undefined

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "agentd-unit-")))
  prev = process.env.BOT_HOME
  process.env.BOT_HOME = home
})
afterEach(() => {
  if (prev === undefined) delete process.env.BOT_HOME; else process.env.BOT_HOME = prev
  rmSync(home, { recursive: true, force: true })
})

describe("within", () => {
  it("prefix matching is path-segment aware", () => {
    expect(within("/home/bot", "/home/bot")).toBe(true)
    expect(within("/home/bot/a", "/home/bot")).toBe(true)
    expect(within("/home/bot2/a", "/home/bot")).toBe(false)
    expect(within("/home/bot/a", "/home/bot/")).toBe(true)
  })
})

describe("hashBytes", () => {
  it("is the sha256 hex digest", () => {
    expect(hashBytes(new TextEncoder().encode("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })
})

describe("readFilePage / write / edit round-trip", () => {
  it("writes then reads a page with a stable hash", () => {
    const path = join(home, "a.txt")
    writeFileSync(path, "line1\nline2\nline3\n")
    const page = readFilePage({ path })
    expect(page.content).toContain("line1")
    expect(page.totalLines).toBeGreaterThanOrEqual(3)
  })

  it("writeFileAtomic creates parent dirs and returns bytes+hash", () => {
    const res = writeFileAtomic({ path: join(home, "sub/b.txt"), content: "data" })
    expect(res.bytes).toBe(4)
    expect(res.hash).toBe(hashBytes(new TextEncoder().encode("data")))
  })

  it("writeFileAtomic refuses to overwrite large existing file without allowOverwriteLarge", () => {
    const path = join(home, "large.txt")
    writeFileSync(path, "x".repeat(3000))
    expect(() => writeFileAtomic({ path, content: "short" })).toThrow(/Refusing to overwrite existing file/)
    expect(readFilePage({ path }).size).toBe(3000)

    // Allowed when allowOverwriteLarge is true
    const res = writeFileAtomic({ path, content: "short", allowOverwriteLarge: true })
    expect(res.bytes).toBe(5)
    expect(readFilePage({ path }).content).toBe("short")
  })

  it("writeFileAtomic preserves CRLF line endings on existing CRLF files", () => {
    const path = join(home, "crlf.txt")
    writeFileSync(path, "line1\r\nline2\r\n")
    writeFileAtomic({ path, content: "lineA\nlineB\n" })
    const content = readFilePage({ path }).content
    expect(content).toBe("lineA\r\nlineB\r\n")
  })

  it("editFileAtomic rejects a stale hash without writing", () => {
    const path = join(home, "c.txt")
    writeFileSync(path, "original")
    expect(() => editFileAtomic({ path, oldString: "original", newString: "changed", expectedHash: "0".repeat(64) })).toThrow()
    expect(readFilePage({ path }).content).toContain("original")
  })

  it("refuses paths outside the bot home", () => {
    expect(() => readFilePage({ path: "/etc/passwd" })).toThrow()
    expect(() => writeFileAtomic({ path: "/etc/cron.d/x", content: "x" })).toThrow()
  })

  it("MAX_FILE_BYTES constant is sane", () => {
    expect(MAX_FILE_BYTES).toBe(32 * 1024 * 1024)
  })
})
