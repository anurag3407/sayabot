import { hashAgentApiKey } from "@sayabot/core/server"
import {
  agentComputers,
  agents,
  agentSecretGrants,
  auditLogs,
  roomAgents,
  toolCalls,
  vaultSecrets,
} from "@sayabot/db"
import { openSecret } from "@sayabot/llm"
import { and, eq, isNull, or, gt } from "drizzle-orm"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { z } from "zod"
import { getDb, getPool } from "../db"
import { getEnv } from "../env"
import { enqueueTaskWake } from "../jobs"
import { broadcast } from "../realtime"
import { waitForApproval } from "../tools/approvals"

export const internalRoutes = new Hono()

// ── Secret Broker: Identity resolution ──────────────────────────────────────

const identitySchema = z
  .object({
    proxySecret: z.string().min(1).optional(),
    containerIp: z.string().optional(),
  })
  .refine((data) => data.proxySecret || data.containerIp, {
    message: "Either proxySecret or containerIp must be provided",
  })

internalRoutes.post("/internal/egress/identity", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = identitySchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  const db = getDb()
  let computer = null

  if (parsed.data.proxySecret) {
    const hash = hashAgentApiKey(parsed.data.proxySecret)
    const [row] = await db
      .select({ agentId: agentComputers.agentId, orgId: agentComputers.orgId })
      .from(agentComputers)
      .where(eq(agentComputers.proxySecretHash, hash))
      .limit(1)
    computer = row
  } else if (parsed.data.containerIp) {
    const [row] = await db
      .select({ agentId: agentComputers.agentId, orgId: agentComputers.orgId })
      .from(agentComputers)
      .where(and(eq(agentComputers.containerIp, parsed.data.containerIp), eq(agentComputers.status, "running")))
      .limit(1)
    computer = row
  }

  if (!computer) {
    return c.json({ error: "invalid computer identity" }, 401)
  }

  return c.json({
    ok: true,
    agentId: computer.agentId,
    orgId: computer.orgId,
  })
})

// ── Secret Broker: Resolve placeholder to plaintext ─────────────────────────

const resolveSchema = z.object({
  agentId: z.string().uuid(),
  placeholder: z.string().min(1),
})

internalRoutes.post("/internal/egress/resolve", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = resolveSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  const db = getDb()
  const now = new Date()

  // Match either placeholder string or grant ID
  const [grant] = await db
    .select({
      id: agentSecretGrants.id,
      orgId: agentSecretGrants.orgId,
      agentId: agentSecretGrants.agentId,
      envName: agentSecretGrants.envName,
      placeholder: agentSecretGrants.placeholder,
      allowedHosts: agentSecretGrants.allowedHosts,
      inject: agentSecretGrants.inject,
      methods: agentSecretGrants.methods,
      requiresApproval: agentSecretGrants.requiresApproval,
      expiresAt: agentSecretGrants.expiresAt,
      revokedAt: agentSecretGrants.revokedAt,
      sealed: vaultSecrets.sealed,
      secretId: vaultSecrets.id,
    })
    .from(agentSecretGrants)
    .innerJoin(vaultSecrets, eq(agentSecretGrants.secretId, vaultSecrets.id))
    .where(
      and(
        eq(agentSecretGrants.agentId, parsed.data.agentId),
        or(
          eq(agentSecretGrants.placeholder, parsed.data.placeholder),
          eq(agentSecretGrants.id, parsed.data.placeholder.replace(/^saaya_ph_/, "")),
        ),
        isNull(agentSecretGrants.revokedAt),
        or(isNull(agentSecretGrants.expiresAt), gt(agentSecretGrants.expiresAt, now)),
      ),
    )
    .limit(1)

  if (!grant) {
    return c.json({ error: "grant not found, revoked, or expired" }, 404)
  }

  // Update lastUsedAt asynchronously
  void Promise.all([
    db
      .update(agentSecretGrants)
      .set({ lastUsedAt: now })
      .where(eq(agentSecretGrants.id, grant.id)),
    db
      .update(vaultSecrets)
      .set({ lastUsedAt: now })
      .where(eq(vaultSecrets.id, grant.secretId)),
  ]).catch(() => {})

  const kek = getEnv().MESH_KEK
  const secretPlaintext = openSecret(grant.sealed, kek)

  return c.json({
    grantId: grant.id,
    secretPlaintext,
    hostAllowlist: grant.allowedHosts,
    inject: grant.inject,
    methods: grant.methods,
    requiresApproval: grant.requiresApproval,
  })
})

// ── Secret Broker: Approval gateway ─────────────────────────────────────────

const approvalSchema = z.object({
  agentId: z.string().uuid(),
  grantId: z.string().uuid(),
  url: z.string().url(),
  method: z.string().default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  bodyPreview: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
})

internalRoutes.post("/internal/egress/approval", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = approvalSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  const db = getDb()
  const [grant] = await db
    .select({
      id: agentSecretGrants.id,
      orgId: agentSecretGrants.orgId,
      envName: agentSecretGrants.envName,
      agentId: agentSecretGrants.agentId,
    })
    .from(agentSecretGrants)
    .where(eq(agentSecretGrants.id, parsed.data.grantId))
    .limit(1)

  if (!grant) return c.json({ error: "grant not found" }, 404)

  // Find a room where the agent is active
  const agentRoomsList = await db
    .select({ roomId: roomAgents.roomId })
    .from(roomAgents)
    .where(eq(roomAgents.agentId, parsed.data.agentId))

  const roomId = agentRoomsList[0]?.roomId
  if (!roomId) {
    return c.json({ status: "rejected", reason: "no active room for agent" }, 200)
  }

  // Create tool call row for approval
  const [toolCall] = await db
    .insert(toolCalls)
    .values({
      roomId,
      toolName: "use_secret",
      args: {
        envName: grant.envName,
        url: parsed.data.url,
        method: parsed.data.method,
        headers: parsed.data.headers,
        bodyPreview: parsed.data.bodyPreview,
      },
      status: "pending_approval",
    })
    .returning()

  if (!toolCall) return c.json({ error: "failed to record tool call" }, 500)

  // Broadcast approval request to room
  await broadcast(roomId, {
    type: "tool.approval_requested",
    toolCallId: toolCall.id,
    agentId: grant.agentId,
    toolName: "use_secret",
    args: toolCall.args,
  }).catch(() => {})

  const decision = await waitForApproval(toolCall.id, parsed.data.timeoutMs ?? 60_000)

  return c.json({
    status: decision,
    toolCallId: toolCall.id,
  })
})

// ── Secret Broker: Violation logging ────────────────────────────────────────

const violationSchema = z.object({
  agentId: z.string().uuid(),
  reason: z.string().min(1),
  host: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})

internalRoutes.post("/internal/egress/violation", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = violationSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  const db = getDb()
  const [agent] = await db
    .select({
      id: agents.id,
      orgId: agents.orgId,
      handle: agents.handle,
    })
    .from(agents)
    .where(eq(agents.id, parsed.data.agentId))
    .limit(1)

  if (!agent) return c.json({ error: "agent not found" }, 404)

  await db.insert(auditLogs).values({
    orgId: agent.orgId,
    actorType: "agent",
    actorId: agent.id,
    action: "egress.violation",
    target: parsed.data.host,
    metadata: {
      reason: parsed.data.reason,
      host: parsed.data.host,
      details: parsed.data.details ?? {},
    },
  })

  const agentRoomsList = await db
    .select({ roomId: roomAgents.roomId })
    .from(roomAgents)
    .where(eq(roomAgents.agentId, agent.id))

  for (const { roomId } of agentRoomsList) {
    void broadcast(roomId, {
      type: "room.notice",
      level: "warn",
      message: `Egress proxy blocked unauthorized outbound request by @${agent.handle} to ${parsed.data.host}: ${parsed.data.reason}`,
    }).catch(() => {})
  }

  return c.json({ recorded: true })
})

// ── Secret Broker: Usage reporting ──────────────────────────────────────────

const usageSchema = z.object({
  agentId: z.string().uuid(),
  bytesTransferred: z.number().int().nonnegative(),
  swapsCount: z.number().int().nonnegative(),
})

internalRoutes.post("/internal/egress/usage", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = usageSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  return c.json({ ok: true })
})

// ── Secret Broker: Invalidation SSE stream ──────────────────────────────────

internalRoutes.get("/internal/egress/stream", (c) => {
  return streamSSE(c, async (stream) => {
    let client: any = null
    const cleanup = () => {
      if (client) {
        client.release()
        client = null
      }
    }

    try {
      client = await getPool().connect()
      client.on("notification", (msg: any) => {
        if (msg.channel === "vault_changed") {
          void stream.writeSSE({
            event: "vault_changed",
            data: msg.payload || "{}",
          })
        }
      })
      await client.query("LISTEN vault_changed")

      // Send initial heartbeat
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ ok: true, timestamp: Date.now() }),
      })

      // Keep connection open with periodic heartbeats
      while (!stream.aborted) {
        await stream.sleep(15_000)
        await stream.writeSSE({
          event: "ping",
          data: "{}",
        })
      }
    } catch {
      // client disconnected
    } finally {
      cleanup()
    }
  })
})

// ── Bot Computer: State update ──────────────────────────────────────────────

const computerStateSchema = z.object({
  agentId: z.string().uuid(),
  status: z.enum(["none", "starting", "running", "stopped", "error"]),
  containerId: z.string().nullable().optional(),
  containerIp: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  // SHA-256 of the per-agent egress proxy credential computerd adds for microVM computers.
  proxySecretHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

internalRoutes.post("/internal/computer/state", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = computerStateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  const db = getDb()
  const now = new Date()

  await db
    .update(agentComputers)
    .set({
      status: parsed.data.status,
      containerId: parsed.data.containerId !== undefined ? parsed.data.containerId : undefined,
      containerIp: parsed.data.containerIp !== undefined ? parsed.data.containerIp : undefined,
      error: parsed.data.error !== undefined ? parsed.data.error : undefined,
      proxySecretHash: parsed.data.proxySecretHash,
      lastActiveAt: now,
    })
    .where(eq(agentComputers.agentId, parsed.data.agentId))

  const agentRoomsList = await db
    .select({ roomId: roomAgents.roomId })
    .from(roomAgents)
    .where(eq(roomAgents.agentId, parsed.data.agentId))

  for (const { roomId } of agentRoomsList) {
    void broadcast(roomId, {
      type: "computer.state",
      agentId: parsed.data.agentId,
      status: parsed.data.status,
    }).catch(() => {})
  }

  return c.json({ ok: true })
})

// ── Bot Computer: Get granted env placeholders ──────────────────────────────

internalRoutes.get("/internal/computer/:agentId/grants-env", async (c) => {
  const agentId = c.req.param("agentId")
  const db = getDb()
  const now = new Date()

  const grants = await db
    .select({
      envName: agentSecretGrants.envName,
      placeholder: agentSecretGrants.placeholder,
    })
    .from(agentSecretGrants)
    .where(
      and(
        eq(agentSecretGrants.agentId, agentId),
        isNull(agentSecretGrants.revokedAt),
        or(isNull(agentSecretGrants.expiresAt), gt(agentSecretGrants.expiresAt, now)),
      ),
    )

  const env: Record<string, string> = {}
  for (const g of grants) {
    env[g.envName] = g.placeholder
  }

  return c.json({ env })
})

// ── Tasks: Wake trigger ─────────────────────────────────────────────────────

const taskWakeSchema = z.object({
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  reason: z.enum(["assigned", "unblocked", "synthesize", "budget_extended"]),
})

internalRoutes.post("/internal/tasks/wake", async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = taskWakeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: "invalid body" }, 400)

  await enqueueTaskWake(parsed.data)
  return c.json({ queued: true })
})
