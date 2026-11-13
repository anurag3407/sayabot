import { agents, mobilePushTokens, orgMembers, orgs, pushSubscriptions, roomMembers, rooms } from "@sayabot/db"
import { and, eq, inArray } from "drizzle-orm"
import webpush from "web-push"
import { getDb } from "./db"
import { getEnv } from "./env"

const PUSH_TTL_SECONDS = 300

let configured: boolean | null = null

function pushReady(): boolean {
  if (configured !== null) return configured
  const env = getEnv()
  configured = Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
  if (configured) {
    webpush.setVapidDetails(
      env.VAPID_SUBJECT!,
      env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      env.VAPID_PRIVATE_KEY!,
    )
  }
  return configured
}

/** Everyone who is able to decide on an approval in this room. */
async function roomApprovers(roomId: string): Promise<{ orgId: string; userIds: string[] } | null> {
  const db = getDb()
  const [room] = await db.select({ orgId: rooms.orgId }).from(rooms).where(eq(rooms.id, roomId)).limit(1)
  if (!room) return null
  const [admins, orgAdmins] = await Promise.all([
    db
      .select({ userId: roomMembers.userId })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.role, "admin"))),
    db
      .select({ userId: orgMembers.userId })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, room.orgId), inArray(orgMembers.role, ["owner", "admin"]))),
  ])
  return {
    orgId: room.orgId,
    userIds: [...new Set([...admins, ...orgAdmins].map((row) => row.userId))],
  }
}

async function sendToUsers(
  userIds: string[],
  payload: { title: string; body: string; url: string; tag: string },
): Promise<void> {
  if (!userIds.length) return
  const db = getDb()
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds))
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          { TTL: PUSH_TTL_SECONDS },
        )
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        // The browser dropped this subscription, so it can never be delivered again.
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id))
        } else {
          console.warn("[push] delivery failed", status ?? error)
        }
      }
    }),
  )
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

/**
 * Phone alerts through Expo's push service. A question carries the "question" category
 * (Answer with a text box); an approval carries "approval" (Allow / Don't allow), so people can
 * act from the lock screen. Tokens Expo reports as gone are deleted.
 */
async function sendToPhones(
  userIds: string[],
  payload: { title: string; body: string; data: Record<string, unknown>; category: string; threadId: string },
): Promise<void> {
  if (!userIds.length) return
  const db = getDb()
  const tokens = await db
    .select({ id: mobilePushTokens.id, token: mobilePushTokens.token })
    .from(mobilePushTokens)
    .where(inArray(mobilePushTokens.userId, userIds))
  if (!tokens.length) return
  const messages = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body.slice(0, 180),
    data: payload.data,
    categoryId: payload.category,
    sound: "default",
    priority: "high",
    channelId: "agents",
    threadId: payload.threadId,
  }))
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    })
    const json = (await res.json().catch(() => null)) as { data?: Array<{ status: string; details?: { error?: string } }> } | null
    const gone = (json?.data ?? [])
      .map((r, i) => (r.status === "error" && r.details?.error === "DeviceNotRegistered" ? tokens[i]?.id : null))
      .filter((id): id is string => Boolean(id))
    if (gone.length) await db.delete(mobilePushTokens).where(inArray(mobilePushTokens.id, gone))
  } catch (error) {
    console.warn("[push] phone delivery failed", error)
  }
}

async function agentName(agentId: string): Promise<string> {
  const [agent] = await getDb()
    .select({ name: agents.displayName })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
  return agent?.name ?? "An agent"
}

/**
 * Alerts people who can act when an agent stops to wait for them. Delivery is best effort and
 * never holds up the agent: failures are logged, and the Inbox still has the item.
 */
export function notifyHumansNeeded(args: {
  roomId: string
  agentId: string
  kind: "approval" | "request"
  detail: string
  /** The question (task id) or tool call waiting, so a phone alert can act on it directly. */
  refId?: string
}): void {
  void (async () => {
    const approvers = await roomApprovers(args.roomId)
    if (!approvers) return
    const [org, who] = await Promise.all([
      getDb().select({ slug: orgs.slug }).from(orgs).where(eq(orgs.id, approvers.orgId)).limit(1),
      agentName(args.agentId),
    ])
    const slug = org[0]?.slug
    if (!slug) return
    const title = args.kind === "approval" ? `${who} needs your approval` : `${who} has a question`
    await sendToPhones(approvers.userIds, {
      title,
      body: args.kind === "approval" ? `Wants to use ${args.detail.replace(/_/g, " ")}. It expires in 5 minutes.` : args.detail,
      data: { kind: args.kind, refId: args.refId ?? null, roomId: args.roomId, orgSlug: slug },
      category: args.refId ? (args.kind === "approval" ? "approval" : "question") : "info",
      threadId: args.roomId,
    })
    if (!pushReady()) return
    await sendToUsers(approvers.userIds, {
      title: args.kind === "approval" ? `${who} needs your approval` : `${who} has a question`,
      body:
        args.kind === "approval"
          ? `Wants to use ${args.detail}. It expires in 5 minutes.`
          : args.detail,
      url: `/${slug}/inbox`,
      tag: `mesh-${args.kind}-${args.roomId}`,
    })
  })().catch((error) => console.warn("[push] could not send alert", error))
}
