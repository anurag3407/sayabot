# Workspace Tools (`workspace_fork`, `workspace_inspect`)

The workspace tools give a V2 computer-agent a disciplined way to experiment on a repository without disturbing the original checkout: `workspace_fork` clones a **clean** repository into a generated, detached git worktree under `/home/bot/.saaya/worktrees`, and `workspace_inspect` verifies the fork's identity and returns its status plus a base diff — with no merge, apply, or reset ever performed automatically. Both execute a hardened Python script inside the agent's computer via `client.exec`, with validation next to each git operation.

Source files: `apps/orchestrator/src/tools/builtins/workspace.ts`, `apps/orchestrator/src/computer/client.ts`, `apps/orchestrator/src/tools/builtins/workspace.test.ts`

---

## 🎛️ Registration

`workspaceTools({ agentId, orgId, roomId, profile })` returns the two tools; registered only for `computer`-capable, engine-V2 agents (`src/tools/index.ts:375-380`). Both `dangerous: false` — the tools themselves never write outside the generated worktree directory or touch the original repo's history.

## 📁 Layout and path rules (`workspace.ts:5-19`)

```typescript
export const WORKTREE_ROOT = "/home/bot/.saaya/worktrees"
```

- `absolutePath`: strings of 1–4,096 chars that must start with `/` and contain no control characters (`workspace.ts:6-10`).
- `workspaceScopeSchema` (`workspace.ts:12-19`, `.strict()`) validates the shared scope triple returned by a fork:

| Field      | Constraint                                                                                                      |
| :--------- | :-------------------------------------------------------------------------------------------------------------- |
| `repo`     | canonical absolute path (the original repository root)                                                          |
| `worktree` | must match `^/home/bot/.saaya/worktrees/[0-9a-f-]{36}$` — precisely a generated fork path under `WORKTREE_ROOT` |
| `baseSha`  | 40- or 64-char lowercase hex (git or SHA-256 checksum)                                                          |

Metadata (the fork manifest) is stored **outside the checkout** (`ROOT/.<uuid>.json`) so worker edits can never leak it into a diff (`workspace.ts:32-34`).

## 🍴 `workspace_fork` (`workspace.ts:168-175`)

| Parameter | Type          | Description                       |
| :-------- | :------------ | :-------------------------------- |
| `repo`    | absolute path | Explicit original repository root |

Guarantees enforced by the embedded script (`WORKSPACE_SCRIPT`, `workspace.ts:35-145`):

1. `repo` must be a **canonical absolute path** (`os.path.realpath(path) == path`) and a non-bare repository root (`git rev-parse --show-toplevel` equals the path).
2. The original must be **clean**: `git status --porcelain=v1 --untracked-files=all` empty, and no sparse-checkout / skip-worktree / assume-unchanged files hiding modifications (`ls-files -v` scan, `workspace.ts:66-71`). Violations → `"Original repository is dirty; commit or preserve changes explicitly before forking/inspecting"`.
3. A generated repo (`repo` inside `WORKTREE_ROOT`) cannot be forked: `"Cannot fork a generated workspace"`.
4. Creates `ROOT` with mode `0700`, then `git worktree add --detach -- <ROOT>/<uuid4> <base>`; writes the manifest JSON `{ repo, worktree, baseSha, agentId, orgId, roomId }` with an exclusive create (`"x"` mode).
5. Postcondition check: if the original `HEAD` moved during the fork, the worktree is **retained** for manual inspection and the operation fails (`"Original HEAD changed during fork; worktree retained at <path>"`, `workspace.ts:97-100`).

Returns `{ repo, worktree, baseSha, status: "forked", autoMerge: false, originalReset: false, isolation: "git_worktree_only", note }` — the note states: _"No merge, apply or reset performed. Shared git metadata and shell access are not sandboxed; ignored files are not copied."_ (`workspace.ts:138-141`)

## 🔬 `workspace_inspect` (`workspace.ts:176-182`)

| Parameter      | Type           | Default   | Description                           |
| :------------- | :------------- | :-------- | :------------------------------------ |
| `repo`         | absolute path  | —         | The original repository root          |
| `worktree`     | absolute path  | —         | Generated worktree path from the fork |
| `baseSha`      | 40/64-char hex | —         | Base commit recorded at fork time     |
| `maxDiffBytes` | int 1–200,000  | `100,000` | Cap on the returned diff payload      |

Verifications before any data is returned (`workspace.ts:107-137`):

- Manifest identity: the on-disk `.json` record must equal `{ repo, worktree, baseSha, agentId, orgId, roomId }` exactly — owner, path and base must all match (`"Workspace identity, owner or base does not match the tracked fork"`).
- Staleness: if the original repo's `HEAD` changed since the fork, inspection is refused (`"Original HEAD changed since fork; refusing stale workspace inspection"`) and re-checked _again_ after diffing, so a mid-inspection edit never yields a patch against a moved parent.
- Registration: the target must remain a **registered detached worktree** of the original repo (from `git worktree list --porcelain`), with the same git common dir; unprunable, not detached-less.
- Ancestry: `git merge-base --is-ancestor base head` must hold.

Returns:

```typescript
{
  repo, worktree, baseSha, headSha,
  status: <git status --porcelain output>,
  diff: <binary-safe `git diff --no-ext-diff --no-textconv --binary base --`, capped at maxDiffBytes>,
  diffTruncated: boolean,
  untracked: [paths],            // untracked file names listed separately
  diffIncludesUntracked: false,
  autoMerge: false, originalReset: false, isolation: "git_worktree_only", note
}
```

## ⚙️ Execution transport (`workspace.ts:153-167`)

Both tools share one `execute(operation, input, signal)`:

```typescript
await client.ensure(args.agentId, args.orgId, args.profile) // warm the computer
const result = await client.exec(
  args.agentId,
  {
    cmd: `python3 -c ${quote(WORKSPACE_SCRIPT)} ${quote(JSON.stringify({ ...parsed, ...args, operation }))}`,
    timeoutMs: 90_000,
  },
  signal,
)
if (result.exitCode !== 0 || result.truncated) {
  throw new Error(
    `workspace_${operation} failed${result.truncated ? " (output truncated)" : ""}: ${result.stderr.slice(0, 4000)}`,
  )
}
return JSON.parse(result.stdout)
```

- Git invocations inside the script run with `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C`, hooks disabled (`core.hooksPath=/dev/null`), fsmonitor and untracked cache off, external diff driver cleared — and a 45 s timeout per git call (`workspace.ts:44-52`).
- Git failures surface as `"git <subcommand> failed: <first 2000 stderr chars>"`.
- The script's stdout is a single JSON document; anything on stderr plus non-zero exit becomes the tool error.

## 🧪 Examples (from `workspace.test.ts`)

The test suite maps `WORKTREE_ROOT` onto a temp directory and runs the **real script with real git** (`workspace.test.ts:17-59`):

```typescript
tools = workspaceTools({ agentId: "agent", orgId: "org", roomId: "room", profile: "standard" })

// Fork a clean repo → { repo, worktree: WORKTREE_ROOT/<uuid>, baseSha, status: "forked" }
const scope = (await tools[0]!.execute({ repo })) as {
  repo: string
  worktree: string
  baseSha: string
}

// Inspect after editing the worktree → status/diff/untracked, diff capped by maxDiffBytes
const report = await tools[1]!.execute({
  repo: scope.repo,
  worktree: scope.worktree,
  baseSha: scope.baseSha,
  maxDiffBytes: 50_000,
})

// A dirty original refuses to fork:
// "Original repository is dirty; commit or preserve changes explicitly before forking/inspecting"
```

Typical agent sequence: `fs_read` the repo → `workspace_fork` → edit files in `worktree` (via `fs_edit`/`fs_write`) → `workspace_inspect` to obtain the exact base diff → hand the diff to review or commit via the normal git tools.

## 🗃️ Tables and events

| Concern             | Details                                                                                                                                        |
| :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| DB tables           | none — the fork manifest is a JSON file in the VM (`/home/bot/.saaya/worktrees/.<uuid>.json`); audit rows land in `tool_calls` via the wrapper |
| computerd endpoints | `/v1/computers/:agentId/ensure`, `/v1/computers/:agentId/exec`                                                                                 |
| Realtime events     | standard audit events only                                                                                                                     |

## ⚠️ Error modes

| Condition                                                | Result                                                                                                                            |
| :------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| Dirty original repo (or sparse/assume-unchanged files)   | fork fails with the "dirty" message; nothing created                                                                              |
| Repo path is a symlink, non-absolute, or not a repo root | `"Paths must be canonical absolute paths, without symlinks or traversal"` / `"repo must be an explicit non-bare repository root"` |
| Forking a generated workspace                            | `"Cannot fork a generated workspace"`                                                                                             |
| Original HEAD moved during fork/inspect                  | operation fails; a retained worktree path is reported for forks                                                                   |
| Manifest mismatch (owner/base/path)                      | `"Workspace identity, owner or base does not match the tracked fork"`                                                             |
| `git` subcommand failure / timeout                       | `"git <cmd> failed: <stderr>"`; tool-level failure wrapped as `workspace_<op> failed: …`                                          |

## ⚠️ Notes

1. **Isolation is real but bounded.** `isolation: "git_worktree_only"` means separation of _changes_, not a security sandbox: the worktree shares the repo's git metadata dir and the VM's shell. The `note` field says this explicitly, and the code comment (`workspace.ts:32-34`) calls it "change separation, not a security boundary".
2. **Never merges or resets.** Applying or discarding forked work is always an explicit agent action through other tools (`git_*`, `fs_*`); `autoMerge`/`originalReset` are constant `false` in the response.
3. **Untracked files are reported, not diffed** — `diffIncludesUntracked` is always `false`; the agent lists them and reads them separately.
4. The scope schema is exported (`workspaceScopeSchema`) so other engine components (e.g. review steps) can validate a fork triple without re-deriving the rules.

Related docs: [./tool-system.md](./tool-system.md) · [./tool-computer.md](./tool-computer.md) · [./tool-verification.md](./tool-verification.md) · [../engine/engine-verify.md](../engine/engine-verify.md) · [../../core/patch-and-fold-key.md](../../core/patch-and-fold-key.md)
