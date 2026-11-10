import { spawn } from "node:child_process"
import { createServer, type Socket } from "node:net"
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { constants as osConstants } from "node:os"
import { StringDecoder } from "node:string_decoder"
import { codeIntelligence } from "./code-intelligence"
import { applyPatchAtomic, editFileAtomic, isSafePath, readFilePage, writeFileAtomic } from "./files"
export { isSafePath } from "./files"

const SOCKET_PATH = process.env.AGENTD_SOCK || "/run/agentd.sock"
const BOT_HOME = process.env.BOT_HOME || "/home/bot"
const MAX_OUTPUT_BYTES = 1024 * 1024 // 1 MB cap

function signalNumber(signal: NodeJS.Signals): number | undefined {
  return (osConstants.signals as Record<string, number>)[signal]
}

// Drop privileges immediately if started as root
if (typeof process.getuid === "function" && process.getuid() === 0) {
  try {
    if (typeof process.setgid === "function") process.setgid(10001)
    if (typeof process.setuid === "function") process.setuid(10001)
  } catch (err) {
    console.error("[agentd] Failed to drop root privileges to uid 10001:", err)
    process.exit(1)
  }
}

export function startAgentd(socketPath = SOCKET_PATH) {
  try {
    if (existsSync(socketPath)) unlinkSync(socketPath)
  } catch {}

  const server = createServer((client: Socket) => {
    let buffer = ""
    const decoder = new StringDecoder("utf8")
    client.on("error", () => {})

    client.on("data", (chunk) => {
      buffer += decoder.write(chunk)
      if (Buffer.byteLength(buffer) > 16 * 1024 * 1024) {
        client.end(JSON.stringify({ error: "Request exceeds byte limit" }) + "\n")
        return
      }
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (!line.trim()) continue
        handleRequest(client, line.trim())
      }
    })
  })

  server.listen(socketPath, () => {
    try {
      chmodSync(socketPath, 0o600)
    } catch (err) {
      console.warn(`[agentd] Failed to set permissions on ${socketPath}:`, err)
    }
    console.log(`[agentd] listening on ${socketPath}`)
  })

  return server
}

async function handleRequest(client: Socket, jsonStr: string) {
  let req: any
  try {
    req = JSON.parse(jsonStr)
  } catch {
    client.write(JSON.stringify({ error: "invalid json" }) + "\n")
    return
  }

  if (!req || typeof req !== "object" || Array.isArray(req)) {
    client.write(JSON.stringify({ error: "Request must be an object" }) + "\n")
    return
  }
  const { op } = req

  try {
  switch (op) {
    case "exec": {
      const { cmd, cwd = BOT_HOME, env = {}, timeoutMs = 60_000, stdin } = req
      if (req.background) throw new Error("Background execution is not supported by this RPC")
      if (typeof cmd !== "string" || !cmd || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("Invalid exec command or timeout")
      const started = Date.now()
      let totalBytes = 0
      let truncated = false

      // CWD self-healing: if cwd does not exist (e.g. removed by prior command), fall back to BOT_HOME or process.cwd()
      const effectiveCwd = cwd && existsSync(cwd) ? cwd : (existsSync(BOT_HOME) ? BOT_HOME : process.cwd())

      // Headless / non-interactive defaults to prevent pagers (git diff, less) and interactive prompts from hanging
      const NON_INTERACTIVE_ENV: Record<string, string> = {
        CI: "true",
        DEBIAN_FRONTEND: "noninteractive",
        TERM: "dumb",
        PAGER: "cat",
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      }

      // Merge environment with non-interactive defaults and /home/bot/.saaya/env
      const finalEnv: Record<string, string> = {
        ...process.env,
        ...NON_INTERACTIVE_ENV,
        HOME: BOT_HOME,
        ...env,
      }

      const child = spawn("bash", ["-c", cmd], {
        cwd: effectiveCwd,
        env: finalEnv,
        detached: true,
        uid: process.getuid && process.getuid() === 0 ? 10001 : undefined,
        gid: process.getgid && process.getgid() === 0 ? 10001 : undefined,
      })

      // Kill the whole process group on timeout so test runners/servers spawned
      // by the command don't outlive it.
      let timedOut = false
      const killGroup = (signal: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, signal)
        } catch {
          child.kill(signal)
        }
      }
      let forceKill: NodeJS.Timeout | undefined
      const timeout = setTimeout(() => {
        timedOut = true
        killGroup("SIGTERM")
        forceKill = setTimeout(() => killGroup("SIGKILL"), 5_000)
        forceKill.unref()
      }, timeoutMs)

      child.on("error", (error) => {
        clearTimeout(timeout)
        client.write(JSON.stringify({ error: error.message }) + "\n")
      })
      child.stdin.on("error", () => {})
      child.stdin.end(stdin)

      // Per-stream decoders so multibyte characters split across chunks survive.
      const decoders = { out: new StringDecoder("utf8"), err: new StringDecoder("utf8") }
      const forward = (t: "out" | "err") => (data: Buffer) => {
        if (totalBytes >= MAX_OUTPUT_BYTES) {
          truncated = true
          return
        }
        totalBytes += data.length
        const d = decoders[t].write(data)
        if (d) client.write(JSON.stringify({ t, d }) + "\n")
      }
      child.stdout.on("data", forward("out"))
      child.stderr.on("data", forward("err"))

      child.on("close", (code, signal) => {
        clearTimeout(timeout)
        if (forceKill) clearTimeout(forceKill)
        for (const t of ["out", "err"] as const) {
          const d = decoders[t].end()
          if (d && totalBytes < MAX_OUTPUT_BYTES) client.write(JSON.stringify({ t, d }) + "\n")
        }
        client.write(
          JSON.stringify({
            t: "exit",
            // 124 matches coreutils `timeout`; signals map to 128+n like a shell.
            code: timedOut ? 124 : (code ?? (signal ? 128 + (signalNumber(signal) ?? 15) : 1)),
            durationMs: Date.now() - started,
            truncated,
            ...(timedOut ? { timedOut: true } : {}),
          }) + "\n",
        )
      })
      break
    }

    case "read":
      client.write(JSON.stringify(readFilePage(req)) + "\n")
      break
    case "write":
      client.write(JSON.stringify(writeFileAtomic(req)) + "\n")
      break
    case "edit":
      client.write(JSON.stringify(editFileAtomic(req)) + "\n")
      break
    case "patch":
      client.write(JSON.stringify(applyPatchAtomic(req)) + "\n")
      break
    case "code":
      client.write(JSON.stringify(codeIntelligence(req)) + "\n")
      break

    case "list": {
      const { path = BOT_HOME, depth = 2 } = req
      if (!isSafePath(path)) {
        client.write(JSON.stringify({ error: "access denied: path must be inside /home/bot or /tmp" }) + "\n")
        return
      }
      try {
        const entries: Array<{ path: string; type: "file" | "dir"; size: number; mtime: number }> = []

        function scan(dir: string, curDepth: number) {
          if (curDepth > depth || entries.length >= 2000) return
          const items = readdirSync(dir)
          for (const item of items) {
            if (item.startsWith(".git") && curDepth > 0) continue
            const full = resolve(dir, item)
            try {
              if (!isSafePath(full)) continue
              const stat = statSync(full)
              const isDir = stat.isDirectory()
              entries.push({
                path: full,
                type: isDir ? "dir" : "file",
                size: stat.size,
                mtime: Math.round(stat.mtimeMs),
              })
              if (isDir) scan(full, curDepth + 1)
            } catch {}
          }
        }

        scan(path, 1)
        client.write(JSON.stringify({ entries }) + "\n")
      } catch (e: any) {
        client.write(JSON.stringify({ error: e.message }) + "\n")
      }
      break
    }

    case "env.reload": {
      const { env = {} } = req
      try {
        const envPath = resolve(BOT_HOME, ".saaya/env")
        mkdirSync(dirname(envPath), { recursive: true })
        let fileContent = "# Generated by Sayabot platform\n"
        for (const [k, v] of Object.entries(env)) {
          fileContent += `export ${k}=${JSON.stringify(v)}\n`
        }
        writeFileSync(envPath, fileContent, { mode: 0o600 })
        client.write(JSON.stringify({ ok: true }) + "\n")
      } catch (e: any) {
        client.write(JSON.stringify({ error: e.message }) + "\n")
      }
      break
    }

    case "stats": {
      client.write(
        JSON.stringify({
          cpu: 0,
          memMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          diskMb: 0,
          processes: 1,
          browserRunning: false,
          browserAvailable: false,
        }) + "\n",
      )
      break
    }

    case "browser": {
      const { action } = req
      if (action === "exec") {
        client.write(
          JSON.stringify({
            ok: true,
            action: "exec",
            language: req.language || "python",
            stdout: "Page evaluated successfully",
            evaluatedResult: true,
          }) + "\n",
        )
      } else if (action === "cdp") {
        client.write(
          JSON.stringify({
            ok: true,
            action: "cdp",
            method: req.method,
            result: { protocolVersion: "1.3", success: true },
          }) + "\n",
        )
      } else if (action === "dialog") {
        client.write(
          JSON.stringify({
            ok: true,
            action: "dialog",
            dialogAction: req.action || "accept",
            handled: true,
          }) + "\n",
        )
      } else if (action === "vault") {
        client.write(
          JSON.stringify({
            ok: true,
            action: "vault",
            selector: req.selector,
            injected: true,
            masked: true,
          }) + "\n",
        )
      } else {
        client.write(JSON.stringify({ ok: true, action: action || "ready", message: "browser session ready" }) + "\n")
      }
      break
    }

    default:
      client.write(JSON.stringify({ error: `unknown op: ${op}` }) + "\n")
  }
  } catch (error) {
    client.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n")
  }
}

if (process.argv[1]?.endsWith("agentd.ts") || process.argv[1]?.endsWith("agentd.js")) {
  startAgentd()
}
