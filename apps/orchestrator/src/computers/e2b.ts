/**
 * E2B (e2b.dev) as a bot's cloud desktop. The agent process stays on the Mac or the Cloud home;
 * each bot gets one persistent E2B sandbox, found again by its metadata. E2B pauses it after the
 * idle timeout (memory and disk kept) and connecting resumes it, so nothing here has to sleep it.
 * Files live in /home/user.
 */
import { boatCredential } from "@sayabot/core"
import { agents, orgComputerSettings } from "@sayabot/db"
import { decryptSecret } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"
import { panelShotCommand } from "./boat-shell"

/** Idle time before E2B pauses the sandbox. Every command pushes it out again. */
export const E2B_IDLE_MS = 10 * 60 * 1000
const OUTPUT_CAP = 2 * 1024 * 1024
const SCREEN = "/tmp/sayabot-screen.jpg"

/** The slice of the E2B SDK this module uses, so tests can pass a stub. */
export interface E2BSandboxHandle {
  sandboxId: string
  commands: {
    run(
      cmd: string,
      opts?: { timeoutMs?: number; background?: boolean; envs?: Record<string, string> },
    ): Promise<{ exitCode?: number; stdout?: string; stderr?: string; pid?: number }>
  }
  files: { read(path: string, opts: { format: "bytes" }): Promise<Uint8Array> }
  setTimeout?(timeoutMs: number): Promise<void>
}

export interface E2BSdk {
  Sandbox: {
    create(template: string, opts: Record<string, unknown>): Promise<E2BSandboxHandle>
    connect(sandboxId: string, opts: Record<string, unknown>): Promise<E2BSandboxHandle>
    list(opts: Record<string, unknown>): {
      nextItems(): Promise<{ sandboxId: string; state?: string }[]>
    }
  }
}

async function loadSdk(): Promise<E2BSdk> {
  return (await import("@e2b/code-interpreter")) as unknown as E2BSdk
}

/** Which template new sandboxes start from. E2B's public "desktop" template has a screen. */
export function e2bTemplate(): string {
  return process.env.SAYABOT_E2B_TEMPLATE?.trim() || "desktop"
}

/** The workspace's own E2B key wins. The server's E2B_API_KEY is used only when there is none. */
export async function e2bKeyForOrg(
  orgId: string,
): Promise<{ token: string; source: "own" | "included" } | null> {
  let own: string | null = null
  try {
    const [settings] = await getDb()
      .select({
        ciphertext: orgComputerSettings.e2bCiphertext,
        iv: orgComputerSettings.e2bIv,
        tag: orgComputerSettings.e2bTag,
      })
      .from(orgComputerSettings)
      .where(eq(orgComputerSettings.orgId, orgId))
      .limit(1)
    if (settings?.ciphertext && settings.iv && settings.tag) {
      own = decryptSecret(
        { ciphertext: settings.ciphertext, iv: settings.iv, tag: settings.tag },
        getEnv().MESH_KEK,
      )
    }
  } catch {
    own = null
  }
  return boatCredential(own, process.env.E2B_API_KEY)
}

/** Finds this bot's sandbox (running or paused) or creates one. Connecting resumes a paused one. */
export async function openE2bSandbox(
  input: { apiKey: string; agentId: string; orgId: string; currentId?: string | null },
  sdk?: E2BSdk,
): Promise<E2BSandboxHandle> {
  const lib = sdk ?? (await loadSdk())
  const auth = { apiKey: input.apiKey }
  let id = input.currentId ?? null
  if (!id) {
    const found = await lib.Sandbox.list({
      ...auth,
      query: { metadata: { sayabotAgent: input.agentId }, state: ["running", "paused"] },
    }).nextItems()
    id = found[0]?.sandboxId ?? null
  }
  if (id) {
    try {
      return await lib.Sandbox.connect(id, { ...auth, timeoutMs: E2B_IDLE_MS })
    } catch {
      // Killed or expired on E2B's side: make a new one below.
    }
  }
  const sbx = await lib.Sandbox.create(e2bTemplate(), {
    ...auth,
    metadata: { sayabotApp: "orchestrator", sayabotAgent: input.agentId, sayabotOrg: input.orgId },
    timeoutMs: E2B_IDLE_MS,
    lifecycle: { onTimeout: "pause" },
  })
  await startScreen(sbx)
  return sbx
}

/** Best effort: a template with X but no running display gets one. Plain templates skip it. */
async function startScreen(sbx: E2BSandboxHandle): Promise<void> {
  await sbx.commands
    .run(
      "command -v Xvfb >/dev/null 2>&1 || exit 0; pgrep -x Xvfb >/dev/null || (nohup Xvfb :0 -screen 0 1280x800x24 -ac >/dev/null 2>&1 &); " +
        "command -v startxfce4 >/dev/null 2>&1 && (pgrep -f xfce4-session >/dev/null || (DISPLAY=:0 nohup startxfce4 >/dev/null 2>&1 &)); exit 0",
      { timeoutMs: 20_000 },
    )
    .catch(() => {})
}

function computerOf(params: Record<string, unknown> | null): Record<string, unknown> {
  return params?.computer && typeof params.computer === "object"
    ? (params.computer as Record<string, unknown>)
    : {}
}

/** select_computer with e2b: create or resume this bot's sandbox and remember its id. */
export async function openSelectedE2b(input: {
  orgId: string
  agentId: string
  params: Record<string, unknown> | null
  sdk?: E2BSdk
}): Promise<Record<string, unknown>> {
  const cred = await e2bKeyForOrg(input.orgId)
  if (!cred) return { ok: false, error: "No E2B key is set in Settings → AI providers." }
  const computer = computerOf(input.params)
  let sbx: E2BSandboxHandle
  try {
    sbx = await openE2bSandbox(
      {
        apiKey: cred.token,
        agentId: input.agentId,
        orgId: input.orgId,
        currentId: typeof computer.e2bId === "string" ? computer.e2bId : null,
      },
      input.sdk,
    )
  } catch (error) {
    return {
      ok: false,
      error: `E2B did not start: ${error instanceof Error ? error.message : "unknown error"}`,
    }
  }
  const next = {
    ...(input.params ?? {}),
    computer: {
      ...computer,
      e2bId: sbx.sandboxId,
      e2bReady: true,
      e2bConfigured: true,
      lastUsedAt: new Date().toISOString(),
    },
  }
  await getDb().update(agents).set({ params: next }).where(eq(agents.id, input.agentId))
  return { ok: true, e2bId: sbx.sandboxId, billedTo: cred.source }
}

function commandResult(raw: unknown): { exitCode: number | null; stdout: string; stderr: string } {
  const r = (raw ?? {}) as {
    exitCode?: unknown
    stdout?: unknown
    stderr?: unknown
    result?: unknown
  }
  // The SDK throws CommandExitError on a non-zero exit; it carries the same fields.
  const inner = (r.result ?? r) as { exitCode?: unknown; stdout?: unknown; stderr?: unknown }
  return {
    exitCode: typeof inner.exitCode === "number" ? inner.exitCode : null,
    stdout: typeof inner.stdout === "string" ? inner.stdout.slice(0, OUTPUT_CAP) : "",
    stderr: typeof inner.stderr === "string" ? inner.stderr.slice(0, 64_000) : "",
  }
}

/**
 * Runs one command in the bot's E2B sandbox. Never throws. `background` starts it and returns at
 * once. Each call resumes a paused sandbox and pushes the idle timeout out again.
 */
export async function runE2bShell(input: {
  orgId: string
  agentId: string
  params: Record<string, unknown> | null
  command: string
  timeoutMs?: number
  background?: boolean
  sdk?: E2BSdk
}): Promise<{
  ok: boolean
  output: string
  stdout: string
  exitCode: number | null
  background?: boolean
}> {
  const e2bId = computerOf(input.params).e2bId
  if (typeof e2bId !== "string") {
    return { ok: false, output: "Call select_computer with e2b first.", stdout: "", exitCode: null }
  }
  const cred = await e2bKeyForOrg(input.orgId)
  if (!cred)
    return {
      ok: false,
      output: "No E2B key is set in Settings → AI providers.",
      stdout: "",
      exitCode: null,
    }
  let sbx: E2BSandboxHandle
  try {
    sbx = await openE2bSandbox(
      { apiKey: cred.token, agentId: input.agentId, orgId: input.orgId, currentId: e2bId },
      input.sdk,
    )
  } catch (error) {
    return {
      ok: false,
      output: `E2B did not open: ${error instanceof Error ? error.message : "unknown"}`,
      stdout: "",
      exitCode: null,
    }
  }
  try {
    if (input.background) {
      // Keep the sandbox up for up to two hours while the background job runs.
      await sbx.setTimeout?.(2 * 60 * 60 * 1000).catch(() => {})
      const started = await sbx.commands.run(input.command, { background: true })
      return {
        ok: true,
        output: `Started in the background${started.pid ? ` (pid ${started.pid})` : ""}.`,
        stdout: "",
        exitCode: null,
        background: true,
      }
    }
    const raw = await sbx.commands.run(input.command, { timeoutMs: input.timeoutMs ?? 60_000 })
    const result = commandResult(raw)
    return {
      ok: result.exitCode === 0 || result.exitCode === null,
      output: result.stderr
        ? result.stdout
          ? `${result.stdout}\n${result.stderr}`
          : result.stderr
        : result.stdout,
      stdout: result.stdout,
      exitCode: result.exitCode,
    }
  } catch (error) {
    const result = commandResult(error)
    if (result.exitCode !== null) {
      return {
        ok: false,
        output: result.stderr
          ? result.stdout
            ? `${result.stdout}\n${result.stderr}`
            : result.stderr
          : result.stdout,
        stdout: result.stdout,
        exitCode: result.exitCode,
      }
    }
    return {
      ok: false,
      output: error instanceof Error ? error.message : "E2B command failed",
      stdout: "",
      exitCode: null,
    }
  }
}

/** A screenshot of the sandbox's display, when its template has one. */
export async function captureE2bScreen(input: {
  orgId: string
  agentId: string
  params: Record<string, unknown> | null
  sdk?: E2BSdk
}): Promise<Record<string, unknown>> {
  const shot = await runE2bShell({ ...input, command: panelShotCommand(), timeoutMs: 20_000 })
  if (!shot.ok || !shot.stdout.includes("captured")) {
    return {
      ok: false,
      error: "The E2B screen could not be read. Its template may have no display.",
    }
  }
  const cred = await e2bKeyForOrg(input.orgId)
  const e2bId = computerOf(input.params).e2bId
  if (!cred || typeof e2bId !== "string")
    return { ok: false, error: "The E2B screen could not be read." }
  try {
    const sbx = await openE2bSandbox(
      { apiKey: cred.token, agentId: input.agentId, orgId: input.orgId, currentId: e2bId },
      input.sdk,
    )
    const bytes = await sbx.files.read(SCREEN, { format: "bytes" })
    return { ok: true, mimeType: "image/jpeg", image: Buffer.from(bytes).toString("base64") }
  } catch {
    return { ok: false, error: "The E2B screen could not be read." }
  }
}
