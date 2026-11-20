# agentd — Code Intelligence

`code-intelligence.ts` runs the TypeScript compiler's language service **inside the sandbox** to power the `code_outline`, `code_definition`, `code_references`, `code_diagnostics`, and `code_rename_preview` tools. Each request builds a fresh, bounded language service over the project — no tsserver, no watchers, no emit — with hard limits on time, bytes, files and directory entries so an agent can never hang its own computer with a runaway analysis.

Source files: `apps/computerd/agentd/code-intelligence.ts`

---

## 📥 Requests & Budgets

`codeIntelligence(req: CodeRequest)` (`code-intelligence.ts:24`) is dispatched from agentd's `op: "code"` handler:

```typescript
interface CodeRequest {
  action: "outline" | "definition" | "references" | "diagnostics" | "rename_preview"
  path: string // the TS/JS file to analyse (required)
  projectRoot?: string // default: nearest tsconfig.json / jsconfig.json walk-up
  line?: number
  column?: number // 1-based UTF-16 positions (position-based actions)
  newName?: string // rename_preview only
  maxResults?: number // default 200, hard max 1000
}
```

| Budget                    | Value                                               | Enforced by                                                                                                                                                                  |
| :------------------------ | :-------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source file size          | 2 MB (`MAX_FILE`)                                   | `read()` via `readCompleteFile`                                                                                                                                              |
| Total project bytes       | 24 MB (`MAX_PROJECT`)                               | `read()` throws `Project exceeds code intelligence size limit; narrow projectRoot`                                                                                           |
| Project files             | 512 (`MAX_FILES`)                                   | file scan and final program                                                                                                                                                  |
| Directory entries scanned | 20 000 (`MAX_ENTRIES`)                              | `readDirectory` scan                                                                                                                                                         |
| Results per action        | `maxResults` (1–1000, default 200)                  | `page()` slicing + `truncated` flag                                                                                                                                          |
| Wall time                 | **10 s** (`deadline`, `code-intelligence.ts:67-70`) | `checkBudget()` called on every stat/read/scan and via the language service cancellation token; timeout message: `Code intelligence time limit exceeded; narrow projectRoot` |

Only `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` files are accepted (`sourceExtension`, `code-intelligence.ts:21`); anything else errors with `Code intelligence supports TypeScript and JavaScript files only`.

---

## 🗺️ Project Resolution & Sandboxing

1. `assertSafePath(req.path)` then `realpathSync` — the target file must live inside `/home/bot` or `/tmp` (see [agentd-files.md](agentd-files.md)).
2. **Config discovery**: with no explicit `projectRoot`, the service walks up from the file's directory while `isSafePath(dir)` holds, looking for `tsconfig.json` or `jsconfig.json`; the first config found sets the root. An explicit `projectRoot` is checked for a config directly. Config symlinks that escape the sandbox are rejected even during discovery (`code-intelligence.ts:37-39`).
3. The root is canonicalized and the file must be inside it (`File must be inside projectRoot`).
4. **Read gating** (`permitted`, `code-intelligence.ts:72-80`): a path is readable only if absolute, inside the root, `isSafePath`, and its realpath stays within the root. One exception: the TypeScript compiler's own immutable `lib*.d.ts` files (identified by directory == the installed compiler's lib dir) may be read with `O_NOFOLLOW` regardless of location — type checking is impossible without them.
5. **Directory scan** (`readDirectory`, `code-intelligence.ts:121-153`): `opendirSync`-based, `.git` and `node_modules` always skipped, 64-level depth cap, realpath de-duplication, include/exclude glob matching (extensionless include patterns become recursive `**/*`, mirroring tsconfig semantics), and `MAX_FILES`/`MAX_ENTRIES` enforcement.
6. With a valid config, compiler options come from `ts.parseJsonConfigFileContent` (errors become a thrown, human-readable list) with `allowJs` forced on; project **references are not followed** — the service is deliberately restricted to this root. Without a config, all TS/JS files under the root are the project. `noEmit`, no incremental, no plugins are forced (`code-intelligence.ts:173`).
7. The analysed file is always added to the program; all files are `read()` up front so budget violations surface before analysis.

The `ts.LanguageServiceHost` (`code-intelligence.ts:180-192`) wires the same gated `readDirectory`/`read`/`realpath` and a cancellation token backed by the 10 s deadline. `getScriptVersion` returns a constant — everything is loaded once per request, then disposed (`service.dispose()` in the `finally`).

---

## 📖 The Gated Reader

`read(path)` (`code-intelligence.ts:86-115`) is every byte that enters the compiler:

```typescript
const read = (path: string): string | undefined => {
  checkBudget()
  if (!exists(path)) return undefined
  const canonical = realpathSync(path)
  if (cache.has(canonical)) return cache.get(canonical)
  let bytes: Buffer
  if (isLibrary(canonical)) {
    // Only the installed compiler's immutable lib*.d.ts files get this exception.
    const fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW)
    // … size-capped, fully-read …
  } else {
    bytes = readCompleteFile(canonical, MAX_FILE) // shares agentd's stability-checked reader
  }
  projectBytes += bytes.length
  if (cache.size >= MAX_FILES || projectBytes > MAX_PROJECT)
    throw new Error("Project exceeds code intelligence size limit; narrow projectRoot")
  if (bytes.includes(0)) throw new Error("Binary source/config file")
  const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  cache.set(canonical, value)
  return value
}
```

Key properties:

- **Per-request cache keyed by canonical path** — two include patterns resolving to the same real file are read and charged once.
- **Binary rejection before decode** — a NUL byte anywhere aborts the request, so the compiler never sees content `fs_read` couldn't have shown the agent.
- **The lib.d.ts exception is tight**: only files whose directory equals the installed compiler's lib directory and whose name matches `/^lib[\w.-]*\.d\.ts$/`, read with `O_NOFOLLOW` and required to be their own realpath — an agent cannot plant a file to masquerade as a library.
- **Budgets are checked on every read** (`projectBytes`, `cache.size`), so limits cannot be exceeded even mid-scan.

---

## 🧾 Example Requests & Responses

```jsonc
// op: "code" — outline
{ "op": "code", "action": "outline", "path": "/home/bot/app/src/server.ts" }
// →
{ "engine": "typescript", "projectRoot": "/home/bot/app", "configPath": "/home/bot/app/tsconfig.json",
  "path": "/home/bot/app/src/server.ts", "hash": "9f2c…",
  "items": [ { "name": "startServer", "kind": "function", "container": null,
               "range": { "path": "…", "start": { "line": 12, "column": 1 }, "end": { "line": 30, "column": 2 } } } ],
  "total": 1, "truncated": false }

// op: "code" — definition at 1-based line/column
{ "op": "code", "action": "definition", "path": "/home/bot/app/src/server.ts", "line": 14, "column": 20 }
// → { …, "items": [ { "path": "/home/bot/app/src/config.ts", "start": {…}, "end": {…}, "name": "PORT", "kind": "const" } ], … }

// op: "code" — rename preview
{ "op": "code", "action": "rename_preview", "path": "…", "line": 14, "column": 20, "newName": "listenPort" }
// → { …, "canRename": true, "preview": true, "newName": "listenPort",
//     "edits": [ { "path": "…", "start": {…}, "end": {…}, "hash": "…", "oldText": "PORT", "newText": "listenPort" } ],
//     "total": 1, "truncated": false }
```

Errors are plain agentd error frames (HTTP 422 when reached through computerd): unknown actions, non-TS/JS files, budget overruns, and path escapes all surface as readable messages rather than stack traces.

---

## 🔍 The Five Actions

Every response embeds a `base` object (`code-intelligence.ts:205`):

```typescript
{ engine: "typescript", projectRoot: root, configPath: config ?? null, path: file, hash: hashBytes(source.text) }
```

and wraps results through `page()` → `{ items, total, truncated }`. Ranges are 1-based `{ start: { line, column }, end: { line, column } }` converted from compiler spans via `location()` — which also re-validates that every result path is still permitted (`Result path escapes allowed projectRoot`).

| Action                        | Implementation                                                                                                                                    | Returns                                                                                                |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------- |
| `outline` (`:217-229`)        | Walks `service.getNavigationTree(file)` — AST-derived declarations, not text matching — collecting `{ name, kind, container, range }` recursively | declaration tree with container names                                                                  |
| `definition` (`:230-233`)     | `getDefinitionAtPosition(file, position())`                                                                                                       | `{ name, kind, range }` per definition                                                                 |
| `references` (`:234-237`)     | `getReferencesAtPosition`                                                                                                                         | references with `isWriteAccess` markers                                                                |
| `diagnostics` (`:238-242`)    | Concatenates config errors, compiler-options diagnostics, syntactic and semantic diagnostics                                                      | `{ code, category: "error" \| "warning" \| …, message, range? }` — type errors without running a build |
| `rename_preview` (`:243-262`) | see below                                                                                                                                         | a full preview of edits, **no rename executed**                                                        |

`position()` (`code-intelligence.ts:207-216`) validates 1-based UTF-16 `line`/`column` (`line and column must be positive 1-based UTF-16 positions`), handles CRLF line ends when computing line boundaries, and rejects out-of-range positions (`line is out of range`, `column is out of range`).

### `outline` details

The navigation tree is TypeScript's own navigation structure — classes, functions, methods, interfaces, types, properties — so the outline matches what an IDE shows, including nested members. `container` carries the enclosing declaration's name (or `null` at top level), which lets agents reconstruct qualified names (`MyClass.method`) without a second request.

### `diagnostics` details

One call returns four diagnostic families concatenated: tsconfig parse errors (collected during config loading), compiler-options diagnostics, syntactic diagnostics for the file, and semantic (type) diagnostics for the file. `category` is lowercased (`"error"`, `"warning"`, `"suggestion"`, `"message"`), messages are flattened to a single line, and diagnostics with a known file position carry a `range`. Because the whole program was loaded, semantic diagnostics see the project's real types — not just the single file.

### `rename_preview` specifics

1. `newName` must be a real identifier: validated with `ts.createScanner` (a full scan must produce exactly one Identifier token then EOF) and capped at 200 chars.
2. `getRenameInfo` decides renamability; `canRename: false` returns `{ canRename: false, reason, edits: [] }` instead of an error.
3. `findRenameLocations` produces the edit set; if it exceeds `maxResults` the whole preview is refused (`Rename preview has N edits, exceeding maxResults; no partial rename returned`) — no partial renames.
4. Each edit is `{ range, hash: <SHA-256 of the target file>, oldText, newText }` where `newText` re-attaches the compiler's `prefixText`/`suffixText` (e.g. `'` + name for quoted property names). Renaming inside installed TypeScript library declarations is an explicit error.
5. The per-file `hash` lets the agent feed each `oldText`/`hash` pair into `fs_edit` (`expectedHash`) to apply the rename atomically, file by file — the preview is designed to compose with the file tools.

---

## 🧪 Tests

- `apps/computerd/test/code-intelligence.test.ts` — outline/definition/references/diagnostics/rename preview against fixture projects, budget and path-safety rejections.
- The orchestrator-facing wrapper for these ops is `code_outline` / `code_definition` / `code_references` / `code_diagnostics` / `code_rename_preview` — see [Tool: computer](../orchestrator/tools/tool-computer.md).

## ⚠️ Design Constraints Worth Knowing

- **Fresh service per request**: nothing is cached between calls. A five-tool sequence over the same project pays the parse cost five times; this is the price for a service that can never leak stale state or grow memory unboundedly inside a long-lived agent computer. The per-request flow is: validate path → discover config → gated directory scan → gated pre-read of all files → create language service → run the requested query → dispose.
- **Project references are not followed**: a monorepo rooted above `projectRoot` is invisible; analysis sees one root only. Agents should pass the workspace package directory as `projectRoot` and rely on `tsconfig.json` discovery for the rest.
- **`node_modules` is never scanned**: type information for imported packages comes only from what tsconfig's own `paths`/`types` resolve to within the gated reader — dependencies are typed through their `.d.ts` resolution but their directories are not walked.
- **The 10 s deadline is absolute**: large projects that approach `MAX_PROJECT`/`MAX_FILES` should narrow `projectRoot` rather than retry — the error messages are written to steer agents toward that fix.
- **Binary or non-UTF-8 sources abort the request** (`Binary source/config file`), keeping the compiler's view identical to what `fs_read` can show the agent.

---

## Related docs

- [agentd: daemon & RPC surface](agentd.md)
- [agentd file operations & path safety](agentd-files.md)
- [Code intelligence tools](../../tools-and-sandboxes.md)
- [Tool: computer](../orchestrator/tools/tool-computer.md)
