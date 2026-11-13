import assert from "node:assert/strict"
import { test } from "node:test"
import { parseBlocks } from "../../src/core/markdown.ts"

test("splits paragraphs, lists, headings and code", () => {
  const blocks = parseBlocks("# Plan\nFirst line\nsecond line\n\n- one\n2. two\n```\nconst a = 1\n```\n> quoted")
  assert.deepEqual(
    blocks.map((b) => b.t),
    ["h", "p", "li", "li", "code", "quote"],
  )
  assert.equal((blocks[1] as { text: string }).text, "First line\nsecond line")
  assert.equal((blocks[3] as { mark: string }).mark, "2.")
  assert.equal((blocks[4] as { text: string }).text, "const a = 1")
})

test("images and file chips are their own blocks", () => {
  const blocks = parseBlocks("Here you go\n![photo.jpg](https://x.test/api/files/rooms/r/1/photo.jpg)\n[📎 resume.pdf](https://x.test/api/files/rooms/r/2/resume.pdf)")
  assert.deepEqual(blocks.map((b) => b.t), ["p", "img", "file"])
  assert.equal((blocks[1] as { url: string }).url, "https://x.test/api/files/rooms/r/1/photo.jpg")
  assert.equal((blocks[2] as { name: string }).name, "resume.pdf")
})

test("an unclosed code fence keeps the rest as code", () => {
  const blocks = parseBlocks("```\nline 1\nline 2")
  assert.deepEqual(blocks, [{ t: "code", text: "line 1\nline 2" }])
})
