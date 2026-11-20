import { spawn, type ChildProcess } from "node:child_process"
import * as net from "node:net"
import * as path from "node:path"
import * as fs from "node:fs"
import os from "node:os"

export interface EmbeddedEngineStatus {
  running: boolean
  port: number | null
  serverUrl: string | null
  dbReady: boolean
}

let engineProcess: ChildProcess | null = null
let currentPort: number | null = null
let currentServerUrl: string | null = null
let isDbReady = false

/**
 * Finds an available local TCP port on 127.0.0.1, starting at `preferredPort`.
 */
export async function findAvailablePort(preferredPort = 4000): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(preferredPort, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo
      server.close(() => resolve(address.port))
    })
    server.on("error", () => {
      resolve(findAvailablePort(preferredPort + 1))
    })
  })
}

/**
 * Polls the local server endpoint until it answers healthy or times out.
 */
export async function waitForServer(url: string, timeoutMs = 12_000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1_000) })
      if (res.ok) return true
    } catch {
      // Still booting
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

/**
 * Generates an instant local authentication session for the zero-config local user.
 */
export function createLocalSession(serverUrl: string) {
  const userId = "00000000-0000-0000-0000-000000000001"
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24 * 365 * 10 // 10 years
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      email: "local@sayabot.local",
      role: "authenticated",
      aud: "authenticated",
      exp,
    }),
  ).toString("base64url")

  return {
    accessToken: `${header}.${payload}.localsecret`,
    refreshToken: "local-refresh-token-permanent",
    email: "local@sayabot.local",
    userId,
    serverUrl,
    isGuest: false,
  }
}

/**
 * Starts the complete zero-config embedded Sayabot engine:
 * 1. Spawns local orchestrator engine with PGlite & host-sandbox compute
 * 2. Waits for health check & returns the local server URL
 */
export async function startEmbeddedEngine(options?: { port?: number }): Promise<{
  ok: boolean
  serverUrl: string | null
  port: number | null
  error?: string
}> {
  if (engineProcess && currentServerUrl) {
    return { ok: true, serverUrl: currentServerUrl, port: currentPort }
  }

  // Check if an orchestrator instance is already running on port 4000
  const candidatePort = options?.port ?? 4000
  const candidateUrl = `http://127.0.0.1:${candidatePort}`
  try {
    const checkRes = await fetch(`${candidateUrl}/health`, { signal: AbortSignal.timeout(600) })
    if (checkRes.ok) {
      console.log(`[embedded-engine] Detected running Sayabot service at ${candidateUrl}`)
      currentPort = candidatePort
      currentServerUrl = candidateUrl
      isDbReady = true
      return { ok: true, serverUrl: currentServerUrl, port: currentPort }
    }
  } catch {
    // Not running; will start below
  }

  // 1. Select Port
  const port = await findAvailablePort(candidatePort)
  const serverUrl = `http://127.0.0.1:${port}`

  // 2. Locate orchestrator script or binary
  const candidateDirs = [
    path.resolve(__dirname, "../../orchestrator"),
    path.resolve(__dirname, "../../../apps/orchestrator"),
    path.resolve(process.cwd(), "apps/orchestrator"),
    path.resolve(os.homedir(), "saaya/apps/orchestrator"),
    "/Users/jarvis/saaya/apps/orchestrator",
  ]
  const orchestratorDir =
    candidateDirs.find((d) => fs.existsSync(path.join(d, "src", "index.ts"))) || candidateDirs[0]!
  const orchestratorEntry = fs.existsSync(path.join(orchestratorDir, "src", "index.ts"))
    ? path.join(orchestratorDir, "src", "index.ts")
    : path.join(orchestratorDir, "dist", "index.js")

  const pathAdditions = [
    path.join(os.homedir(), ".nvm/versions/node/v24.21.0/bin"),
    path.join(os.homedir(), ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ]

  const env = {
    ...process.env,
    PATH: `${pathAdditions.join(path.delimiter)}${path.delimiter}${process.env.PATH || ""}`,
    SAYABOT_LOCAL: "true",
    DATABASE_URL: "local",
    PORT: String(port),
    COMPUTER_BACKEND: "host",
    SAYABOT_SANDBOX_DIR: path.join(os.homedir(), ".sayabot", "sandbox"),
    NODE_ENV: process.env.NODE_ENV || "development",
  }

  console.log(`[embedded-engine] Spawning local orchestrator on ${serverUrl} from ${orchestratorDir}…`)

  // Use tsx if starting from TypeScript source, otherwise node
  const isTs = orchestratorEntry.endsWith(".ts")
  let cmd = process.execPath
  let args = [orchestratorEntry]

  if (isTs) {
    const tsxCandidate = [
      path.resolve(orchestratorDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
      path.resolve(orchestratorDir, "..", "..", "node_modules", ".pnpm", "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
      path.resolve(os.homedir(), "saaya/node_modules/.pnpm/node_modules/.bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
      "/Users/jarvis/saaya/node_modules/.pnpm/node_modules/.bin/tsx",
      path.resolve(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"),
    ].find((p) => p && fs.existsSync(p))

    if (tsxCandidate) {
      cmd = tsxCandidate
      args = [orchestratorEntry]
    } else {
      cmd = "pnpm"
      args = ["--filter", "@sayabot/orchestrator", "exec", "tsx", orchestratorEntry]
    }
  }

  try {
    engineProcess = spawn(cmd, args, {
      cwd: orchestratorDir,
      env,
      stdio: "pipe",
      detached: false,
    })

    engineProcess.stdout?.on("data", (chunk) => {
      const line = chunk.toString().trim()
      if (line) console.log(`[orchestrator:out] ${line}`)
    })

    engineProcess.stderr?.on("data", (chunk) => {
      const line = chunk.toString().trim()
      if (line) console.warn(`[orchestrator:err] ${line}`)
    })

    engineProcess.on("exit", (code, signal) => {
      console.log(`[embedded-engine] Orchestrator exited (code: ${code}, signal: ${signal})`)
      engineProcess = null
      currentPort = null
      currentServerUrl = null
      isDbReady = false
    })

    const ready = await waitForServer(serverUrl, 12_000)
    if (!ready) {
      throw new Error(`Orchestrator did not respond healthy within timeout on ${serverUrl}`)
    }

    currentPort = port
    currentServerUrl = serverUrl
    isDbReady = true
    console.log(`[embedded-engine] Sayabot embedded engine fully operational at ${serverUrl}`)
    return { ok: true, serverUrl: currentServerUrl, port: currentPort }
  } catch (err: any) {
    console.error("[embedded-engine] Error starting orchestrator:", err)
    if (engineProcess) {
      try {
        engineProcess.kill()
      } catch {}
      engineProcess = null
    }
    return { ok: false, serverUrl: null, port: null, error: err.message }
  }
}

/**
 * Shuts down the embedded engine if running.
 */
export async function stopEmbeddedEngine(): Promise<void> {
  if (engineProcess) {
    console.log("[embedded-engine] Stopping local orchestrator…")
    try {
      engineProcess.kill("SIGTERM")
    } catch {}
    engineProcess = null
  }
  currentPort = null
  currentServerUrl = null
  isDbReady = false
}

export function getEmbeddedEngineStatus(): EmbeddedEngineStatus {
  return {
    running: Boolean(engineProcess || currentServerUrl),
    port: currentPort,
    serverUrl: currentServerUrl,
    dbReady: isDbReady,
  }
}
