import { createClient } from "@supabase/supabase-js"
import "dotenv/config"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const emailA = process.env.E2E_USER_A_EMAIL
const emailB = process.env.E2E_USER_B_EMAIL
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:7431"

if (!url || !serviceKey) {
  throw new Error("E2E needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
}
if (!emailA || !emailB) {
  throw new Error("E2E needs E2E_USER_A_EMAIL and E2E_USER_B_EMAIL in .env")
}

const admin = createClient<any>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

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

async function ensureUser(email: string, name: string) {
  let user = await findUser(email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: `E2e-${crypto.randomUUID()}-aA1!`,
      user_metadata: { full_name: name },
    })
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`)
    user = data.user
  }
  const { error: profileError } = await admin
    .from("profiles")
    .update({ display_name: name })
    .eq("id", user.id)
  if (profileError) throw new Error(`profile ${email}: ${profileError.message}`)
  return user
}

const orgSlug = process.env.E2E_ORG_SLUG ?? "mesh-e2e"

async function main() {
  const userA = await ensureUser(emailA!, "Ada E2E")
  const userB = await ensureUser(emailB!, "Bilal E2E")

  const { data: existingOrg, error: orgLookupError } = await admin
    .from("orgs")
    .select("id, slug, name")
    .eq("slug", orgSlug)
    .maybeSingle()
  if (orgLookupError) throw new Error(orgLookupError.message)

  let org = existingOrg
  if (!org) {
    const { data, error } = await admin
      .from("orgs")
      .insert({ slug: orgSlug, name: "Mesh E2E" })
      .select("id, slug, name")
      .single()
    if (error || !data) throw new Error(`create org: ${error?.message}`)
    org = data
  }

  await admin.from("org_members").upsert(
    [
      { org_id: org.id, user_id: userA.id, role: "owner" },
      { org_id: org.id, user_id: userB.id, role: "member" },
    ],
    { onConflict: "org_id,user_id" },
  )

  await admin.from("rooms").delete().eq("org_id", org.id)
  await admin.from("agents").delete().eq("org_id", org.id)
  await admin.from("mcp_servers").delete().eq("org_id", org.id)

  const { data: rooms, error: roomError } = await admin
    .from("rooms")
    .insert([
      {
        org_id: org.id,
        name: "e2e-general",
        kind: "private",
        turn_mode: "mentions",
        turn_cap: 3,
        created_by: userA.id,
      },
      {
        org_id: org.id,
        name: "e2e-cap",
        kind: "private",
        turn_mode: "mentions",
        turn_cap: 1,
        created_by: userA.id,
      },
    ])
    .select("id, name")
  if (roomError || !rooms) throw new Error(`create rooms: ${roomError?.message}`)
  const general = rooms.find((room) => room.name === "e2e-general")!
  const cap = rooms.find((room) => room.name === "e2e-cap")!

  const { error: memberError } = await admin.from("room_members").insert(
    [general.id, cap.id].flatMap((roomId) => [
      { room_id: roomId, user_id: userA.id, role: "admin" as const },
      { room_id: roomId, user_id: userB.id, role: "member" as const },
    ]),
  )
  if (memberError) throw new Error(`room members: ${memberError.message}`)

  const { data: agents, error: agentError } = await admin
    .from("agents")
    .insert([
      {
        org_id: org.id,
        handle: "e2e-a",
        display_name: "E2E A",
        kind: "llm",
        model: null,
        provider_key_id: null,
        system_prompt:
          "You are E2E A. Answer in one short sentence. Do not mention other agents unless asked.",
        params: {},
        tool_ids: [],
      },
      {
        org_id: org.id,
        handle: "e2e-b",
        display_name: "E2E B",
        kind: "llm",
        model: null,
        provider_key_id: null,
        system_prompt:
          "You are E2E B. Answer in one short sentence. Do not mention other agents unless asked.",
        params: {},
        tool_ids: [],
      },
    ])
    .select("id, handle")
  if (agentError || !agents) throw new Error(`create agents: ${agentError?.message}`)
  const agentA = agents.find((agent) => agent.handle === "e2e-a")!
  const agentB = agents.find((agent) => agent.handle === "e2e-b")!

  const { error: roomAgentError } = await admin.from("room_agents").insert(
    [general.id, cap.id].flatMap((roomId) => [
      { room_id: roomId, agent_id: agentA.id, position: 0 },
      { room_id: roomId, agent_id: agentB.id, position: 1 },
    ]),
  )
  if (roomAgentError) throw new Error(`room agents: ${roomAgentError.message}`)

  const approvalArgs = {
    action: "commit_file",
    owner: "mesh-e2e",
    repo: "fixture",
    path: "README.md",
    content: "e2e",
    message: "e2e approval",
  }
  const { data: approvals, error: approvalError } = await admin
    .from("tool_calls")
    .insert([
      {
        room_id: general.id,
        tool_name: "github_bridge",
        args: approvalArgs,
        status: "pending_approval",
      },
      {
        room_id: general.id,
        tool_name: "github_bridge",
        args: { ...approvalArgs, path: "SECOND.md" },
        status: "pending_approval",
      },
    ])
    .select("id")
  if (approvalError || !approvals) throw new Error(`tool calls: ${approvalError?.message}`)

  const state = {
    baseURL,
    orgSlug,
    orgId: org.id,
    generalRoomId: general.id,
    capRoomId: cap.id,
    emailA: emailA!,
    emailB: emailB!,
    approveToolCallId: approvals[0]!.id,
    rejectToolCallId: approvals[1]!.id,
  }
  writeFileSync(resolve(process.cwd(), ".e2e-state.json"), JSON.stringify(state, null, 2))
  console.log("[e2e] seeded", state)
}

export default main
