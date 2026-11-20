/**
 * Local end-to-end check for per-agent gateways. Runs against a real Postgres (schema from
 * `pnpm db:migrate`) and a stubbed Telegram HTTP API, so the whole path is exercised:
 * sealed token -> gateway row -> inbound dedup -> one bound chat -> refusal -> reply delivery.
 *
 *   DATABASE_URL=... MESH_KEK=<64 hex> tsx scripts/gateway-e2e.local.ts
 */
import { randomUUID } from "node:crypto"
import { encryptSecret } from "@sayabot/llm"
import pg from "pg"
import { acceptGatewayInbound, deliverGatewayReply } from "../src/gateways/inbound"
import { startJobs } from "../src/jobs"

const KEK = process.env.MESH_KEK ?? "0".repeat(64)
const TOKEN = "123456789:AAFakeTelegramTokenForLocalTests"
const SECRET = "inbound-secret-for-tests"

function check(name: string, ok: boolean): void {
  console.log(`${ok ? "  ok" : "  FAIL"}  ${name}`)
  if (!ok) process.exitCode = 1
}

async function main(): Promise<void> {
  // Puts the queue in local (in-process) mode; the orchestrator does this on boot.
  await startJobs()
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  const suffix = randomUUID().slice(0, 8)
  const userId = randomUUID()
  const orgId = randomUUID()
  const agentId = randomUUID()

  await client.query("insert into profiles (id, display_name) values ($1, $2)", [
    userId,
    "Gateway Tester",
  ])
  await client.query("insert into orgs (id, slug, name) values ($1, $2, $3)", [
    orgId,
    `gw-${suffix}`,
    "Gateway Test",
  ])
  await client.query(
    "insert into agents (id, org_id, handle, display_name) values ($1, $2, $3, $4)",
    [agentId, orgId, `bot${suffix}`, "Gateway Bot"],
  )

  const sealed = encryptSecret(JSON.stringify({ token: TOKEN, inboundSecret: SECRET }), KEK)
  const gatewayId = randomUUID()
  await client.query(
    `insert into agent_gateways
      (id, org_id, agent_id, source, name, status, ciphertext, iv, tag, last4, token_fingerprint, webhook_secret_enc, created_by)
     values ($1,$2,$3,'telegram','@gateway_test_bot','active',$4,$5,$6,$7,$8,$9,$10)`,
    [
      gatewayId,
      orgId,
      agentId,
      sealed.ciphertext,
      sealed.iv,
      sealed.tag,
      TOKEN.slice(-4),
      `fp-${suffix}`,
      "sealed",
      userId,
    ],
  )

  console.log("inbound")
  const first = await acceptGatewayInbound({
    gatewayId,
    platform: "telegram",
    secret: SECRET,
    externalId: "upd-1",
    chatId: "5550001",
    sender: "@alice",
    senderId: "5550001",
    text: "hello bot",
    chatType: "dm",
  })
  check("first message queued", first.queued)

  const duplicate = await acceptGatewayInbound({
    gatewayId,
    platform: "telegram",
    secret: SECRET,
    externalId: "upd-1",
    chatId: "5550001",
    sender: "@alice",
    text: "hello bot",
    chatType: "dm",
  })
  check("duplicate delivery ignored", !duplicate.queued && duplicate.reason === "duplicate")

  const wrong = await acceptGatewayInbound({
    gatewayId,
    platform: "telegram",
    secret: "not-the-secret",
    externalId: "upd-2",
    chatId: "5550001",
    sender: "@alice",
    text: "spoofed",
  })
  check("wrong webhook secret rejected", !wrong.queued && wrong.reason === "bad key")

  console.log("reply delivery")
  const sent: { url: string; body: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: String(init?.body ?? "") })
    const payload = String(input).includes("api.telegram.org")
      ? { ok: true, result: { message_id: 42, chat: { id: 5550001 } } }
      : { id: "9001", channel_id: "5550001" }
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch

  const second = await acceptGatewayInbound({
    gatewayId,
    platform: "telegram",
    secret: SECRET,
    externalId: "upd-3",
    chatId: "7770002",
    sender: "@bob",
    senderId: "7770002",
    text: "second person",
    chatType: "dm",
  })
  check(
    "a second outside chat is refused",
    !second.queued && second.reason === "bound to another chat",
  )
  check(
    "the other chat got one refusal",
    sent.some((call) => call.body.includes("7770002") && call.body.includes("another chat")),
  )

  const bound = await client.query(
    "select bound_chat_id, room_id from agent_gateways where id = $1",
    [gatewayId],
  )
  check("gateway is bound to the first chat", bound.rows[0]?.bound_chat_id === "5550001")

  const rooms = await client.query(
    "select r.id, r.name, r.kind, e.external_chat_id from rooms r join external_chats e on e.room_id = r.id where e.org_id = $1 order by e.external_chat_id",
    [orgId],
  )
  check("one room exists", rooms.rowCount === 1)
  check(
    "the room is private and named after the channel",
    rooms.rows.every((row) => row.kind === "private" && row.name.includes("Telegram")),
  )
  check("the room is the gateway room", rooms.rows[0]?.id === bound.rows[0]?.room_id)

  const members = await client.query(
    "select count(*)::int as n from room_members rm join rooms r on r.id = rm.room_id where r.org_id = $1 and rm.user_id = $2",
    [orgId, userId],
  )
  check("connector is a member of the room", members.rows[0].n === 1)

  const messages = await client.query(
    "select content, metadata from messages m join rooms r on r.id = m.room_id where r.org_id = $1",
    [orgId],
  )
  check("one message stored", messages.rowCount === 1)
  const metadata = (messages.rows[0].metadata as { gateway?: { platform?: string } }).gateway
  check("message carries gateway metadata", metadata?.platform === "telegram")

  const agentsAttached = await client.query(
    "select count(*)::int as n from room_agents ra join rooms r on r.id = ra.room_id where r.org_id = $1 and ra.agent_id = $2",
    [orgId, agentId],
  )
  check("agent attached to the room", agentsAttached.rows[0].n === 1)

  const handled = await deliverGatewayReply(messages.rows[0].metadata, "reply from the bot")
  const reply = sent.find((call) => call.body.includes("reply from the bot"))
  check("gateway reply handled", handled)
  check("reply went to Telegram sendMessage", reply?.url.includes("sendMessage") === true)
  check("reply used the bound chat id", reply?.body.includes("5550001") === true)
  check("reply text sent", Boolean(reply))

  const viaRoom = await deliverGatewayReply(null, "typed in the app", bound.rows[0]?.room_id)
  check("a reply typed in the app reaches the bound chat", viaRoom === true)
  check(
    "the app reply used the bound chat id",
    sent.some((call) => call.body.includes("typed in the app") && call.body.includes("5550001")),
  )

  const before = sent.length
  const silent = await deliverGatewayReply(messages.rows[0].metadata, "[SILENT]")
  check("silence token handled without sending", silent && sent.length === before)

  const notGateway = await deliverGatewayReply({ connector: { id: "x" } }, "hello")
  check("non-gateway metadata falls through to connectors", notGateway === false)

  globalThis.fetch = realFetch

  console.log("cleanup")
  await client.query("delete from orgs where id = $1", [orgId])
  await client.query("delete from profiles where id = $1", [userId])
  await client.end()
  console.log(process.exitCode ? "FAILED" : "ALL CHECKS PASSED")
}

await main()
