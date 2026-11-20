import { createHash } from "node:crypto"
import { agents } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { BoatClient } from "./boat"
import { boatTokenForOrg } from "./open-boat"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** A foreground read of one file on the Boat. The path is a single quoted argument. */
export function boatReadCommand(path: string, startLine?: number, endLine?: number): string | null {
  if (!path.startsWith("/") || path.includes("\n") || path.includes("\0")) return null
  const from = startLine ?? 1
  const to = endLine ?? (startLine ? startLine : from + 1999)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to - from > 1999)
    return null
  return `sed -n ${from},${to}p ${shellQuote(path)}`
}

const SCREEN_PATH = "/tmp/sayabot-screen.jpg"

/** Captures the Boat desktop, pointer included. The agent reads the file back over HTTP, not from the shell. */
export function panelShotCommand(): string {
  const frame = shellQuote(SCREEN_PATH)
  return [
    "export DISPLAY=${DISPLAY:-:0}",
    `rm -f ${frame}`,
    `scrot -o -p -q 85 ${frame} 2>/dev/null || import -window root -quality 85 ${frame} 2>/dev/null || ffmpeg -y -f x11grab -draw_mouse 1 -i "$DISPLAY" -frames:v 1 -q:v 3 ${frame} >/dev/null 2>&1`,
    `test -s ${frame} && echo captured`,
  ].join("; ")
}

/** Moves and clicks on the Boat desktop. Coordinates are integers, so they cannot change the command. */
export function boatClickCommand(x: number, y: number, button = "left", count = 1): string | null {
  const buttons: Record<string, number> = { left: 1, middle: 2, right: 3 }
  const code = buttons[button]
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 32767 || y > 32767)
    return null
  if (!code || !Number.isInteger(count) || count < 1 || count > 3) return null
  return `export DISPLAY=\${DISPLAY:-:0}; xdotool mousemove --sync ${x} ${y} click --repeat ${count} --delay 100 ${code}`
}

/** Lists one directory. Depth is an integer, so it cannot change the command. */
export function boatListCommand(path = "/home/bot", depth = 1): string | null {
  if (!path.startsWith("/") || path.includes("\n") || path.includes("\0")) return null
  if (!Number.isInteger(depth) || depth < 1 || depth > 3) return null
  const quoted = shellQuote(path)
  return depth === 1 ? `ls -1 ${quoted}` : `find ${quoted} -mindepth 1 -maxdepth ${depth}`
}

/** Reads a whole file on the Boat. The path is one quoted argument. */
export function boatCatCommand(path: string): string | null {
  if (!path.startsWith("/") || path.includes("\n") || path.includes("\0")) return null
  return `cat ${shellQuote(path)}`
}

/**
 * Plans an exact edit of a Boat file. A repeated match is refused unless replaceAll is set.
 * A hash that does not match the current file refuses the write.
 */
export function planBoatEdit(
  path: string,
  content: string,
  input: { oldString: string; newString: string; replaceAll?: boolean; expectedHash?: string },
): { command: string; replacements: number; hash: string } | { error: string } {
  if (content.length > 5_000_000) return { error: "That file is too large to edit on the Boat." }
  if (
    input.expectedHash &&
    createHash("sha256").update(content).digest("hex") !== input.expectedHash
  ) {
    return { error: "The file changed since it was read." }
  }
  const parts = content.split(input.oldString)
  const count = parts.length - 1
  if (count === 0) return { error: "The text to replace was not found." }
  if (!input.replaceAll && count !== 1) return { error: "That text appears more than once." }
  const next = input.replaceAll
    ? parts.join(input.newString)
    : `${parts[0] ?? ""}${input.newString}${parts.slice(1).join(input.oldString)}`
  const command = boatWriteCommand(path, next)
  if (!command) return { error: "That path cannot be written on the Boat." }
  return {
    command,
    replacements: input.replaceAll ? count : 1,
    hash: createHash("sha256").update(next).digest("hex"),
  }
}

/** Writes one file on the Boat. The bytes are base64, so the file text is not a shell command. */
export function boatWriteCommand(path: string, content: string): string | null {
  if (!path.startsWith("/") || path.includes("\n") || path.includes("\0") || content.includes("\0"))
    return null
  const encoded = Buffer.from(content, "utf8").toString("base64")
  return `printf %s '${encoded}' | base64 -d > ${shellQuote(path)}`
}

/** Numbers a Boat file page the same way a local read does. */
export function numberBoatLines(text: string, startLine = 1): string {
  if (!text) return ""
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")
  return lines.map((line, index) => `${startLine + index} | ${line}`).join("\n")
}

/** A finished command with a non-zero exit failed. A background start has no exit code yet. */
export function boatCommandOk(result: { exitCode?: number }): boolean {
  return result.exitCode === undefined || result.exitCode === 0
}

/**
 * Records use on the shared turn. A later command must keep a background start,
 * or the sleep scan forgets the two-hour window.
 */
export function rememberBoatUse(
  params: Record<string, unknown>,
  detached: boolean,
  now?: string,
): Record<string, unknown> {
  const computer =
    params.computer && typeof params.computer === "object"
      ? (params.computer as Record<string, unknown>)
      : {}
  const next = boatActivity(computer, { detached, now })
  params.computer = next
  return next
}

/** A Boat command keeps the desktop awake. A background one holds it for up to two hours. */
export function boatActivity(
  computer: Record<string, unknown>,
  input: { detached: boolean; now?: string },
): Record<string, unknown> {
  const now = input.now ?? new Date().toISOString()
  return {
    ...computer,
    lastUsedAt: now,
    ...(input.detached ? { backgroundStartedAt: now } : {}),
  }
}

/**
 * Runs a command on the Boat desktop. The agent process stays where it already runs.
 * `detached` returns at once and keeps the Boat awake while that command is in its two-hour window.
 */
export async function runBoatShell(input: {
  orgId: string
  agentId: string
  params: Record<string, unknown> | null
  command: string
  detached: boolean
}): Promise<Record<string, unknown>> {
  const computer =
    input.params?.computer && typeof input.params.computer === "object"
      ? (input.params.computer as Record<string, unknown>)
      : {}
  const boatId = typeof computer.boatId === "string" ? computer.boatId : null
  if (!boatId) return { ok: false, error: "Call select_computer with boat first." }
  const cred = await boatTokenForOrg(input.orgId)
  if (!cred) return { ok: false, error: "No Boat key is set in Settings → Computers." }
  const result = await new BoatClient({
    token: cred.token,
    api: process.env.SAYABOT_BOAT_API || undefined,
  }).command(boatId, input.command, input.detached)
  const nextComputer = input.params
    ? rememberBoatUse(input.params, input.detached)
    : boatActivity(computer, { detached: input.detached })
  await getDb()
    .update(agents)
    .set({ params: { ...(input.params ?? {}), computer: nextComputer } })
    .where(eq(agents.id, input.agentId))
  return { ok: boatCommandOk(result), ...result, background: input.detached, billedTo: cred.source }
}

/** Sees the Boat desktop. A sleeping Boat is not woken; the caller only uses a desktop that is already running. */
export async function captureBoatScreen(input: {
  orgId: string
  agentId: string
  params: Record<string, unknown> | null
}): Promise<Record<string, unknown>> {
  const ran = await runBoatShell({ ...input, command: panelShotCommand(), detached: false })
  if (ran.ok === false) return ran
  if (typeof ran.output !== "string" || !ran.output.includes("captured")) {
    return { ok: false, error: "The Boat screen was not captured." }
  }
  const computer =
    input.params?.computer && typeof input.params.computer === "object"
      ? (input.params.computer as Record<string, unknown>)
      : {}
  const boatId = typeof computer.boatId === "string" ? computer.boatId : null
  const cred = await boatTokenForOrg(input.orgId)
  if (!boatId || !cred) return { ok: false, error: "The Boat frame could not be read." }
  const frame = await new BoatClient({
    token: cred.token,
    api: process.env.SAYABOT_BOAT_API || undefined,
  }).artifact(boatId, SCREEN_PATH)
  if (!frame) return { ok: false, error: "The Boat frame could not be read." }
  return { ok: true, mimeType: frame.contentType, image: frame.base64 }
}
