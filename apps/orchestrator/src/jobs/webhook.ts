import { redactSecrets, type WebhookPayload } from "@sayabot/core"
import { signWebhook } from "@sayabot/core/server"
import { agents, webhookDeliveries } from "@sayabot/db"
import { openSecret } from "@sayabot/llm"
import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"
import { assertSafeWebhookUrl } from "../ssrf"

export interface WebhookJobData {
  orgId: string
  roomId: string
  agentId: string
  messageId: string
  sessionId: string
  payload: WebhookPayload
}

async function logDelivery(args: {
  data: WebhookJobData
  attempt: number
  statusCode?: number
  responseMs?: number
  error?: string
}) {
  await getDb()
    .insert(webhookDeliveries)
    .values({
      orgId: args.data.orgId,
      roomId: args.data.roomId,
      agentId: args.data.agentId,
      messageId: args.data.messageId,
      attempt: args.attempt,
      statusCode: args.statusCode,
      responseMs: args.responseMs,
      error: args.error,
    })
    .catch((error) => console.error("[webhook] failed to log delivery", error))
}

/**
 * Delivers one signed webhook attempt. Throwing asks pg-boss to retry with
 * backoff; permanent configuration and SSRF failures are logged and dropped.
 */
export async function deliverWebhook(data: WebhookJobData, attempt: number): Promise<void> {
  const [agent] = await getDb().select().from(agents).where(eq(agents.id, data.agentId)).limit(1)
  if (!agent?.webhookUrl || !agent.webhookSecretEnc) {
    await logDelivery({ data, attempt, error: "agent has no webhook URL or secret" })
    return
  }
  let secret: string
  try {
    secret = openSecret(agent.webhookSecretEnc, getEnv().MESH_KEK)
  } catch {
    await logDelivery({ data, attempt, error: "stored webhook secret is unreadable" })
    return
  }
  let url: URL
  try {
    url = await assertSafeWebhookUrl(agent.webhookUrl, getEnv().MESH_ALLOW_PRIVATE_WEBHOOKS)
  } catch (error) {
    await logDelivery({
      data,
      attempt,
      error: `blocked webhook target: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }

  const body = JSON.stringify(data.payload)
  const webhookId = `msg_${randomUUID()}`
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signWebhook({ secret, id: webhookId, timestamp, body })
  const started = Date.now()
  let statusCode: number | undefined
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "sayabot-webhook/1.0",
        "webhook-id": webhookId,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    })
    statusCode = response.status
    await response.arrayBuffer().catch(() => {})
    await logDelivery({ data, attempt, statusCode, responseMs: Date.now() - started })
    if (!response.ok) {
      throw new Error(`webhook responded ${response.status}`)
    }
  } catch (error) {
    await logDelivery({
      data,
      attempt,
      statusCode,
      responseMs: Date.now() - started,
      error: redactSecrets(error instanceof Error ? error.message : String(error)).text,
    })
    throw error
  }
}
