import { createHash, randomUUID } from "node:crypto"
import {
  closeSync, constants, existsSync, fchmodSync, fchownSync, fstatSync, fsyncSync,
  lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, unlinkSync, writeSync,
} from "node:fs"
import { dirname, isAbsolute, resolve, sep } from "node:path"

export const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_EDIT_BYTES = 5 * 1024 * 1024
export const MAX_PAGE_BYTES = 2 * 1024 * 1024

export function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)
}

export function isSafePath(path: string): boolean {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) return false
  try {
    const roots = ["/home/bot", "/tmp", process.env.BOT_HOME || "/home/bot"]
    const canonicalRoots = roots.map((root) => existsSync(root) ? realpathSync(root) : resolve(root))
    const absolute = resolve(path)
    if (![...roots, ...canonicalRoots].some((root) => within(absolute, root))) return false
    let ancestor = absolute
    while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
      const parent = dirname(ancestor)
      if (parent === ancestor) return false
      ancestor = parent
    }
    // realpath also rejects dangling links and link loops, including in ancestors.
    const canonical = resolve(realpathSync(ancestor), absolute.slice(ancestor.length).replace(/^\//, ""))
    return canonicalRoots.some((root) => within(canonical, root))
  } catch {
    return false
  }
}

export function assertSafePath(path: string): void {
  if (!isSafePath(path)) throw new Error("access denied: path must be inside /home/bot or /tmp (including symlink targets)")
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function integer(value: unknown, fallback: number, min: number, max: number, name: string): number {
  const n = value ?? fallback
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return n
}

export function openSafeFile(path: string, maxBytes: number) {
  assertSafePath(path)
  const canonical = realpathSync(path)
  assertSafePath(canonical)
  const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error("Not a regular file")
    if (stat.size > maxBytes) throw new Error(`File exceeds ${maxBytes} byte limit; refusing truncated input`)
    return { fd, stat, canonical }
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

export function readCompleteFile(path: string, maxBytes = MAX_EDIT_BYTES): Buffer {
  const { fd, stat } = openSafeFile(path, maxBytes)
  try {
    const bytes = Buffer.alloc(stat.size + 1)
    let size = 0
    while (size < bytes.length) {
      const n = readSync(fd, bytes, size, bytes.length - size, null)
      if (!n) break
      size += n
    }
    const after = fstatSync(fd)
    if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      throw new Error("File changed while reading; retry")
    }
    return bytes.subarray(0, size)
  } finally {
    closeSync(fd)
  }
}

function text(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new Error("Cannot read or edit binary file")
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
}

export interface ReadRequest {
  path: string
  startLine?: number
  endLine?: number
  maxBytes?: number
  encoding?: "utf8" | "base64"
  offsetBytes?: number
}

export function readFilePage(req: ReadRequest) {
  const maxBytes = integer(req.maxBytes, 256 * 1024, 1, MAX_PAGE_BYTES, "maxBytes")
  const start = integer(req.startLine, 1, 1, Number.MAX_SAFE_INTEGER, "startLine")
  const end = integer(req.endLine, Number.MAX_SAFE_INTEGER, start, Number.MAX_SAFE_INTEGER, "endLine")
  if (req.encoding !== undefined && req.encoding !== "utf8" && req.encoding !== "base64") throw new Error("Invalid encoding")
  const binary = req.encoding === "base64"
  if (binary && (req.startLine !== undefined || req.endLine !== undefined)) throw new Error("base64 reads use offsetBytes, not line ranges")
  if (!binary && req.offsetBytes !== undefined) throw new Error("offsetBytes requires base64 encoding")
  const offset = integer(req.offsetBytes, 0, 0, Number.MAX_SAFE_INTEGER, "offsetBytes")
  const { fd, stat } = openSafeFile(req.path, MAX_FILE_BYTES)
  try {
    const hash = createHash("sha256")
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    const chunk = Buffer.alloc(64 * 1024)
    const page: string[] = []
    const binaryPage: Buffer[] = []
    let bytesRead = 0
    let bytesReturned = 0
    let line = 1
    let lineText = ""
    let lineBytes = 0
    let capped = false
    let oversized = false
    const wanted = () => line >= start && line <= end && !capped
    const finishLine = () => {
      if (wanted()) {
        const cost = lineBytes + (page.length ? 1 : 0)
        if (page.length >= 2000 || bytesReturned + cost > maxBytes) {
          oversized = page.length === 0
          capped = true
        } else {
          page.push(lineText)
          bytesReturned += cost
        }
      }
      lineText = ""
      lineBytes = 0
      line++
    }
    const consume = (value: string) => {
      const parts = value.split("\n")
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!
        if (wanted()) {
          lineBytes += Buffer.byteLength(part)
          if (lineBytes <= maxBytes) lineText += part
        }
        if (i < parts.length - 1) finishLine()
      }
    }
    while (true) {
      const n = readSync(fd, chunk, 0, chunk.length, null)
      if (!n) break
      const bytes = chunk.subarray(0, n)
      hash.update(bytes)
      if (binary) {
        const from = Math.max(0, offset - bytesRead)
        const to = Math.min(n, offset + maxBytes - bytesRead)
        if (to > from) binaryPage.push(Buffer.from(bytes.subarray(from, to)))
      } else {
        if (bytes.includes(0)) throw new Error("Cannot read binary file")
        consume(decoder.decode(bytes, { stream: true }))
      }
      bytesRead += n
      if (bytesRead > MAX_FILE_BYTES) throw new Error("File grew beyond read limit")
    }
    const after = fstatSync(fd)
    if (bytesRead !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("File changed while reading; retry")
    const digest = hash.digest("hex")
    if (binary) {
      const bytes = Buffer.concat(binaryPage)
      const next = Math.min(offset + bytes.length, stat.size)
      return { path: req.path, content: bytes.toString("base64"), encoding: "base64", size: stat.size,
        bytesReturned: bytes.length, hash: digest, truncated: offset > 0 || next < stat.size,
        hasMore: next < stat.size, nextOffsetBytes: next < stat.size ? next : null }
    }
    consume(decoder.decode())
    finishLine() // split("\n") semantics: an empty file and a final newline have an empty last line.
    if (oversized) throw new Error("Requested line exceeds maxBytes; increase maxBytes or use a base64 byte page")
    const totalLines = line - 1
    const last = page.length ? start + page.length - 1 : null
    const hasMore = last !== null && last < totalLines
    return { path: req.path, content: page.join("\n"), encoding: "utf8", size: stat.size,
      bytesReturned, hash: digest, totalLines, startLine: start, endLine: last, linesReturned: page.length,
      truncated: start > 1 || page.length < totalLines, hasMore,
      nextStartLine: hasMore ? last + 1 : null }
  } finally {
    closeSync(fd)
  }
}

function atomicReplace(path: string, bytes: Buffer, expectedHash?: string, mode = 0o644) {
  assertSafePath(path)
  mkdirSync(dirname(path), { recursive: true })
  assertSafePath(path)
  const target = existsSync(path) ? realpathSync(path) : resolve(realpathSync(dirname(path)), path.split(sep).pop()!)
  assertSafePath(target)
  const original = lstatSync(target, { throwIfNoEntry: false })
  if (original && !original.isFile()) throw new Error("Not a regular file")
  const temp = resolve(dirname(target), `.agentd-${randomUUID()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, original?.mode ?? mode)
    let written = 0
    while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written)
    if (original && process.getuid?.() === 0) fchownSync(fd, original.uid, original.gid)
    fchmodSync(fd, (original?.mode ?? mode) & 0o777)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    assertSafePath(path)
    assertSafePath(target)
    if (original) {
      if (realpathSync(path) !== target) throw new Error("File path changed during edit")
      const current = lstatSync(target)
      if (current.ino !== original.ino || current.dev !== original.dev || current.mtimeMs !== original.mtimeMs || current.ctimeMs !== original.ctimeMs) {
        throw new Error("File changed during edit; retry")
      }
    } else if (existsSync(target)) throw new Error("File appeared during write; retry")
    if (expectedHash && hashBytes(readCompleteFile(target)) !== expectedHash) throw new Error("Stale hash: file changed; read it again")
    renameSync(temp, target)
    return { bytes: bytes.length, hash: hashBytes(bytes) }
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch {}
  }
}

export function writeFileAtomic(req: { path: string; content: string; encoding?: "utf8" | "base64"; mode?: number }) {
  if (typeof req.content !== "string") throw new Error("content must be a string")
  if (req.encoding !== undefined && req.encoding !== "utf8" && req.encoding !== "base64") throw new Error("Invalid encoding")
  const bytes = Buffer.from(req.content, req.encoding ?? "utf8")
  if (bytes.length > MAX_EDIT_BYTES) throw new Error("Write exceeds byte limit")
  const mode = integer(req.mode, 0o644, 0, 0o777, "mode")
  return atomicReplace(req.path, bytes, undefined, mode)
}

export interface EditRequest {
  path: string
  oldString: string
  newString: string
  expectedHash?: string
  replaceAll?: boolean
  whitespace?: boolean
  truncated?: boolean
}

export function editFileAtomic(req: EditRequest) {
  if (req.truncated) throw new Error("Cannot edit truncated input")
  if (typeof req.oldString !== "string" || !req.oldString || typeof req.newString !== "string") throw new Error("oldString must be nonempty and newString must be a string")
  const bytes = readCompleteFile(req.path)
  const previousHash = hashBytes(bytes)
  if (req.expectedHash !== undefined) {
    if (typeof req.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(req.expectedHash)) throw new Error("expectedHash must be the SHA-256 hash from fs_read")
    if (previousHash !== req.expectedHash) throw new Error("Stale hash: file changed; read it again")
  }
  const content = text(bytes)
  const exactMatches: Array<{ start: number; end: number }> = []
  let index = content.indexOf(req.oldString)
  // Count overlapping occurrences as ambiguous too.
  while (index !== -1) {
    exactMatches.push({ start: index, end: index + req.oldString.length })
    if (exactMatches.length > 10_000) throw new Error("Replacement count limit exceeded")
    index = content.indexOf(req.oldString, index + 1)
  }
  const matches = [...exactMatches]
  let matchMode = "exact"
  if (req.whitespace === true) {
    // Only whole lines; whitespace inside tokens is never normalized.
    const normalize = (line: string) => line.replace(/^[\t ]+|[\t \r]+$/g, "")
    const sourceLines = content.split("\n")
    const hasFinalNewline = sourceLines[sourceLines.length - 1] === ""
    const bodyLines = hasFinalNewline ? sourceLines.slice(0, -1) : sourceLines
    const fileUsesCRLF = bodyLines.some((line) => line.endsWith("\r"))
    const searchTrailingNewline = /\n$/.test(req.oldString)
    const requestedLines = req.oldString.replace(/\n$/, "").split("\n")
    const needle = requestedLines.map((line, index) =>
      fileUsesCRLF && !line.endsWith("\r") && index < requestedLines.length - 1 ? `${line}\r` : line,
    )
    if (needle.some((line) => line.endsWith("\r")) && !fileUsesCRLF) {
      throw new Error("Whitespace matching cannot mix CRLF search text with LF file lines")
    }
    if (!needle.some((line) => normalize(line))) throw new Error("Whitespace-only matching is not allowed")
    if (bodyLines.length > 100_000 || needle.length > 100_000) throw new Error("Whitespace match line count limit exceeded")
    const normalized = bodyLines.map(normalize)
    const normalizedContent = normalized.join("\n")
    const normalizedNeedle = needle.map(normalize).join("\n")
    const candidates: number[] = []
    let cursor = normalizedContent.indexOf(normalizedNeedle)
    while (cursor !== -1) {
      candidates.push(cursor)
      cursor = normalizedContent.indexOf(normalizedNeedle, cursor + 1)
    }
    const starts = new Map<number, number>()
    const offsets: number[] = []
    let normalizedOffset = 0
    let offset = 0
    for (let i = 0; i < bodyLines.length; i++) {
      starts.set(normalizedOffset, i)
      offsets.push(offset)
      normalizedOffset += normalized[i]!.length + 1
      offset += bodyLines[i]!.length + 1
    }
    const whitespaceMatches: Array<{ start: number; end: number }> = []
    for (const found of candidates) {
      const i = starts.get(found)
      const end = found + normalizedNeedle.length
      if (i === undefined || !(end === normalizedContent.length || normalizedContent[end] === "\n")) continue
      const lastIndex = i + needle.length - 1
      if (lastIndex >= bodyLines.length) continue
      // A trailing newline in the search can't match the last line of a file without one.
      if (searchTrailingNewline && lastIndex === bodyLines.length - 1 && !hasFinalNewline) continue
      whitespaceMatches.push({ start: offsets[i]!, end: offsets[lastIndex]! + bodyLines[lastIndex]!.length + (searchTrailingNewline ? 1 : bodyLines[lastIndex]!.endsWith("\r") ? -1 : 0) })
    }
    if (!exactMatches.length) {
      if (whitespaceMatches.length > 1) throw new Error("Ambiguous whitespace match: provide more context")
      if (whitespaceMatches.length === 1) {
        matchMode = "whitespace"
        matches.push(...whitespaceMatches)
      } else if (candidates.length) {
        throw new Error("Whitespace matching only supports complete line blocks; provide the full contiguous line block")
      }
    }
  }
  if (!matches.length) throw new Error("Could not find a match for oldString")
  if (matches.length > 1 && (matchMode !== "exact" || !req.replaceAll)) throw new Error(`Ambiguous match: found ${matches.length} occurrences; provide more context`)
  if (matches.some((match, i) => i > 0 && match.start < matches[i - 1]!.end)) throw new Error("Overlapping matches are ambiguous")
  let replacement = req.newString
  if (matchMode === "whitespace" && content.includes("\r\n") && !content.replace(/\r\n/g, "").includes("\n")) replacement = replacement.replace(/\r?\n/g, "\r\n")
  let updated = content
  for (const match of [...matches].reverse()) updated = updated.slice(0, match.start) + replacement + updated.slice(match.end)
  const output = Buffer.from(updated)
  if (output.length > MAX_EDIT_BYTES) throw new Error("Edited file exceeds byte limit")
  const result = atomicReplace(req.path, output, req.expectedHash)
  return { ok: true, path: req.path, ...result, previousHash, replacements: matches.length, matchMode }
}

export interface PatchChunk {
  oldLines: string[]
  newLines: string[]
  changeContext?: string
  endOfFile?: boolean
}

export type ParsedPatch =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: PatchChunk[] }

const BEGIN_MARKER = "*** Begin Patch"
const END_MARKER = "*** End Patch"
const ADD_HEADER = "*** Add File:"
const DELETE_HEADER = "*** Delete File:"
const UPDATE_HEADER = "*** Update File:"
const MOVE_HEADER = "*** Move to:"
const END_OF_FILE_MARKER = "*** End of File"

function cleanHeredoc(patchText: string): string {
  let cleaned = patchText.trim()
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9_-]*\r?\n/, "")
    cleaned = cleaned.replace(/\r?\n```$/, "")
  }
  return cleaned
}

export function parseStructuredPatch(patchText: string): ParsedPatch[] {
  if (typeof patchText !== "string" || !patchText.trim()) {
    throw new Error("patchText must be a nonempty string")
  }
  const normalized = cleanHeredoc(patchText).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = normalized.trim().split("\n")
  const beginIndex = lines.findIndex((l) => l.trim() === BEGIN_MARKER)
  const endIndex = lines.findIndex((l) => l.trim() === END_MARKER)

  if (beginIndex === -1 || endIndex === -1 || beginIndex >= endIndex) {
    throw new Error("Invalid patch format: missing Begin/End markers (*** Begin Patch / *** End Patch)")
  }

  const sections: ParsedPatch[] = []
  let index = beginIndex + 1

  const readHeaderPath = (line: string, header: string): string => {
    const raw = line.slice(header.length).trim()
    if (!raw) throw new Error(`Missing path in header: ${line}`)
    return raw
  }

  const isSectionHeader = (line: string): boolean => {
    const t = line.trim()
    return t.startsWith(ADD_HEADER) || t.startsWith(DELETE_HEADER) || t.startsWith(UPDATE_HEADER) || t === END_MARKER
  }

  while (index < endIndex) {
    const line = lines[index] ?? ""
    const trimmed = line.trim()
    if (!trimmed) {
      index++
      continue
    }

    if (trimmed.startsWith(ADD_HEADER)) {
      const path = readHeaderPath(trimmed, ADD_HEADER)
      index++
      const contents: string[] = []
      while (index < endIndex && !isSectionHeader(lines[index] ?? "")) {
        const curLine = lines[index] ?? ""
        if (curLine.startsWith("+")) {
          contents.push(curLine.slice(1))
        } else if (curLine.startsWith("***")) {
          break
        } else {
          contents.push(curLine)
        }
        index++
      }
      sections.push({ type: "add", path, contents: contents.join("\n") + (contents.length > 0 ? "\n" : "") })
      continue
    }

    if (trimmed.startsWith(DELETE_HEADER)) {
      const path = readHeaderPath(trimmed, DELETE_HEADER)
      sections.push({ type: "delete", path })
      index++
      continue
    }

    if (trimmed.startsWith(UPDATE_HEADER)) {
      const path = readHeaderPath(trimmed, UPDATE_HEADER)
      let movePath: string | undefined
      index++
      if (index < endIndex && (lines[index] ?? "").trim().startsWith(MOVE_HEADER)) {
        movePath = readHeaderPath((lines[index] ?? "").trim(), MOVE_HEADER)
        index++
      }

      const chunks: PatchChunk[] = []
      while (index < endIndex && !isSectionHeader(lines[index] ?? "")) {
        const hLine = lines[index] ?? ""
        if (hLine.trim().startsWith("@@")) {
          const changeContext = hLine.trim().replace(/^@@\s*/, "").replace(/\s*@@$/, "").trim() || undefined
          index++
          const oldLines: string[] = []
          const newLines: string[] = []
          let endOfFile = false

          while (index < endIndex && !isSectionHeader(lines[index] ?? "") && !(lines[index] ?? "").trim().startsWith("@@")) {
            const cLine = lines[index] ?? ""
            if (cLine.trim() === END_OF_FILE_MARKER) {
              endOfFile = true
              index++
              break
            }
            if (cLine.startsWith("-")) {
              oldLines.push(cLine.slice(1))
            } else if (cLine.startsWith("+")) {
              newLines.push(cLine.slice(1))
            } else if (cLine.startsWith(" ")) {
              oldLines.push(cLine.slice(1))
              newLines.push(cLine.slice(1))
            } else if (cLine === "") {
              oldLines.push("")
              newLines.push("")
            } else {
              oldLines.push(cLine)
              newLines.push(cLine)
            }
            index++
          }
          chunks.push({ oldLines, newLines, changeContext, endOfFile })
        } else {
          index++
        }
      }
      sections.push({ type: "update", path, movePath, chunks })
      continue
    }

    throw new Error(`Invalid patch section header: ${line}`)
  }

  if (sections.length === 0) {
    throw new Error("Patch contains no file operations")
  }

  return sections
}

function linesMatch(lines: string[], pattern: string[], startIndex: number, mode: "exact" | "trimEnd" | "trim"): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const a = lines[startIndex + i] ?? ""
    const b = pattern[i] ?? ""
    if (mode === "exact" && a !== b) return false
    if (mode === "trimEnd" && a.trimEnd() !== b.trimEnd()) return false
    if (mode === "trim" && a.trim() !== b.trim()) return false
  }
  return true
}

function findSequence(lines: string[], pattern: string[], startIndex: number, eof?: boolean): number {
  if (pattern.length === 0) return startIndex
  const modes = ["exact", "trimEnd", "trim"] as const

  for (const mode of modes) {
    if (eof) {
      const fromEnd = lines.length - pattern.length
      if (fromEnd >= startIndex && linesMatch(lines, pattern, fromEnd, mode)) {
        return fromEnd
      }
    }
    for (let i = startIndex; i <= lines.length - pattern.length; i++) {
      if (linesMatch(lines, pattern, i, mode)) {
        return i
      }
    }
  }
  return -1
}

export function applyHunksToContent(content: string, chunks: PatchChunk[], filePath: string): string {
  const isCRLF = content.includes("\r\n") && !content.replace(/\r\n/g, "").includes("\n")
  const hasTrailingNewline = content.endsWith("\n")
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  if (hasTrailingNewline && lines[lines.length - 1] === "") {
    lines.pop()
  }

  type Replacement = [startIndex: number, oldLength: number, newLines: string[]]
  const replacements: Replacement[] = []
  let lineIndex = 0

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const ctxIdx = lines.findIndex((l, idx) => idx >= lineIndex && (l === chunk.changeContext || l.trim() === chunk.changeContext!.trim()))
      if (ctxIdx !== -1) {
        lineIndex = ctxIdx
      }
    }

    if (chunk.oldLines.length === 0) {
      replacements.push([lineIndex, 0, chunk.newLines])
      continue
    }

    let found = findSequence(lines, chunk.oldLines, lineIndex, chunk.endOfFile)
    if (found === -1 && chunk.oldLines[chunk.oldLines.length - 1] === "") {
      const trimmedOld = chunk.oldLines.slice(0, -1)
      const trimmedNew = chunk.newLines[chunk.newLines.length - 1] === "" ? chunk.newLines.slice(0, -1) : chunk.newLines
      found = findSequence(lines, trimmedOld, lineIndex, chunk.endOfFile)
      if (found !== -1) {
        replacements.push([found, trimmedOld.length, trimmedNew])
        lineIndex = found + trimmedOld.length
        continue
      }
    }

    if (found === -1) {
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`)
    }

    replacements.push([found, chunk.oldLines.length, chunk.newLines])
    lineIndex = found + chunk.oldLines.length
  }

  const result = [...lines]
  for (const [startIdx, count, newLines] of replacements.sort((a, b) => b[0] - a[0])) {
    result.splice(startIdx, count, ...newLines)
  }

  const joined = result.join(isCRLF ? "\r\n" : "\n")
  return hasTrailingNewline || joined.length > 0 ? (joined.endsWith("\n") ? joined : joined + (isCRLF ? "\r\n" : "\n")) : ""
}

export interface ApplyPatchRequest {
  patchText: string
}

export interface PatchFileResult {
  path: string
  action: "add" | "delete" | "update" | "move"
  additions: number
  deletions: number
  bytes?: number
  hash?: string
}

export interface ApplyPatchResult {
  ok: boolean
  summary: string
  files: PatchFileResult[]
}

export function applyPatchAtomic(req: ApplyPatchRequest): ApplyPatchResult {
  const sections = parseStructuredPatch(req.patchText)

  interface PlannedAction {
    section: ParsedPatch
    newContent?: Buffer
    targetPath: string
    oldPath?: string
    additions: number
    deletions: number
  }

  const planned: PlannedAction[] = []

  // 1. In-memory validation phase: verify ALL targets before touching disk
  for (const section of sections) {
    assertSafePath(section.path)
    if (section.type === "add") {
      const targetPath = resolve(section.path)
      assertSafePath(targetPath)
      const bytes = Buffer.from(section.contents, "utf8")
      if (bytes.length > MAX_EDIT_BYTES) throw new Error(`Added file ${section.path} exceeds byte limit`)
      const addLines = section.contents ? section.contents.split("\n").filter((l) => l.length > 0).length : 0
      planned.push({
        section,
        targetPath,
        newContent: bytes,
        additions: addLines,
        deletions: 0,
      })
    } else if (section.type === "delete") {
      const targetPath = resolve(section.path)
      assertSafePath(targetPath)
      if (!existsSync(targetPath)) throw new Error(`Cannot delete nonexistent file: ${section.path}`)
      const stat = lstatSync(targetPath)
      if (!stat.isFile()) throw new Error(`Cannot delete non-file: ${section.path}`)
      const bytes = readCompleteFile(targetPath)
      const delLines = text(bytes).split("\n").filter((l) => l.length > 0).length
      planned.push({
        section,
        targetPath,
        additions: 0,
        deletions: delLines,
      })
    } else if (section.type === "update") {
      const oldPath = resolve(section.path)
      assertSafePath(oldPath)
      const targetPath = section.movePath ? resolve(section.movePath) : oldPath
      assertSafePath(targetPath)
      if (!existsSync(oldPath)) throw new Error(`Cannot update nonexistent file: ${section.path}`)
      const bytes = readCompleteFile(oldPath)
      const originalText = text(bytes)
      const updatedText = applyHunksToContent(originalText, section.chunks, section.path)
      const outBytes = Buffer.from(updatedText, "utf8")
      if (outBytes.length > MAX_EDIT_BYTES) throw new Error(`Patched file ${section.path} exceeds byte limit`)

      let additions = 0
      let deletions = 0
      for (const chunk of section.chunks) {
        additions += chunk.newLines.length
        deletions += chunk.oldLines.length
      }

      planned.push({
        section,
        targetPath,
        oldPath: section.movePath ? oldPath : undefined,
        newContent: outBytes,
        additions,
        deletions,
      })
    }
  }

  // 2. Execution phase: all checks passed! Apply changes atomically
  const files: PatchFileResult[] = []

  for (const action of planned) {
    if (action.section.type === "add") {
      const res = atomicReplace(action.targetPath, action.newContent!)
      files.push({
        path: action.section.path,
        action: "add",
        additions: action.additions,
        deletions: 0,
        bytes: res.bytes,
        hash: res.hash,
      })
    } else if (action.section.type === "delete") {
      unlinkSync(action.targetPath)
      files.push({
        path: action.section.path,
        action: "delete",
        additions: 0,
        deletions: action.deletions,
      })
    } else if (action.section.type === "update") {
      const res = atomicReplace(action.targetPath, action.newContent!)
      if (action.oldPath && action.oldPath !== action.targetPath) {
        try { unlinkSync(action.oldPath) } catch {}
      }
      files.push({
        path: action.section.movePath ? `${action.section.path} -> ${action.section.movePath}` : action.section.path,
        action: action.section.movePath ? "move" : "update",
        additions: action.additions,
        deletions: action.deletions,
        bytes: res.bytes,
        hash: res.hash,
      })
    }
  }

  const summary = `Successfully applied patch to ${files.length} file(s): ` +
    files.map((f) => `${f.action === "add" ? "A" : f.action === "delete" ? "D" : f.action === "move" ? "R" : "M"} ${f.path} (+${f.additions}/-${f.deletions})`).join(", ")

  return { ok: true, summary, files }
}
