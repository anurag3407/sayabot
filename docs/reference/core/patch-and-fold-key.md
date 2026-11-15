# Canvas Patching & Fold Keys

This reference documents two small but load-bearing algorithms in `@sayabot/core`: the sequential search/replace planner that lets agents patch a shared canvas document safely (`patch.ts`), and the deterministic folding keys that collapse duplicate questions in UI threads (`fold-key.ts`). Both are pure, dependency-free functions that must produce byte-identical results on client and server.

Source files: `packages/core/src/patch.ts`, `packages/core/src/fold-key.ts` (tests: `patch.test.ts`, `fold-key.test.ts`)

---

## 🩹 Canvas Patch Planning (`patch.ts`)

Agents edit the live shared canvas by submitting **search/replace edits**, not raw overwrites. `planCanvasPatch` is the planner that converts those edits into a safe execution plan for Yjs.

### Types

```typescript
export interface CanvasEdit {
  search: string   // exact substring to find — must match exactly once
  replace: string  // what to put in its place
}

export interface CanvasSplice {
  from: number     // start offset in the text as it exists at this point in the sequence
  to: number       // end offset (exclusive)
  insert: string   // the replacement text
}

export interface CanvasPatchPlan {
  text: string             // the fully patched document
  splices: CanvasSplice[]  // positional operations, in application order
}

export class CanvasPatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CanvasPatchError"
  }
}
```

### The algorithm

`planCanvasPatch(snapshot: string, edits: CanvasEdit[]): CanvasPatchPlan` (`packages/core/src/patch.ts:39`) walks the edits **sequentially against an evolving text**:

1. Start with `text = snapshot`.
2. For each edit `i` (1-based in error messages):
   - Reject an empty or non-string `search` → `CanvasPatchError("edit N: search must not be empty")`.
   - Count occurrences of `search` in the *current* `text` (`countOccurrences`, `patch.ts:24` — a non-overlapping `indexOf` loop advancing by `needle.length`).
   - `0` matches → `CanvasPatchError("edit N: search text not found")`.
   - More than `1` match → `CanvasPatchError("edit N: search text matched M times; make it unique")`. Uniqueness is enforced so the patch is deterministic and cannot clobber the wrong region.
   - Locate `from = text.indexOf(search)`, `to = from + search.length`, splice in `replace`, and record `{ from, to, insert: replace }`.
3. Return the final `text` and the splice list.

The critical invariant (stated in the doc comment at `patch.ts:34`): **splice positions refer to the evolving text, not the original snapshot**. Because each splice describes the text exactly as it exists when that edit runs, applying the splices in order to a `Y.Text` (or any positional string representation) reproduces the planned result. Downstream code applies them back-to-front or in order on the live Yjs type; the planner itself never touches Yjs.

### Behaviour matrix (from `patch.test.ts`)

| Input | Result |
| :--- | :--- |
| `edits` is empty | Plan is `{ text: snapshot, splices: [] }` — snapshot returned unchanged. |
| Unique match | Replacement applied; e.g. replacing `"migration"` at offset 17 in `# Plan\n\nShip the migration.\n\nRun the tests.` yields splice `{ from: 17, to: 26, insert: "rollback" }`. |
| Edit 2 references text created by edit 1 | Works — later edits see earlier replacements (`"Run the tests."` → `"Run all tests twice."`, then `"all tests"` → `"the full suite"`). |
| Search matches twice | Throws `CanvasPatchError` with the match count. |
| Search matches zero times | Throws `CanvasPatchError("... search text not found")`. |
| Empty search | Throws `CanvasPatchError("... search must not be empty")`. |

There is no fuzzy matching, no whitespace tolerance, and no regex support — matching is exact substring equality, which is what makes the plan safe to apply on a concurrently-edited Yjs document after a snapshot check.

---

## 🔑 Question Fold Keys (`fold-key.ts`)

When an agent asks a human a question, the UI groups repeated asks of the *same* question into one folded thread instead of spamming the room. `fold-key.ts` derives the grouping key.

### `normalizeQuestion(text)` (`fold-key.ts:8`)

Produces a canonical form of the question so rewordings with common framing collapse to the same key:

1. Lowercase the text.
2. Replace every non-`[a-z0-9\s]` character with a space (punctuation and emoji become separators), then collapse whitespace and trim.
3. Iteratively strip framing prefixes — the loop repeats until the string stops changing, so stacked prefixes like `"hey please could you"` all come off in one pass:
   ```
   ^(hey|hi|hello|please|could you|can you|do you|question|urgent)\s+
   ```
4. Return the normalized remainder (empty string for empty input).

Examples verified by `fold-key.test.ts`:

| Input | Output |
| :--- | :--- |
| `Hey, can you please approve the budget?` | `approve the budget` |
| `Question: what database should we use???` | `what database should we use` |
| `   urgent:   please review PR #123  ` | `review pr 123` |

### `hash128(text)` — internal FNV-1a variant (`fold-key.ts:33`)

A deterministic **128-bit hash expressed as 32 hex chars**, built from two interleaved 32-bit FNV-1a lanes. It deliberately avoids `node:crypto` so the same key can be computed in the browser, on the orchestrator, and in React Native:

```typescript
let h1 = 0x811c9dc5
let h2 = 0x811c9dc5 ^ 0x5a5a5a5a
// per char: h1 ^= ch; h1 = Math.imul(h1, 0x01000193)
//           h2 ^= ch; h2 = Math.imul(h2, 0x01000193); h2 ^= h1 >>> 16
```

The four 8-char output words are `h1`, `h2`, `h1 ^ h2`, and `Math.imul(h1, 31) + h2` — mixing the two lanes so the combined digest resists the clustering a single 32-bit FNV would show on short question strings. This is a dedup/folding key, not a cryptographic hash.

### `computeFoldKey(question, explicitFoldKey?)` (`fold-key.ts:56`)

The public entry point:

1. If `explicitFoldKey` is a non-blank string, return it **trimmed and lowercased** — callers (e.g. the asks protocol) can pin a question to a specific thread.
2. Otherwise return `hash128(normalizeQuestion(question))`.

Consequence: `"Can you please approve the AWS budget?"`, `"Hey, approve the AWS budget!"` and `"approve the aws budget"` all produce the identical key, while a question with different normalized content gets a different key. Two questions that normalize identically but differ only in pleasantries will fold together — that is the intended behaviour.

---

## How they fit together

- `planCanvasPatch` runs inside the orchestrator's `canvas_patch` tool flow: the agent proposes edits, the core package validates them against the latest snapshot, and only a fully-valid plan is applied to the Yjs document (all-or-nothing — a single bad edit aborts the whole patch before anything is written).
- `computeFoldKey` is used by the asks/ask-response protocol and the web UI to decide whether a new agent question joins an existing folded thread or opens a new one.

Related docs: [./turns.md](./turns.md), [./asks.md](./asks.md), [./redact-and-breakers.md](./redact-and-breakers.md)
