/**
 * Telegram/Discord gateway E2E — the whole product path over real HTTP.
 *
 * Real: Next dev server, orchestrator dev server, Postgres/Supabase (auth + data), the public
 * webhook route, the authenticated channels API, the bot settings page render, `/api/mobile/home`,
 * the agent turn and the outbound reply.
 * Faked: only the provider network — Telegram Bot API, Discord REST and the model endpoint are
 * `e2e/fake-chat-provider.mjs`, reached through TELEGRAM_API_BASE / DISCORD_API_BASE /
 * DEV_OPENAI_COMPAT_BASE_URL (see playwright.gateways.config.ts).
 *
 *   pnpm test:gateways
 */
import { expect, test, type Page } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { createDecipheriv } from "node:crypto"

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:7431"
const FAKE = `http://127.0.0.1:${process.env.FAKE_PROVIDER_PORT ?? 4599}`
const ORG_SLUG = process.env.E2E_ORG_SLUG ?? "gateway-e2e"
const EMAIL = process.env.E2E_USER_A_EMAIL ?? "gateway-e2e-a@sayabot.test"
const TG_TOKEN = "123456789:AAHfake_gateway_e2e_token_1234567890"
const DISCORD_TOKEN = "discord.e2e.fake.token.value"
const REPLY = "Gateway reply from the fake model."

let admin: SupabaseClient<any>
let orgId = ""
let agentA = ""
let agentB = ""
let telegramGatewayId = ""
let discordGatewayId = ""
const telegramRooms: string[] = []

function kekKey(): Buffer {
  const kek = process.env.MESH_KEK ?? process.env.SAYABOT_KEK
  if (!kek) throw new Error("MESH_KEK is not set")
  if (/^[0-9a-f]{64}$/i.test(kek)) return Buffer.from(kek, "hex")
  const raw = Buffer.from(kek, "base64")
  if (raw.length !== 32) throw new Error("MESH_KEK must decode to 32 bytes")
  return raw
}

/** Mirrors `openSecret` + `decryptSecret` from @sayabot/llm without importing app code. */
function openSealed(sealed: string): string {
  const envelope = JSON.parse(Buffer.from(sealed, "base64").toString("utf8")) as {
    ciphertext: string
    iv: string
    tag: string
  }
  const decipher = createDecipheriv("aes-256-gcm", kekKey(), Buffer.from(envelope.iv, "base64"))
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

type FakeCall = { provider: string; method: string; path: string; body: any; at: string }

async function fakeCalls(): Promise<FakeCall[]> {
  const response = await fetch(`${FAKE}/__calls`)
  return (await response.json()) as FakeCall[]
}

async function waitFor<T>(what: string, check: () => Promise<T | null>, timeoutMs = 240_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown = null
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500))
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ""}`)
}

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (data.users.length < 200) break
  }
  return null
}

const PASSWORD = process.env.E2E_PASSWORD ?? "Gateway-E2E-Pass-1!"

/**
 * Real Supabase session: password grant against the project's auth server, then the same cookie
 * `@supabase/ssr` writes (`sb-<ref>-auth-token`, `base64-`-prefixed, 3180-char chunks). The app
 * then authenticates every request from that cookie exactly as it would after a browser login.
 */
async function signIn(page: Page): Promise<void> {
  let user = await findUser(EMAIL)
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email: EMAIL,
      email_confirm: true,
      password: PASSWORD,
      user_metadata: { full_name: "Gateway E2E" },
    })
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`)
    user = created.data.user
  } else {
    const updated = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD })
    if (updated.error) throw new Error(`updateUser: ${updated.error.message}`)
  }

  const tokenResponse = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    },
  )
  const session = (await tokenResponse.json()) as Record<string, unknown>
  if (!tokenResponse.ok || !session.access_token) {
    throw new Error(`password grant failed: ${JSON.stringify(session)}`)
  }

  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).hostname.split(".")[0]
  const storageKey = `sb-${projectRef}-auth-token`
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`
  const chunkSize = 3180
  const chunks =
    encoded.length > chunkSize
      ? Array.from({ length: Math.ceil(encoded.length / chunkSize) }, (_, index) => ({
          name: `${storageKey}.${index}`,
          value: encoded.slice(index * chunkSize, (index + 1) * chunkSize),
        }))
      : [{ name: storageKey, value: encoded }]

  await page.context().addCookies(
    chunks.map((chunk) => ({
      ...chunk,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax" as const,
    })),
  )
}

test.describe.configure({ mode: "serial" })

test.beforeAll(async () => {
  admin = createClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  await fetch(`${FAKE}/__reset`, { method: "POST" })

  const { data: existing } = await admin.from("orgs").select("id").eq("slug", ORG_SLUG).maybeSingle()
  if (existing) {
    await admin.from("rooms").delete().eq("org_id", existing.id)
    await admin.from("agents").delete().eq("org_id", existing.id)
    await admin.from("orgs").delete().eq("id", existing.id)
  }
  const { data: org, error: orgError } = await admin
    .from("orgs")
    .insert({ slug: ORG_SLUG, name: "Gateway E2E" })
    .select("id")
    .single()
  if (orgError || !org) throw new Error(`create org: ${orgError?.message}`)
  orgId = org.id

  const user = (await findUser(EMAIL)) ?? null
  if (user) {
    await admin
      .from("org_members")
      .upsert({ org_id: orgId, user_id: user.id, role: "owner" }, { onConflict: "org_id,user_id" })
  }

  const { data: agents, error: agentError } = await admin
    .from("agents")
    .insert([
      {
        org_id: orgId,
        handle: "gateway-a",
        display_name: "Gateway A",
        kind: "llm",
        model: null,
        provider_key_id: null,
        system_prompt: "You are Gateway A. Answer in one short sentence.",
        params: {},
        tool_ids: [],
      },
      {
        org_id: orgId,
        handle: "gateway-b",
        display_name: "Gateway B",
        kind: "llm",
        model: null,
        provider_key_id: null,
        system_prompt: "You are Gateway B. Answer in one short sentence.",
        params: {},
        tool_ids: [],
      },
    ])
    .select("id, handle")
  if (agentError || !agents) throw new Error(`create agents: ${agentError?.message}`)
  agentA = agents.find((agent) => agent.handle === "gateway-a")?.id as string
  agentB = agents.find((agent) => agent.handle === "gateway-b")?.id as string
  if (!agentA || !agentB) throw new Error("agents were not created")
})

test("channels API: create, list, cross-agent refusal, no sealed token in responses", async ({
  page,
}) => {
  await signIn(page)
  const url = `/api/workspaces/${ORG_SLUG}/agents/${agentA}/channels`

  const created = await page.request.post(url, {
    data: { source: "telegram", token: TG_TOKEN },
  })
  expect(created.status(), await created.text()).toBe(201)
  const createdText = await created.text()
  expect(createdText).not.toContain(TG_TOKEN)
  expect(createdText).not.toContain("ciphertext")
  const createdBody = JSON.parse(createdText) as { channel: { id: string; name: string; last4: string } }
  expect(createdBody.channel.name).toBe("@gateway_e2e_bot")
  expect(createdBody.channel.last4).toBe(TG_TOKEN.slice(-4))
  telegramGatewayId = createdBody.channel.id

  const list = await page.request.get(url)
  expect(list.status()).toBe(200)
  const listText = await list.text()
  expect(listText).not.toContain(TG_TOKEN)
  const listBody = JSON.parse(listText) as { channels: { id: string; name: string }[] }
  expect(listBody.channels.map((channel) => channel.id)).toContain(telegramGatewayId)

  // The same bot token on a different agent must be refused: one bot identity, one agent.
  const reused = await page.request.post(`/api/workspaces/${ORG_SLUG}/agents/${agentB}/channels`, {
    data: { source: "telegram", token: TG_TOKEN },
  })
  expect(reused.status()).toBe(409)
  expect(await reused.text()).toContain("already connected")

  // A Discord bot for the second agent, verified through the faked /users/@me.
  const discord = await page.request.post(`/api/workspaces/${ORG_SLUG}/agents/${agentB}/channels`, {
    data: { source: "discord", token: DISCORD_TOKEN },
  })
  expect(discord.status(), await discord.text()).toBe(201)
  discordGatewayId = ((await discord.json()) as { channel: { id: string } }).channel.id

  const calls = await fakeCalls()
  expect(calls.some((call) => call.path.includes("/getMe"))).toBe(true)
  expect(calls.some((call) => call.path.includes("/setWebhook"))).toBe(true)
  expect(calls.some((call) => call.path === "/discord/users/@me")).toBe(true)
})

test("public webhook: valid update accepted, duplicate ignored, wrong secret rejected", async ({
  page,
}) => {
  const { data: row } = await admin
    .from("agent_gateways")
    .select("webhook_secret_enc")
    .eq("id", telegramGatewayId)
    .maybeSingle()
  const secret = openSealed((row as { webhook_secret_enc: string }).webhook_secret_enc)
  const webhook = `${BASE_URL}/api/gateways/telegram/${telegramGatewayId}/${secret}`

  const update = (id: number, chatId: number, type: "private" | "group", text: string) => ({
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type, ...(type === "group" ? { title: "Gateway E2E Group" } : {}) },
      from: { id: chatId, is_bot: false, first_name: "Alice", username: "alice" },
      text,
    },
  })

  const first = await page.request.post(webhook, { data: update(800001, 555001, "private", "hello bot") })
  expect(first.status()).toBe(200)
  expect(((await first.json()) as any).results[0].queued).toBe(true)

  const duplicate = await page.request.post(webhook, {
    data: update(800001, 555001, "private", "hello bot"),
  })
  expect(duplicate.status()).toBe(200)
  expect(((await duplicate.json()) as any).results[0].queued).toBe(false)

  const wrong = await page.request.post(
    `${BASE_URL}/api/gateways/telegram/${telegramGatewayId}/not-the-secret`,
    { data: update(800002, 555001, "private", "spoofed") },
  )
  expect(wrong.status()).toBe(401)

  // Discord has no message webhook — its route path refuses anything but Telegram.
  const discordWebhook = await page.request.post(
    `${BASE_URL}/api/gateways/discord/${discordGatewayId}/whatever`,
    { data: { content: "hi" } },
  )
  expect(discordWebhook.status()).toBe(404)

  // The mirrored room and its message are real rows.
  const mirrored = await waitFor("the Telegram mirror room", async () => {
    const { data } = await admin
      .from("external_chats")
      .select("room_id, external_chat_id")
      .eq("gateway_id", telegramGatewayId)
      .eq("external_chat_id", "555001")
      .maybeSingle()
    return data as { room_id: string } | null
  })
  telegramRooms.push(mirrored.room_id)
  const { data: room } = await admin.from("rooms").select("name").eq("id", mirrored.room_id).single()
  expect((room as { name: string }).name).toContain("Telegram")
})

test("orchestrator: the queued DM produces a real outbound send to the faked provider", async () => {
  const sent = await waitFor("the agent's Telegram reply", async () => {
    const calls = await fakeCalls()
    return (
      calls.find(
        (call) =>
          call.path.endsWith("/sendMessage") &&
          String(call.body?.chat_id) === "555001" &&
          String(call.body?.text ?? "").includes(REPLY),
      ) ?? null
    )
  })
  expect(sent.path).toContain("/telegram/")
})

test("orchestrator: silence in a group chat sends nothing", async ({ page }) => {
  const patched = await page.request.patch(
    `/api/workspaces/${ORG_SLUG}/agents/${agentA}/channels/${telegramGatewayId}`,
    { data: { silence: true } },
  )
  expect(patched.status()).toBe(200)

  const { data: row } = await admin
    .from("agent_gateways")
    .select("webhook_secret_enc")
    .eq("id", telegramGatewayId)
    .maybeSingle()
  const secret = openSealed((row as { webhook_secret_enc: string }).webhook_secret_enc)
  const response = await page.request.post(
    `${BASE_URL}/api/gateways/telegram/${telegramGatewayId}/${secret}`,
    {
      data: {
        update_id: 800010,
        message: {
          message_id: 800010,
          date: Math.floor(Date.now() / 1000),
          chat: { id: -100555, type: "group", title: "Gateway E2E Group" },
          from: { id: 555002, is_bot: false, first_name: "Bob", username: "bob" },
          text: "hello group",
        },
      },
    },
  )
  expect(response.status()).toBe(200)
  expect(((await response.json()) as any).results[0].queued).toBe(true)

  const group = await waitFor("the group mirror room message", async () => {
    const { data } = await admin
      .from("external_chats")
      .select("room_id")
      .eq("gateway_id", telegramGatewayId)
      .eq("external_chat_id", "-100555")
      .maybeSingle()
    if (!data) return null
    const { count } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", (data as { room_id: string }).room_id)
    return count && count > 0 ? (data as { room_id: string }) : null
  })
  telegramRooms.push(group.room_id)

  // Give the turn time to finish; no Telegram send for the group may appear.
  await page.waitForTimeout(20_000)
  const calls = await fakeCalls()
  const groupSends = calls.filter(
    (call) => call.path.endsWith("/sendMessage") && String(call.body?.chat_id) === "-100555",
  )
  expect(groupSends).toHaveLength(0)
})

test("bot settings page renders the Chat channels panel with the connected account", async ({
  page,
}) => {
  await page.goto(`/${ORG_SLUG}/agents/${agentA}`)
  await expect(page.getByText("Chat channels", { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("@gateway_e2e_bot")).toBeVisible()
  await expect(page.getByRole("button", { name: "Disconnect" }).first()).toBeVisible()
})

test("mobile home payload carries the gateway channel label next to normal chats", async ({
  page,
}) => {
  const response = await page.request.get(`/api/mobile/home?orgSlug=${ORG_SLUG}`)
  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    chats: { id: string; name: string; channel: string | null; lastMessage: unknown }[]
  }
  const telegramChat = body.chats.find((chat) => chat.id === telegramRooms[0])
  expect(telegramChat).toBeTruthy()
  expect(telegramChat?.channel).toBe("telegram")
  expect(telegramChat?.name).toContain("Telegram")
})

test("delete removes the channel row and its mirrored rooms", async ({ page }) => {
  const response = await page.request.delete(
    `/api/workspaces/${ORG_SLUG}/agents/${agentA}/channels/${telegramGatewayId}`,
  )
  expect(response.status(), await response.text()).toBe(200)

  const { data: gateway } = await admin
    .from("agent_gateways")
    .select("id")
    .eq("id", telegramGatewayId)
    .maybeSingle()
  expect(gateway).toBeNull()

  const { data: chats } = await admin
    .from("external_chats")
    .select("id")
    .eq("gateway_id", telegramGatewayId)
  expect(chats ?? []).toHaveLength(0)

  const { data: rooms } = await admin.from("rooms").select("id").in("id", telegramRooms)
  expect(rooms ?? []).toHaveLength(0)

  const discord = await page.request.delete(
    `/api/workspaces/${ORG_SLUG}/agents/${agentB}/channels/${discordGatewayId}`,
  )
  expect(discord.status()).toBe(200)
})
