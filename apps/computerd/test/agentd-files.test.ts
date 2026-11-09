import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { applyPatchAtomic, editFileAtomic, hashBytes, isSafePath, MAX_EDIT_BYTES, MAX_FILE_BYTES, readFilePage, writeFileAtomic } from "../agentd/files"

let root: string
beforeEach(() => { root = realpathSync(mkdtempSync("/tmp/agentd-files-")) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
const put = (content: string | Buffer, name = "file.txt") => { const path = join(root, name); writeFileSync(path, content); return path }
const edit = (path: string, oldString: string, newString: string, extra = {}) => editFileAtomic({ path, oldString, newString, expectedHash: hashBytes(readFileSync(path)), ...extra })

describe("bounded file pages", () => {
  it("reads late lines beyond the old 2MB prefix and hashes the whole file", () => {
    const content = Array.from({ length: 6000 }, (_, i) => `${i + 1}: ${"x".repeat(500)}`).join("\n")
    const path = put(content)
    const page = readFilePage({ path, startLine: 5000, endLine: 5002, maxBytes: 2000 })
    expect(page).toMatchObject({ totalLines: 6000, startLine: 5000, endLine: 5002, linesReturned: 3, truncated: true, hasMore: true, nextStartLine: 5003, hash: hashBytes(Buffer.from(content)), size: Buffer.byteLength(content) })
    expect(page.content.startsWith("5000:")).toBe(true)
    expect(page.bytesReturned).toBe(Buffer.byteLength(page.content))
  })
  it("caps complete UTF-8 lines by bytes and resumes truthfully", () => {
    const path = put("αβ\n世界\nlast\n")
    const first = readFilePage({ path, maxBytes: 10 })
    expect(first.content).toBe("αβ")
    expect(first).toMatchObject({ totalLines: 4, bytesReturned: 4, nextStartLine: 2, truncated: true })
    const second = readFilePage({ path, startLine: first.nextStartLine!, maxBytes: 20 })
    expect(second.content).toBe("世界\nlast\n")
    expect(second).toMatchObject({ endLine: 4, hasMore: false, nextStartLine: null, hash: first.hash })
  })
  it("handles empty files, final newlines, ranges, EOF, and 2000-line caps", () => {
    const path = put("")
    expect(readFilePage({ path })).toMatchObject({ totalLines: 1, linesReturned: 1, content: "", truncated: false })
    writeFileSync(path, "a\r\nb\r\n")
    expect(readFilePage({ path, endLine: 1 })).toMatchObject({ content: "a\r", totalLines: 3, nextStartLine: 2 })
    expect(readFilePage({ path, startLine: 9 })).toMatchObject({ content: "", linesReturned: 0, endLine: null, hasMore: false })
    expect(() => readFilePage({ path, startLine: 3, endLine: 2 })).toThrow("endLine")
    expect(() => readFilePage({ path, maxBytes: -1 })).toThrow("maxBytes")
    writeFileSync(path, "x\n".repeat(2500))
    expect(readFilePage({ path })).toMatchObject({ totalLines: 2501, linesReturned: 2000, nextStartLine: 2001 })
  })
  it("rejects huge lines, binary/invalid UTF-8 text and oversized files", () => {
    const path = put("x".repeat(200))
    expect(() => readFilePage({ path, maxBytes: 100 })).toThrow("line exceeds")
    writeFileSync(path, Buffer.from([0xff, 0xfe]))
    expect(() => readFilePage({ path })).toThrow()
    writeFileSync(path, "a\0b")
    expect(() => readFilePage({ path })).toThrow("binary")
    truncateSync(path, MAX_FILE_BYTES + 1)
    expect(() => readFilePage({ path })).toThrow("limit")
  })
  it("offers raw byte pagination for binaries without slicing base64 characters", () => {
    const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6])
    const path = put(bytes)
    const page = readFilePage({ path, encoding: "base64", offsetBytes: 2, maxBytes: 3 })
    expect(Buffer.from(page.content, "base64")).toEqual(bytes.subarray(2, 5))
    expect(page).toMatchObject({ bytesReturned: 3, size: 7, nextOffsetBytes: 5, hasMore: true, hash: hashBytes(bytes) })
  })
})

describe("guarded atomic edits", () => {
  it("replaces literal dollar/backslash text, keeps modes and changes the inode atomically", () => {
    const path = put("first\r\nold\r\nlast\r\n")
    chmodSync(path, 0o640)
    const before = statSync(path)
    const result = edit(path, "old", "$&\\new")
    expect(readFileSync(path, "utf8")).toBe("first\r\n$&\\new\r\nlast\r\n")
    expect(result).toMatchObject({ matchMode: "exact", replacements: 1, hash: hashBytes(readFileSync(path)) })
    expect(statSync(path).mode & 0o777).toBe(0o640)
    expect(statSync(path).ino).not.toBe(before.ino)
    expect(readdirSync(root)).toEqual(["file.txt"])
  })
  it("rejects stale hashes, duplicate and overlapping matches without modifying", () => {
    const path = put("old old")
    const previousHash = hashBytes(readFileSync(path))
    expect(() => edit(path, "old", "new")).toThrow("Ambiguous")
    writeFileSync(path, "old changed")
    expect(() => edit(path, "old", "new", { expectedHash: previousHash })).toThrow("Stale hash")
    expect(readFileSync(path, "utf8")).toBe("old changed")
    writeFileSync(path, "aaa")
    expect(() => edit(path, "aa", "b", { replaceAll: true })).toThrow("Overlapping")
    writeFileSync(path, "old old")
    expect(edit(path, "old", "new", { replaceAll: true }).replacements).toBe(2)
    expect(readFileSync(path, "utf8")).toBe("new new")
  })
  it("requires opt-in and only matches unique complete whitespace-normalized lines", () => {
    const path = put("before\r\n\tconst a = 1;  \r\n  return a;\r\nafter\r\n")
    const old = "const a = 1;\nreturn a;\n"
    expect(() => edit(path, old, "replacement\n")).toThrow("Could not find")
    expect(edit(path, old, "  const b = 2;\n  return b;\n", { whitespace: true }).matchMode).toBe("whitespace")
    expect(readFileSync(path, "utf8")).toBe("before\r\n  const b = 2;\r\n  return b;\r\nafter\r\n")
    // Partial-line blocks are refused (not an exact substring, only matches mid-line once normalized).
    expect(() => edit(path, "b = 2;\nreturn b;", "no", { whitespace: true })).toThrow("complete line")
    expect(() => edit(path, "const  b = 2;", "no", { whitespace: true })).toThrow("Could not find")
  })
  it("tries exact before whitespace, and refuses duplicate normalized blocks even with replaceAll", () => {
    const path = put("\tx\n  x\n")
    // "   x" is not an exact substring; normalized it matches both lines.
    expect(() => edit(path, "   x\n", "y\n", { whitespace: true, replaceAll: true })).toThrow("Ambiguous")
    expect(edit(path, "\tx\n", "exact\n", { whitespace: true }).matchMode).toBe("exact")
    expect(readFileSync(path, "utf8")).toBe("exact\n  x\n")
  })
  it("matches a whitespace block ending on the last line of a newline-terminated file", () => {
    const path = put("\tx\n  y\n")
    expect(edit(path, "x\ny\n", "z\n", { whitespace: true }).matchMode).toBe("whitespace")
    expect(readFileSync(path, "utf8")).toBe("z\n")
    const noFinal = put("\tx\n  y", "nofinal.txt")
    expect(() => edit(noFinal, "x\ny\n", "z\n", { whitespace: true })).toThrow()
  })
  it("preserves no-final-newline and supports a guarded edit from a read page", () => {
    const path = put("header\n target  \nfooter")
    const page = readFilePage({ path, startLine: 2, endLine: 2 })
    expect(page.truncated).toBe(true)
    editFileAtomic({ path, oldString: " target  ", newString: "updated", expectedHash: page.hash })
    expect(readFileSync(path, "utf8")).toBe("header\nupdated\nfooter")
  })
  it("rejects truncated inputs and oversized files instead of overwriting unseen suffixes", () => {
    const path = put("before")
    expect(() => edit(path, "before", "after", { truncated: true })).toThrow("truncated")
    truncateSync(path, MAX_EDIT_BYTES + 1)
    expect(() => edit(path, "before", "after")).toThrow("refusing truncated")
    expect(statSync(path).size).toBe(MAX_EDIT_BYTES + 1)
  })
  it("makes concurrent stale writers lose instead of silently overwriting", async () => {
    const path = put("old")
    const expectedHash = hashBytes(readFileSync(path))
    const results = await Promise.allSettled(["first", "second"].map((newString) => Promise.resolve().then(() => editFileAtomic({ path, oldString: "old", newString, expectedHash }))))
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"])
    expect(readFileSync(path, "utf8")).toBe("first")
  })
})

describe("safe filesystem operations", () => {
  it("denies direct, symlink, dangling and ancestor escapes for read/write/edit", () => {
    const outside = "/etc/passwd"
    const link = join(root, "escape")
    symlinkSync(outside, link)
    const ancestor = join(root, "outside-dir")
    symlinkSync("/etc", ancestor)
    const broken = join(root, "broken")
    symlinkSync("/etc/missing-agentd-test", broken)
    for (const path of [outside, link, broken, join(ancestor, "passwd"), join(root, "../../etc/passwd")]) {
      expect(isSafePath(path)).toBe(false)
      expect(() => readFilePage({ path })).toThrow("access denied")
      expect(() => writeFileAtomic({ path, content: "no" })).toThrow("access denied")
      expect(() => editFileAtomic({ path, oldString: "root", newString: "no", expectedHash: "a".repeat(64) })).toThrow("access denied")
    }
  })
  it("allows in-root symlinks while atomic edits update the real target", () => {
    const path = put("old")
    const link = join(root, "alias")
    symlinkSync(path, link)
    expect(isSafePath(link)).toBe(true)
    edit(link, "old", "new")
    expect(readFileSync(path, "utf8")).toBe("new")
    expect(realpathSync(link)).toBe(path)
  })
  it("writes UTF-8 byte counts atomically and creates directories", () => {
    const path = join(root, "nested", "utf8.txt")
    const result = writeFileAtomic({ path, content: "世界" })
    expect(result.bytes).toBe(6)
    expect(result.hash).toBe(hashBytes(Buffer.from("世界")))
    expect(readFileSync(path, "utf8")).toBe("世界")
  })
})

describe("relaxed hash and structured atomic patches", () => {
  it("allows editFileAtomic without expectedHash when unique and existing", () => {
    const path = put("const answer = 41;\n")
    const result = editFileAtomic({
      path,
      oldString: "const answer = 41;",
      newString: "const answer = 42;",
    })
    expect(result.ok).toBe(true)
    expect(readFileSync(path, "utf8")).toBe("const answer = 42;\n")
    expect(result.previousHash).toBe(hashBytes(Buffer.from("const answer = 41;\n")))
  })

  it("applies multi-file patches with add, update, move, and delete atomically", () => {
    const fileA = put("hello world\nline 2\n", "fileA.txt")
    const fileB = put("to be deleted\n", "fileB.txt")
    const fileC = join(root, "fileC.txt")
    const fileMoved = join(root, "fileAMoved.txt")

    const patchText = `*** Begin Patch
*** Add File: ${fileC}
+const newFile = true;
+export default newFile;
*** Update File: ${fileA}
*** Move to: ${fileMoved}
@@
 hello world
-line 2
+line 2 updated
*** Delete File: ${fileB}
*** End Patch`

    const res = applyPatchAtomic({ patchText })
    expect(res.ok).toBe(true)
    expect(res.files).toHaveLength(3)

    // Check additions
    expect(existsSync(fileC)).toBe(true)
    expect(readFileSync(fileC, "utf8")).toBe("const newFile = true;\nexport default newFile;\n")

    // Check update & move
    expect(existsSync(fileA)).toBe(false)
    expect(existsSync(fileMoved)).toBe(true)
    expect(readFileSync(fileMoved, "utf8")).toBe("hello world\nline 2 updated\n")

    // Check delete
    expect(existsSync(fileB)).toBe(false)
  })

  it("aborts entire patch and touches zero files if any hunk fails to match", () => {
    const file1 = put("alpha\nbeta\n", "f1.txt")
    const file2 = put("gamma\ndelta\n", "f2.txt")
    const initial1 = readFileSync(file1, "utf8")
    const initial2 = readFileSync(file2, "utf8")

    const invalidPatch = `*** Begin Patch
*** Update File: ${file1}
@@
-alpha
+alpha modified
*** Update File: ${file2}
@@
-nonexistent line
+delta modified
*** End Patch`

    expect(() => applyPatchAtomic({ patchText: invalidPatch })).toThrow("Failed to find expected lines")

    // Atomicity check: file1 must NOT have been changed even though its hunk was valid!
    expect(readFileSync(file1, "utf8")).toBe(initial1)
    expect(readFileSync(file2, "utf8")).toBe(initial2)
  })
})
