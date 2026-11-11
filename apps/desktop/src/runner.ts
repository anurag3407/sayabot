import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { DesktopHost } from "./host"
import { findBinary } from "./local-agents"

/**
 * The local runner: agents set to "run on this computer" answer through Claude Code, Codex,
 * Gemini CLI or OpenCode signed in here, on the person's own subscription. Each agent works in
 * its own folder (~/Sayabot/agents/<handle>) and the apps run with their default (non-bypassed)
 * permission modes, so nothing outside that folder is changed without the app asking.
 */

interface Job {
  id: string
  prompt: string
  app: string
  agentHandle: string
}

const MAX_RUNTIME_MS = 14 * 60_000
const PROGRESS_MS = 1_500
const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin"), path.join(os.homedir(), ".bun/bin"), path.join(os.homedir(), ".npm-global/bin")]

/** argv + whether the prompt goes on stdin, per app. */
export function commandFor(app: string, prompt: string, lastMessageFile: string): { bin: string; args: string[]; stdin: string | null } {
  switch (app) {
    case "codex":
      // Read-only sandbox by default; "-" reads the prompt from stdin; the last message file holds the clean answer.
      return { bin: "codex", args: ["exec", "--skip-git-repo-check", "--output-last-message", lastMessageFile, "-"], stdin: prompt }
    case "gemini":
      return { bin: "gemini", args: ["-p", "Answer the request given on standard input."], stdin: prompt }
    case "opencode":
      return { bin: "opencode", args: ["run", prompt.slice(-100_000)], stdin: null }
    case "claude-code":
    default:
      return { bin: "claude", args: ["-p", "--output-format", "text"], stdin: prompt }
  }
}

function agentFolder(handle: string): string {
  const safe = handle.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "agent"
  const dir = path.join(os.homedir(), "Sayabot", "agents", safe)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export class LocalRunner {
  private busy = false
  private child: ChildProcess | null = null

  constructor(private host: DesktopHost) {}

  get running(): boolean {
    return this.busy
  }

  /** Called after each heartbeat; runs one job at a time. */
  async maybeRun(queuedJobs: number, enabled: boolean): Promise<void> {
    if (this.busy || !enabled || queuedJobs <= 0) return
    this.busy = true
    try {
      const claimed = await this.host.post<{ job: Job | null }>("/api/desktop/jobs/claim", {})
      if (claimed?.job) await this.run(claimed.job)
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    this.child?.kill("SIGTERM")
  }

  private async run(job: Job): Promise<void> {
    const lastMessageFile = path.join(os.tmpdir(), `sayabot-${job.id}.txt`)
    const cmd = commandFor(job.app, job.prompt, lastMessageFile)
    const bin = await findBinary(cmd.bin)
    if (!bin) {
      await this.host.post(`/api/desktop/jobs/${job.id}`, { status: "failed", error: `${cmd.bin} isn't installed on this computer.` })
      return
    }
    let output = ""
    let stderr = ""
    let cancelled = false
    // The app's own folder first: nvm-installed CLIs are Node scripts that need that folder's `node`.
    const env = { ...process.env, PATH: [path.dirname(bin), ...EXTRA_PATH, process.env.PATH ?? ""].join(path.delimiter), NO_COLOR: "1" }
    const child = spawn(bin, cmd.args, { cwd: agentFolder(job.agentHandle), env, stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (output.length > 200_000) output = output.slice(-200_000)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4_000)
    })
    if (cmd.stdin !== null) child.stdin?.end(cmd.stdin)
    else child.stdin?.end()

    let lastSent = ""
    const progress = setInterval(async () => {
      if (output === lastSent) return
      lastSent = output
      const reply = await this.host.post<{ cancelled?: boolean }>(`/api/desktop/jobs/${job.id}`, { output })
      if (reply?.cancelled) {
        cancelled = true
        child.kill("SIGTERM")
      }
    }, PROGRESS_MS)
    const deadline = setTimeout(() => child.kill("SIGTERM"), MAX_RUNTIME_MS)

    const code: number | null = await new Promise((resolve) => {
      child.on("close", (c) => resolve(c))
      child.on("error", () => resolve(-1))
    })
    clearInterval(progress)
    clearTimeout(deadline)
    this.child = null
    if (cancelled) return

    let final = output.trim()
    try {
      const last = fs.readFileSync(lastMessageFile, "utf8").trim()
      if (last) final = last
      fs.unlinkSync(lastMessageFile)
    } catch {
      // only Codex writes this file
    }
    if (code === 0 && final) {
      await this.host.post(`/api/desktop/jobs/${job.id}`, { output: final, status: "done" })
    } else {
      const hint = /log ?in|auth|sign ?in|unauthori/i.test(stderr)
        ? `${cmd.bin} isn't signed in on this computer. Open it once and sign in.`
        : stderr.trim().split("\n").slice(-3).join(" ").slice(0, 500) || `${cmd.bin} exited with code ${code}`
      await this.host.post(`/api/desktop/jobs/${job.id}`, { output: final, status: "failed", error: hint })
    }
  }
}
