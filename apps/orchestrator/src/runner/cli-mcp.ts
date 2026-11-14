import { randomBytes } from "node:crypto"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hashAgentApiKey } from "@sayabot/core/server"
import { oauthTokens } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { claudeMcpConfig, type CliApp, type CliMcp } from "./cli-agent"

/**
 * Gives an app run Sayabot's room tools (tasks, canvas, votes, human decisions, owner facts)
 * through Sayabot's own MCP server, the same door external agents use. The token is minted for
 * this one run: this agent only, this room only, no `secrets:use`, gone after 20 minutes and
 * revoked as soon as the run ends.
 */

const TOKEN_TTL_MS = 20 * 60_000
export const MCP_TOKEN_ENV = "SAYABOT_MCP_TOKEN"
/** Every scope the MCP server checks except `secrets:use`. */
export const CLI_RUN_SCOPES = [
  "room:read",
  "room:write",
  "tasks:read",
  "tasks:write",
  "canvas:read",
  "canvas:write",
]

export function sayabotMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.SAYABOT_MCP_URL || `http://127.0.0.1:${env.PORT || "4000"}/v1/mcp`
}

export interface CliMcpGrant {
  mcp: CliMcp
  env: Record<string, string>
  release: () => Promise<void>
}

export async function grantCliMcp(args: {
  app: CliApp
  agentId: string
  roomId: string
}): Promise<CliMcpGrant | null> {
  // Cursor reads MCP servers from its own project/user config only; it answers without them.
  if (args.app === "cursor") return null
  const token = `sayabot_at_${randomBytes(32).toString("base64url")}`
  const [row] = await getDb()
    .insert(oauthTokens)
    .values({
      kind: "access",
      tokenHash: hashAgentApiKey(token),
      clientId: "sayabot-local-cli",
      agentId: args.agentId,
      roomIds: [args.roomId],
      scopes: CLI_RUN_SCOPES,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })
    .returning({ id: oauthTokens.id })
  if (!row) return null

  const url = sayabotMcpUrl()
  let dir: string | null = null
  let configPath: string | undefined
  if (args.app === "claude-code") {
    dir = await mkdtemp(join(tmpdir(), "sayabot-mcp-"))
    configPath = join(dir, "mcp.json")
    await writeFile(configPath, claudeMcpConfig(url, token), { mode: 0o600 })
    await chmod(configPath, 0o600)
  }

  return {
    mcp: { url, tokenEnv: MCP_TOKEN_ENV, configPath },
    env: args.app === "codex" ? { [MCP_TOKEN_ENV]: token } : {},
    release: async () => {
      await getDb()
        .update(oauthTokens)
        .set({ revokedAt: new Date() })
        .where(eq(oauthTokens.id, row.id))
        .catch(() => {})
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** A Mac run can wait on approvals, so its token outlives the 15-minute job limit a little. */
const MAC_TOKEN_TTL_MS = 30 * 60_000

/**
 * The same one-run grant for an agent that runs on its owner's Mac (Sayabot for Mac). The raw
 * token travels to the Mac inside the job (sealed until claimed); the caller revokes it with
 * `revokeMcpToken` when the job ends.
 */
export async function mintMacMcpToken(args: {
  agentId: string
  roomId: string
}): Promise<{ token: string; tokenId: string } | null> {
  const token = `sayabot_at_${randomBytes(32).toString("base64url")}`
  const [row] = await getDb()
    .insert(oauthTokens)
    .values({
      kind: "access",
      tokenHash: hashAgentApiKey(token),
      clientId: "sayabot-mac-runner",
      agentId: args.agentId,
      roomIds: [args.roomId],
      scopes: CLI_RUN_SCOPES,
      expiresAt: new Date(Date.now() + MAC_TOKEN_TTL_MS),
    })
    .returning({ id: oauthTokens.id })
  return row ? { token, tokenId: row.id } : null
}

export async function revokeMcpToken(tokenId: string | null | undefined): Promise<void> {
  if (!tokenId) return
  await getDb()
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthTokens.id, tokenId))
    .catch(() => {})
}
