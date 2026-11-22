import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WORKTREE_ROOT, workspaceTools } from "./workspace"

const client = vi.hoisted(() => ({ ensure: vi.fn(), exec: vi.fn() }))
vi.mock("../../computer/client", () => ({ getComputerClient: () => client }))
const exec = promisify(execFile)
const owner = { agentId: "agent", orgId: "org", roomId: "room", profile: "standard" as const }
let temporary: string
let repo: string
let worktrees: string
let tools: ReturnType<typeof workspaceTools>

async function git(cwd: string, ...args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    })
  ).stdout.trim()
}
function local(path: string) {
  return path.replace(WORKTREE_ROOT, worktrees)
}
async function fork() {
  return (await tools[0]!.execute({ repo })) as { repo: string; worktree: string; baseSha: string }
}
async function inspect(scope: { repo: string; worktree: string; baseSha: string }, extra = {}) {
  return (await tools[1]!.execute({
    repo: scope.repo,
    worktree: scope.worktree,
    baseSha: scope.baseSha,
    ...extra,
  })) as Record<string, any>
}

beforeEach(async () => {
  vi.resetAllMocks()
  temporary = await realpath(await mkdtemp(join(tmpdir(), "saaya-workspace-test-")))
  repo = join(temporary, "repo space ' dollar$semicolon;")
  worktrees = join(temporary, "managed-worktrees")
  await mkdir(repo)
  await git(repo, "init", "-q")
  await writeFile(join(repo, "tracked.txt"), "original\n")
  await git(repo, "add", "tracked.txt")
  await git(repo, "commit", "-qm", "Fixture base")
  client.ensure.mockResolvedValue({ status: "running" })
  client.exec.mockImplementation(async (_id, args, signal) => {
    // Only the managed root is mapped. The production script and real git
    // commands run unchanged inside this test's temporary directory.
    try {
      const result = await exec("/bin/sh", ["-c", args.cmd.replaceAll(WORKTREE_ROOT, worktrees)], {
        signal,
        timeout: 90_000,
        maxBuffer: 2_000_000,
      })
      return {
        stdout: result.stdout.replaceAll(worktrees, WORKTREE_ROOT),
        stderr: result.stderr,
        exitCode: 0,
        durationMs: 1,
        truncated: false,
      }
    } catch (error) {
      const result = error as { stdout?: string; stderr?: string; code?: number }
      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? String(error),
        exitCode: result.code ?? 1,
        durationMs: 1,
        truncated: false,
      }
    }
  })
  tools = workspaceTools(owner)
})

afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

describe("workspace tools with real temporary git worktrees", { timeout: 25_000 }, () => {
  it("forks detached, inspects changes and never changes original files, branch or HEAD", async () => {
    const before = {
      head: await git(repo, "rev-parse", "HEAD"),
      branch: await git(repo, "symbolic-ref", "HEAD"),
    }
    const scope = await fork()
    expect(scope).toMatchObject({
      repo,
      baseSha: before.head,
      autoMerge: false,
      originalReset: false,
    })
    expect(scope.worktree).toMatch(new RegExp(`^${WORKTREE_ROOT}/[a-f0-9-]{36}$`))
    await expect(git(local(scope.worktree), "symbolic-ref", "HEAD")).rejects.toThrow()
    await writeFile(join(local(scope.worktree), "tracked.txt"), "worker change\n")
    await git(local(scope.worktree), "add", "tracked.txt")
    await writeFile(join(local(scope.worktree), "new.txt"), "untracked evidence\n")
    const result = await inspect(scope)
    expect(result.diff).toContain("-original")
    expect(result.diff).toContain("+worker change")
    expect(result.untracked).toEqual(["new.txt"])
    expect(result.diffIncludesUntracked).toBe(false)
    expect(result.status).toContain("M  tracked.txt")
    expect(result).toMatchObject({
      autoMerge: false,
      originalReset: false,
      isolation: "git_worktree_only",
    })
    expect(await git(repo, "status", "--porcelain")).toBe("")
    expect(await git(repo, "rev-parse", "HEAD")).toBe(before.head)
    expect(await git(repo, "symbolic-ref", "HEAD")).toBe(before.branch)
    expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe("original\n")
    expect(client.ensure).toHaveBeenCalledWith(owner.agentId, owner.orgId, owner.profile)
    expect(tools.map((t) => t.name)).toEqual(["workspace_fork", "workspace_inspect"])
  })

  it.each(["unstaged", "staged", "untracked"])(
    "refuses a %s original without dropping changes",
    async (kind) => {
      const file = join(repo, kind === "untracked" ? "new.txt" : "tracked.txt")
      await writeFile(file, "must survive\n")
      if (kind === "staged") await git(repo, "add", "tracked.txt")
      const before = await git(repo, "status", "--porcelain")
      await expect(fork()).rejects.toThrow("dirty")
      expect(await readFile(file, "utf8")).toBe("must survive\n")
      expect(await git(repo, "status", "--porcelain")).toBe(before)
      expect(await git(repo, "worktree", "list", "--porcelain")).not.toContain(worktrees)
    },
  )

  it("refuses hidden assume-unchanged modifications", async () => {
    await git(repo, "update-index", "--assume-unchanged", "tracked.txt")
    await writeFile(join(repo, "tracked.txt"), "hidden modification\n")
    await expect(fork()).rejects.toThrow("assume-unchanged")
  })

  it("rejects dirty and stale parents on inspection, without reset", async () => {
    const scope = await fork()
    await writeFile(join(repo, "tracked.txt"), "parent edit\n")
    await expect(inspect(scope)).rejects.toThrow("dirty")
    await git(repo, "add", "tracked.txt")
    await git(repo, "commit", "-qm", "Parent advances")
    const newHead = await git(repo, "rev-parse", "HEAD")
    await expect(inspect(scope)).rejects.toThrow("Original HEAD changed")
    expect(await git(repo, "rev-parse", "HEAD")).toBe(newHead)
    expect(await readFile(join(repo, "tracked.txt"), "utf8")).toBe("parent edit\n")
  })

  it("rejects forged base, ownership and unregistered target", async () => {
    const scope = await fork()
    await expect(inspect({ ...scope, baseSha: "0".repeat(40) })).rejects.toThrow("does not match")
    const otherRoom = workspaceTools({ ...owner, roomId: "other-room" })
    await expect(
      otherRoom[1]!.execute({ repo, worktree: scope.worktree, baseSha: scope.baseSha }),
    ).rejects.toThrow("does not match")
    const foreign = `${WORKTREE_ROOT}/00000000-0000-4000-8000-000000000000`
    await mkdir(local(foreign))
    await expect(inspect({ ...scope, worktree: foreign })).rejects.toThrow("failed")
    const metadata = join(worktrees, `.${scope.worktree.split("/").at(-1)}.json`)
    const forged = JSON.parse(await readFile(metadata, "utf8"))
    forged.worktree = local(foreign)
    await writeFile(
      join(worktrees, ".00000000-0000-4000-8000-000000000000.json"),
      JSON.stringify(forged),
    )
    // Even a copied manifest cannot turn an arbitrary directory into a worktree.
    await expect(inspect({ ...scope, worktree: foreign })).rejects.toThrow("failed")
  })

  it("accepts descendant commits but rejects a detached head with unrelated ancestry", async () => {
    const scope = await fork()
    const target = local(scope.worktree)
    await writeFile(join(target, "tracked.txt"), "committed worker change\n")
    await git(target, "add", "tracked.txt")
    await git(target, "commit", "-qm", "Worker change")
    expect((await inspect(scope)).diff).toContain("+committed worker change")
    const tree = await git(target, "rev-parse", "HEAD^{tree}")
    const unrelated = await git(target, "commit-tree", tree, "-m", "Unrelated fixture")
    await git(target, "update-ref", "--no-deref", "HEAD", unrelated)
    await expect(inspect(scope)).rejects.toThrow("merge-base failed")
    expect(await git(repo, "rev-parse", "HEAD")).toBe(scope.baseSha)
  }, 20_000)

  it("rejects symlink repository paths and generated targets", async () => {
    const alias = join(temporary, "alias")
    await symlink(repo, alias)
    await expect(tools[0]!.execute({ repo: alias })).rejects.toThrow("canonical")
    const scope = await fork()
    const fake = `${WORKTREE_ROOT}/00000000-0000-4000-8000-000000000000`
    await symlink(local(scope.worktree), local(fake))
    await expect(inspect({ ...scope, worktree: fake })).rejects.toThrow("canonical")
  })

  it("bounds diff output and reports truncation explicitly", async () => {
    const scope = await fork()
    await writeFile(join(local(scope.worktree), "tracked.txt"), "a".repeat(1000))
    const result = await inspect(scope, { maxDiffBytes: 30 })
    expect(Buffer.byteLength(result.diff)).toBeLessThanOrEqual(30)
    expect(result.diffTruncated).toBe(true)
  })

  it("fails on exec errors/truncated transport output, invalid input and cancellation", async () => {
    await expect(tools[0]!.execute({ repo: "relative" })).rejects.toThrow()
    await expect(tools[0]!.execute({ repo: `${repo}\n` })).rejects.toThrow()
    await expect(
      tools[1]!.execute({ repo, worktree: `${WORKTREE_ROOT}/../escape`, baseSha: "0".repeat(40) }),
    ).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(tools[0]!.execute({ repo }, controller.signal)).rejects.toThrow()
    expect(client.exec).not.toHaveBeenCalled()
    client.exec.mockResolvedValueOnce({
      stdout: "{}",
      stderr: "git failed",
      exitCode: 1,
      truncated: false,
    })
    await expect(fork()).rejects.toThrow("git failed")
    client.exec.mockResolvedValueOnce({ stdout: "{}", stderr: "", exitCode: 0, truncated: true })
    await expect(fork()).rejects.toThrow("truncated")
  })
})
