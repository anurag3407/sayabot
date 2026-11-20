# agentd — File Operations & Path Safety

Every file an agent touches goes through `agentd/files.ts`: a single hardened module providing the allowed-roots check (`isSafePath`), atomic file replacement with hash guards, paged reads, fuzzy-tolerant edits, and a structured patch grammar with two-phase apply. All operations are bounded (32 MB read / 5 MB edit-write / 2 MB page) and refuse binaries.

Source files: `apps/computerd/agentd/files.ts`

---

## 🛡️ Path Safety: `isSafePath` and `assertSafePath`

`isSafePath(path)` (`files.ts:16-35`) is the gate for every filesystem operation. It is much stricter than a prefix check:

1. **Absolute, no NUL**: relative paths or paths containing `\0` are rejected outright.
2. **Allowed roots** (`files.ts:19`): `/home/bot`, `/tmp`, and `process.env.BOT_HOME || "/home/bot"` (the `BOT_HOME` env override lets images relocate the home root, e.g. E2B sets `BOT_HOME=/home/bot` explicitly). Both the literal roots and their **canonicalized** forms (`realpathSync` of existing roots) are accepted.
3. **Traversal resolution**: the path is `resolve`d, so `…` segments never reach the comparison; then the nearest **existing ancestor** is found by walking up parents (a non-existent path whose parent chain never lands on disk is rejected).
4. **Symlink defense**: `realpathSync(ancestor)` + the remaining suffix builds the canonical path; the canonical path must still be inside a canonical root. `realpathSync` also rejects dangling links and link loops, including in ancestors — so `/home/bot/link -> /etc/passwd` fails, as does any symlink planted inside the tree that points out.
5. Any filesystem error during checking fails **closed** (`catch { return false }`).

```typescript
const roots = ["/home/bot", "/tmp", process.env.BOT_HOME || "/home/bot"]
const canonicalRoots = roots.map((root) => (existsSync(root) ? realpathSync(root) : resolve(root)))
const absolute = resolve(path)
if (![...roots, ...canonicalRoots].some((root) => within(absolute, root))) return false
// … ancestor walk + realpath re-check against canonicalRoots …
```

Two levels of defense combine: `resolve()` kills `..` textually, `realpathSync` kills symlinks semantically — both must agree the path stays inside an allowed root.

`assertSafePath(path)` throws the canonical error agents see:

```typescript
"access denied: path must be inside /home/bot or /tmp (including symlink targets)"
```

(`files.ts:37-39`.) `within(path, root)` (`files.ts:12-14`) is the exact boundary helper: equal or a real path-segment prefix (no `…/bot-evil` matching `…/bot`).

---

## 🔒 Safe File Handles & Stability Checks

Three primitives underpin every operation:

- `openSafeFile(path, maxBytes)` (`files.ts:53-67`): asserts the path **and** its `realpathSync` canonicalization, then opens with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` — a final-race guard against a symlink swapped in after the check. Requires a regular file, enforces the size cap.
- `readCompleteFile(path, maxBytes = 5 MB)` (`files.ts:69-87`): reads the whole file in a loop and then **re-statss**: if the byte count or `mtime/ctime` changed mid-read it throws `"File changed while reading; retry"`.
- `text(bytes)` (`files.ts:89-92`): rejects any buffer containing a NUL byte (`"Cannot read or edit binary file"`) and strictly decodes UTF-8 (BOM-tolerant).

Size limits (`files.ts:8-10`): `MAX_FILE_BYTES = 32 MB` (reads), `MAX_EDIT_BYTES = 5 MB` (writes/edits/patches), `MAX_PAGE_BYTES = 2 MB` (single read page).

---

## 📖 `readFilePage` — Paged Reads (`files.ts:103-192`)

One handler serves both text and binary reads, selected by `encoding`:

**Text mode** (`utf8`, default):

| Parameter   | Default / Range  | Notes         |
| :---------- | :--------------- | :------------ |
| `startLine` | 1                | 1-based       |
| `endLine`   | unbounded        | ≥ `startLine` |
| `maxBytes`  | 256 KB, max 2 MB | page budget   |

- Streams the file in 64 KB chunks, feeding every byte into a SHA-256 hash of the **full file** (returned as `hash`; the guard token for `fs_edit`).
- Page assembly caps at **2000 lines** or the byte budget; a single line longer than the budget errors with `"Requested line exceeds maxBytes; increase maxBytes or use a base64 byte page"` rather than returning a silent truncation.
- Binary detection: a NUL byte anywhere in the read range throws `"Cannot read binary file"`.
- The final stat re-check (`"File changed while reading; retry"`) applies here too.
- Response: `{ path, content, encoding: "utf8", size, bytesReturned, hash, totalLines, startLine, endLine, linesReturned, truncated, hasMore, nextStartLine }` — `nextStartLine` is the resume token.

**Binary mode** (`base64`): uses `offsetBytes` instead of line ranges (mixing the two errors out) and returns `{ encoding: "base64", bytesReturned, hash, truncated, hasMore, nextOffsetBytes }`.

---

## ✍️ `atomicReplace` — The Single Mutation Path (`files.ts:194-229`)

Every write/edit/patch funnels through one crash-safe replacement sequence:

1. `assertSafePath(path)` → `mkdirSync(dirname, recursive)` → re-assert; resolve the target through `realpathSync` (existing file) or via the real parent dir (new file), assert again.
2. Refuse non-regular-file targets (`lstatSync`).
3. Write to a temp sibling `.agentd-<uuid>.tmp` with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW`, preserving the original's mode and (when root) uid/gid; `fsyncSync` before close.
4. **Pre-rename race checks**: for an existing target, `realpathSync(path)` must still equal the target and `ino/dev/mtime/ctime` must be unchanged (`"File changed during edit; retry"`); for a new file, nothing may have appeared in the meantime.
5. If `expectedHash` is provided, re-read the target and verify its SHA-256 (`"Stale hash: file changed; read it again"`).
6. `renameSync(temp, target)` — atomic on the same filesystem. The temp file is always cleaned up.

---

## 📝 `writeFileAtomic` (`files.ts:231-272`)

- `content` must be a string; `encoding` is `utf8` (default) or `base64`; `mode` defaults `0644` (validated 0–0777).
- **Overwrite guard**: replacing an existing file larger than **2048 bytes** throws unless `allowOverwriteLarge: true`:

  > `Refusing to overwrite existing file (N bytes) with fs_write. To prevent accidental truncation of files you only partially viewed, use fs_edit for targeted changes, or pass allowOverwriteLarge: true to overwrite deliberately.`

- **CRLF preservation**: if the target file uses CRLF and the incoming content is LF-only, content is converted to CRLF before writing (detected on a 16 KB sample).

---

## 🩹 `editFileAtomic` (`files.ts:284-372`)

The hash-guarded literal replacement behind `fs_edit`:

1. `truncated: true` input is refused; `oldString` must be non-empty.
2. The whole file is read via `readCompleteFile`; its SHA-256 is `previousHash`. A supplied `expectedHash` (must match `/^[a-f0-9]{64}$/`) is verified **before** any edit — the stale-edit guard against hallucinated content.
3. **Exact matches**: every occurrence of `oldString` is collected (overlapping occurrences included, capped at 10 000).
4. **Whitespace fallback** (`whitespace: true`, `files.ts:304-360`): whole-line matching only — each line is normalized by trimming leading tabs/spaces and trailing tabs/spaces/CR (never inside tokens). It handles CRLF files line-by-line, rejects CRLF search text against LF files and whitespace-only needles, enforces 100 000-line limits, requires a full contiguous line block, and matches at most once (`"Ambiguous whitespace match: provide more context"`).
5. Ambiguity rules: more than one match requires `replaceAll` (exact mode only); overlapping matches are always an error.
6. The replacement is applied right-to-left; if a whitespace-mode edit hits a pure-CRLF file, `newString` line endings are converted to CRLF to match.
7. Result: `{ ok: true, path, bytes, hash, previousHash, replacements, matchMode: "exact" | "whitespace" }`; output over `MAX_EDIT_BYTES` errors out.

---

## 🧾 Structured Patches (`files.ts:374-745`)

`patch` implements a V4A-style patch grammar for multi-file edits.

### Grammar (`parseStructuredPatch`, `files.ts:403-523`)

- Wrapped in `*** Begin Patch` / `*** End Patch`; missing markers, empty patches, or zero operations are errors. Markdown code fences are stripped (`cleanHeredoc`), and CRLF/CR are normalized.
- Sections: `*** Add File: <path>` (subsequent `+`-prefixed — or bare — lines are contents), `*** Delete File: <path>`, `*** Update File: <path>` with optional `*** Move to: <path>` and `@@ context @@`-delimited chunks whose lines are `-old` / `+new` / ` context`, plus `*** End of File` to anchor a chunk to the tail.

A minimal patch:

```text
*** Begin Patch
*** Update File: src/app.ts
@@
-export function port() {
-  return 4000
-}
+export function port() {
+  return 4100
+}
*** Add File: src/new.ts
+export const fresh = true
*** End Patch
```

Parsed results are typed as `ParsedPatch` — `{ type: "add", path, contents }`, `{ type: "delete", path }`, or `{ type: "update", path, movePath?, chunks }` where each `PatchChunk` carries `oldLines`, `newLines`, `changeContext`, and `endOfFile`.

### Matching (`findSequence` / `applyHunksToContent`, `files.ts:525-608`)

- Chunk anchors are searched in three tolerance modes, in order: `exact`, `trimEnd`, `trim` — so an agent that slightly misremembers indentation still lands.
- `endOfFile` chunks match only at the tail; an empty old-lines chunk inserts at the current cursor; `changeContext` re-anchors the cursor by locating its text first.
- A trailing empty line in `oldLines` is tolerated via a trimmed retry. CRLF files are normalized for matching and re-joined with CRLF; the file's trailing-newline state is preserved.

### Two-phase apply (`applyPatchAtomic`, `files.ts:629-745`)

1. **Validate everything in memory first**: every `add`/`delete`/`update`/`move` target is `assertSafePath`-checked, sizes are capped, deletes/updates must exist and be regular files, update chunks are applied to the in-memory content (`"Failed to find expected lines in <path>: …"` on miss). **No disk changes happen until all sections validate.**
2. **Apply**: adds/updates go through `atomicReplace` (per-file hash returned); deletes `unlinkSync`; moves write the new path then unlink the old.
3. Returns `{ ok: true, summary, files: [{ path, action: "add" | "delete" | "update" | "move", additions, deletions, bytes?, hash? }] }` with a git-style summary (`A/D/R/M path (+n/-n)`).

---

## 🧪 Tests

| File                                             | Covers                                                                     |
| :----------------------------------------------- | :------------------------------------------------------------------------- |
| `apps/computerd/test/agentd-files.test.ts`       | traversal/symlink rejection, page reads, hash-guarded edits, patch grammar |
| `apps/computerd/tests/unit/agentd-files.test.ts` | unit-level coverage of the same handlers                                   |

---

## Related docs

- [agentd: daemon & RPC surface](agentd.md)
- [agentd code intelligence](agentd-code-intelligence.md)
- [Tool: computer (fs_read / fs_edit / fs_write semantics)](../orchestrator/tools/tool-computer.md)
- [computerd overview](overview.md)
