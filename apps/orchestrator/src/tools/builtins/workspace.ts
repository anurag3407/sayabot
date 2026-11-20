import { z } from "zod"
import { getComputerClient } from "../../computer/client"
import type { ToolSpec } from "../audited"

export const WORKTREE_ROOT = "/home/bot/.saaya/worktrees"
const absolutePath = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    (value) => value.startsWith("/") && !/[\x00-\x1f\x7f]/.test(value),
    "Expected an absolute path without control characters",
  )

export const workspaceScopeSchema = z
  .object({
    repo: absolutePath.describe("Explicit original repository root"),
    worktree: absolutePath.refine(
      (value) => new RegExp(`^${WORKTREE_ROOT.replace(/\./g, "\\.")}/[0-9a-f-]{36}$`).test(value),
      "Expected a generated workspace_fork worktree path",
    ),
    baseSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  })
  .strict()

export interface WorkspaceToolsArgs {
  agentId: string
  orgId: string
  roomId: string
  profile: "standard" | "browser"
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// One remote operation keeps validation next to the git operation. Metadata is
// outside the checkout so worker edits cannot accidentally include it in a diff.
// This is change separation, not a security boundary against arbitrary shell use.
const WORKSPACE_SCRIPT = String.raw`
import json, os, pathlib, re, subprocess, sys, uuid

ROOT = "/home/bot/.saaya/worktrees"
a = json.loads(sys.argv[1])

def fail(message):
    raise RuntimeError(message)

def git(path, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0", "LC_ALL": "C"})
    p = subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
                        "-c", "diff.external=", "-c", "core.untrackedCache=false", "-C", path, *args],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=45)
    if p.returncode != 0:
        fail("git " + args[0] + " failed: " + p.stderr.decode("utf-8", "replace")[:2000])
    return p.stdout.decode("utf-8", "replace")

def canonical(path):
    if not os.path.isabs(path) or os.path.realpath(path) != path:
        fail("Paths must be canonical absolute paths, without symlinks or traversal")
    return path

def repository(path):
    canonical(path)
    if not os.path.isdir(path) or git(path, "rev-parse", "--show-toplevel").strip() != path:
        fail("repo must be an explicit non-bare repository root")
    return git(path, "rev-parse", "--verify", "HEAD^{commit}").strip()

def clean(path):
    # These flags can hide modified tracked files from status.
    entries = git(path, "ls-files", "-v", "-z").split("\0")
    if any(e and (e[0].islower() or e[0] == "S") for e in entries):
        fail("Refusing sparse/skip-worktree or assume-unchanged files")
    if git(path, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"):
        fail("Original repository is dirty; commit or preserve changes explicitly before forking/inspecting")

def registered(repo, worktree):
    records = git(repo, "worktree", "list", "--porcelain", "-z").split("\0\0")
    for record in records:
        fields = record.split("\0")
        if "worktree " + worktree in fields:
            if "detached" not in fields or any(f.startswith("prunable") for f in fields):
                fail("Target must remain a registered detached worktree")
            return
    fail("Target is not a registered worktree of the original repository")

try:
    repo = canonical(a["repo"])
    base = repository(repo)
    clean(repo)
    canonical(ROOT)
    owner = {k: a[k] for k in ("agentId", "orgId", "roomId")}
    if a["operation"] == "fork":
        if repo == ROOT or repo.startswith(ROOT + "/"):
            fail("Cannot fork a generated workspace")
        os.makedirs(ROOT, mode=0o700, exist_ok=True)
        worktree = ROOT + "/" + str(uuid.uuid4())
        manifest = ROOT + "/." + os.path.basename(worktree) + ".json"
        git(repo, "worktree", "add", "--detach", "--", worktree, base)
        # A concurrent edit never gets silently dropped or reset. Leave the new
        # checkout available for manual inspection if this postcondition fails.
        if repository(repo) != base:
            fail("Original HEAD changed during fork; worktree retained at " + worktree)
        clean(repo)
        registered(repo, worktree)
        record = {"repo": repo, "worktree": worktree, "baseSha": base, **owner}
        with open(manifest, "x", encoding="utf-8") as f:
            json.dump(record, f)
        result = {"repo": repo, "worktree": worktree, "baseSha": base, "status": "forked"}
    else:
        worktree = canonical(a["worktree"])
        if not re.fullmatch(re.escape(ROOT) + r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", worktree):
            fail("Target is not a generated workspace path")
        manifest = ROOT + "/." + os.path.basename(worktree) + ".json"
        canonical(manifest)
        with open(manifest, encoding="utf-8") as f:
            record = json.load(f)
        expected = {"repo": repo, "worktree": worktree, "baseSha": a["baseSha"], **owner}
        if record != expected:
            fail("Workspace identity, owner or base does not match the tracked fork")
        if base != record["baseSha"]:
            fail("Original HEAD changed since fork; refusing stale workspace inspection")
        head = repository(worktree)
        registered(repo, worktree)
        common = lambda p: os.path.realpath(os.path.join(p, git(p, "rev-parse", "--git-common-dir").strip()))
        if common(repo) != common(worktree):
            fail("Worktree belongs to a different repository")
        git(worktree, "merge-base", "--is-ancestor", base, head)
        status = git(worktree, "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none")
        diff = git(worktree, "diff", "--no-ext-diff", "--no-textconv", "--binary", base, "--")
        untracked = git(worktree, "ls-files", "--others", "--exclude-standard", "-z").split("\0")
        # Do not present a patch against a parent that changed during inspection.
        if repository(repo) != base:
            fail("Original HEAD changed during inspection")
        clean(repo)
        limit = a["maxDiffBytes"]
        raw = diff.encode("utf-8")
        result = {"repo": repo, "worktree": worktree, "baseSha": base, "headSha": head,
                  "status": status, "diff": raw[:limit].decode("utf-8", "replace"),
                  "diffTruncated": len(raw) > limit, "untracked": [p for p in untracked if p],
                  "diffIncludesUntracked": False}
    result.update({"autoMerge": False, "originalReset": False,
                   "isolation": "git_worktree_only",
                   "note": "No merge, apply or reset performed. Shared git metadata and shell access are not sandboxed; ignored files are not copied."})
    print(json.dumps(result))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`

export function workspaceTools(args: WorkspaceToolsArgs): ToolSpec[] {
  const client = getComputerClient()
  const forkSchema = z.object({ repo: absolutePath }).strict()
  const inspectSchema = workspaceScopeSchema.extend({
    maxDiffBytes: z.number().int().min(1).max(200_000).default(100_000),
  })
  const execute = async (operation: "fork" | "inspect", input: unknown, signal?: AbortSignal) => {
    const parsed = operation === "fork" ? forkSchema.parse(input) : inspectSchema.parse(input)
    signal?.throwIfAborted()
    await client.ensure(args.agentId, args.orgId, args.profile)
    signal?.throwIfAborted()
    const result = await client.exec(
      args.agentId,
      {
        cmd: `python3 -c ${quote(WORKSPACE_SCRIPT)} ${quote(JSON.stringify({ ...parsed, ...args, operation }))}`,
        timeoutMs: 90_000,
      },
      signal,
    )
    signal?.throwIfAborted()
    if (result.exitCode !== 0 || result.truncated) {
      throw new Error(
        `workspace_${operation} failed${result.truncated ? " (output truncated)" : ""}: ${result.stderr.slice(0, 4000)}`,
      )
    }
    return JSON.parse(result.stdout) as Record<string, unknown>
  }
  return [
    {
      name: "workspace_fork",
      description:
        "Fork a CLEAN explicit git repository into a generated detached worktree under /home/bot/.saaya/worktrees. Refuses dirty originals; returns repo/worktree/baseSha. No automatic merge, apply or reset. Shared shell access is not isolated.",
      schema: forkSchema,
      dangerous: false,
      execute: (input, signal) => execute("fork", input, signal),
    },
    {
      name: "workspace_inspect",
      description:
        "Read status and base diff in a tracked generated worktree. Verifies owner, path, git registration, ancestry and a clean unchanged original. Untracked file names are reported separately, not included in the patch. Never merges or resets.",
      schema: inspectSchema,
      dangerous: false,
      execute: (input, signal) => execute("inspect", input, signal),
    },
  ]
}
