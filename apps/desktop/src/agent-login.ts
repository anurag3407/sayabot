import { type ChildProcess } from "node:child_process"
import { spawnTool, toolPath } from "./bin-path"
import { agentSpec, findBinary } from "./local-agents"

/**
 * Signing an agent app in from Sayabot, through the app's own login flow. Only Antigravity
 * today: `agy acp --login` prints a Google link, then reads the code (or the full URL of the page
 * the browser lands on) from stdin and stores the sign-in where `agy acp` reads it. Sayabot opens
 * the link and hands the code over; it never sees or keeps the tokens (Google's terms forbid
 * extracting or reusing them).
 */

/** Apps with a sign-in Sayabot can start, and the arguments that start it. */
const LOGIN_ARGS: Record<string, readonly string[]> = { antigravity: ["acp", "--login"] }

const URL_TIMEOUT_MS = 30_000
const FINISH_TIMEOUT_MS = 90_000
const MAX_CODE = 4_096

export function canSignIn(appId: string): boolean {
  return appId in LOGIN_ARGS
}

/** The Google sign-in link in what the login printed, once terminated by whitespace or newline. */
export function loginUrl(output: string): string | null {
  const match = /(https:\/\/accounts\.google\.com\/[^\s"'<>]+)[\r\n\s"'<>]/.exec(output)
  return match ? match[1] : null
}

/** A pasted code or landing URL, made safe to hand to the login's stdin, or null. */
export function cleanCode(input: unknown): string | null {
  if (typeof input !== "string") return null
  const code = input.trim()
  if (!code || code.length > MAX_CODE || /[\r\n\0]/.test(code)) return null
  return code
}

export type SignInStart = { ok: true; url: string } | { ok: false; error: string }
export type SignInFinish = { ok: true } | { ok: false; error: string }

/** One sign-in at a time; a new start replaces the last one. */
export class AgentLogin {
  private child: ChildProcess | null = null
  private output = ""

  async start(appId: string): Promise<SignInStart> {
    this.cancel()
    const args = LOGIN_ARGS[appId]
    const spec = agentSpec(appId)
    if (!args || !spec) return { ok: false, error: "This app can't be signed in from Sayabot." }
    const bin = await findBinary(spec.bin)
    if (!bin) return { ok: false, error: `${spec.name} isn't installed on this computer.` }
    const child = spawnTool(bin, [...args], {
      env: { ...process.env, PATH: toolPath(bin), NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child = child
    this.output = ""
    const collect = (chunk: Buffer) => {
      this.output = (this.output + chunk.toString("utf8")).slice(-16_000)
    }
    child.stdout?.on("data", collect)
    child.stderr?.on("data", collect)
    child.stdin?.on("error", () => {})
    return new Promise((resolve) => {
      let settled = false
      const done = (result: SignInStart) => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timer)
        resolve(result)
      }
      child.once("error", (err) => {
        if (this.child === child) this.child = null
        done({ ok: false, error: err.message || `${spec.name} couldn't be started.` })
      })
      const poll = setInterval(() => {
        const url = loginUrl(this.output)
        if (url) done({ ok: true, url })
      }, 100)
      const timer = setTimeout(() => {
        this.cancel()
        done({ ok: false, error: `${spec.name} didn't show a sign-in link.` })
      }, URL_TIMEOUT_MS)
      child.once("close", () => {
        if (this.child === child) this.child = null
        done({ ok: false, error: this.tail() || `${spec.name} stopped before showing a link.` })
      })
    })
  }

  /** Hands the code (or landing URL) to the login and waits for it to store the sign-in. */
  submit(input: unknown): Promise<SignInFinish> {
    const child = this.child
    const code = cleanCode(input)
    if (!child) return Promise.resolve({ ok: false, error: "Start the sign-in again." })
    if (!code) return Promise.resolve({ ok: false, error: "Paste the code from the Google page." })
    return new Promise((resolve) => {
      let settled = false
      const done = (result: SignInFinish) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.child === child) this.child = null
        resolve(result)
      }
      const timer = setTimeout(() => {
        this.cancel()
        done({ ok: false, error: "The sign-in didn't finish in time. Try again." })
      }, FINISH_TIMEOUT_MS)
      child.once("error", (err) => {
        done({ ok: false, error: err.message || "The sign-in process failed." })
      })
      child.once("close", (exitCode) => {
        done(
          exitCode === 0
            ? { ok: true }
            : { ok: false, error: this.tail() || "That code didn't work. Try again." },
        )
      })
      child.stdin?.write(`${code}\n`)
    })
  }

  cancel(): void {
    const child = this.child
    this.child = null
    child?.kill("SIGTERM")
  }

  /** The login's last words, without the link or anything that looks like a code. */
  private tail(): string {
    return this.output
      .replace(/https?:\/\/\S+/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-2)
      .join(" ")
      .slice(0, 300)
  }
}
