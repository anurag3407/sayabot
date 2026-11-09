import type { Metadata } from "next"
import Link from "next/link"
import { randomBytes } from "node:crypto"
import { redirect } from "next/navigation"
import { hashAgentApiKey } from "@sayabot/core/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser, isOrgAdmin } from "@/lib/auth"
import { SayabotMark } from "@/components/landing/sayabot-mark"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/format"
import type { OrgRole } from "@/lib/types"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Authorize bot access" }

/** Every scope the MCP server understands, with the words shown on the consent screen. */
const SCOPES: Record<string, string> = {
  "room:read": "Read messages in the room",
  "room:write": "Post messages in the room",
  "tasks:read": "See the task board",
  "tasks:write": "Create and update tasks",
  "canvas:read": "Read shared canvases",
  "canvas:write": "Edit shared canvases",
  "secrets:use": "Use secrets granted to it (never sees the values)",
}
const DEFAULT_SCOPES = Object.keys(SCOPES)

interface Params {
  client_id?: string
  redirect_uri?: string
  response_type?: string
  code_challenge?: string
  code_challenge_method?: string
  state?: string
  scope?: string
  invite?: string
}

function requestedScopes(scope: string | undefined): string[] {
  if (!scope) return DEFAULT_SCOPES
  const asked = scope.split(/[\s,]+/).filter(Boolean)
  return DEFAULT_SCOPES.filter((known) => asked.includes(known))
}

type Resolved =
  | { ok: false; title: string; detail: string }
  | {
      ok: true
      clientId: string
      clientName: string
      redirectUri: string
      redirectHost: string
      codeChallenge: string
      state: string | undefined
      scopes: string[]
      orgId: string
      orgName: string
      roomId: string | null
      roomName: string | null
    }

/**
 * Validates the request against what the client registered and what this user may grant.
 * Runs on render and again inside the server action, so a forged form post gets the same checks.
 */
async function resolveRequest(params: Params, userId: string): Promise<Resolved> {
  const { client_id, redirect_uri, code_challenge, invite } = params
  const method = params.code_challenge_method ?? "S256"
  if (!client_id || !redirect_uri || !code_challenge) {
    return {
      ok: false,
      title: "Incomplete request",
      detail: "The app did not send client_id, redirect_uri and code_challenge.",
    }
  }
  if ((params.response_type ?? "code") !== "code") {
    return {
      ok: false,
      title: "Unsupported request",
      detail: "Only response_type=code is supported.",
    }
  }
  if (method !== "S256") {
    return {
      ok: false,
      title: "Unsupported request",
      detail: "Only S256 PKCE challenges are accepted.",
    }
  }

  const admin = createAdminClient()
  const { data: client } = await admin
    .from("oauth_clients")
    .select("client_name, redirect_uris")
    .eq("client_id", client_id)
    .maybeSingle()
  if (!client) {
    return { ok: false, title: "Unknown app", detail: "This app is not registered with Sayabot." }
  }
  const registered = Array.isArray(client.redirect_uris) ? (client.redirect_uris as string[]) : []
  if (!registered.includes(redirect_uri)) {
    // Never redirect anywhere here: an unregistered redirect_uri is how codes get stolen.
    return {
      ok: false,
      title: "Redirect not allowed",
      detail: "The app asked to return to an address it did not register.",
    }
  }
  let redirectHost: string
  try {
    redirectHost = new URL(redirect_uri).host || redirect_uri
  } catch {
    return {
      ok: false,
      title: "Invalid redirect",
      detail: "The redirect address is not a valid URL.",
    }
  }

  const scopes = requestedScopes(params.scope)
  if (scopes.length === 0) {
    return {
      ok: false,
      title: "No permissions requested",
      detail: "The app asked for scopes Sayabot does not recognise.",
    }
  }

  const { data: memberships } = await admin
    .from("org_members")
    .select("org_id, role, orgs!inner(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
  const rows = (memberships ?? []) as unknown as {
    org_id: string
    role: OrgRole
    orgs: { name: string }
  }[]

  let orgId: string
  let orgName: string
  let roomId: string | null = null
  let roomName: string | null = null

  if (invite) {
    const { data: inviteRow } = await admin
      .from("room_invites")
      .select("room_id, org_id, expires_at, revoked_at, rooms(name)")
      .eq("code_hash", hashAgentApiKey(invite))
      .maybeSingle()
    if (!inviteRow || inviteRow.revoked_at) {
      return {
        ok: false,
        title: "Invite not valid",
        detail: "This invite was revoked or never existed.",
      }
    }
    if (new Date(inviteRow.expires_at) < new Date()) {
      return {
        ok: false,
        title: "Invite expired",
        detail: "Ask a room admin for a new invite link.",
      }
    }
    const membership = rows.find((row) => row.org_id === inviteRow.org_id)
    if (!membership) {
      return {
        ok: false,
        title: "Not a member",
        detail: "You must belong to the workspace that issued this invite.",
      }
    }
    orgId = inviteRow.org_id
    orgName = membership.orgs.name
    roomId = inviteRow.room_id
    roomName = (inviteRow.rooms as { name?: string } | null)?.name ?? "Room"
  } else {
    // Without an invite the bot joins the workspace itself, which only admins may allow.
    const adminOf = rows.find((row) => isOrgAdmin(row.role))
    if (!adminOf) {
      return {
        ok: false,
        title: "Admin access needed",
        detail: "Only workspace admins can connect a bot without a room invite.",
      }
    }
    orgId = adminOf.org_id
    orgName = adminOf.orgs.name
  }

  return {
    ok: true,
    clientId: client_id,
    clientName: client.client_name || "External bot",
    redirectUri: redirect_uri,
    redirectHost,
    codeChallenge: code_challenge,
    state: params.state,
    scopes,
    orgId,
    orgName,
    roomId,
    roomName,
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-void px-4 py-10 text-text">
      <div className="w-full max-w-md rounded-[18px] border border-line bg-ink p-6">{children}</div>
    </main>
  )
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const params = await searchParams
  const user = await getCurrentUser()
  if (!user) {
    const query = new URLSearchParams(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    )
    redirect(`/login?return_to=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`)
  }

  const resolved = await resolveRequest(params, user.id)
  if (!resolved.ok) {
    return (
      <Frame>
        <SayabotMark className="h-8 w-8" />
        <h1 className="mt-4 text-lg font-medium">{resolved.title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{resolved.detail}</p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "mt-6 w-full")}>
          Back to Sayabot
        </Link>
      </Frame>
    )
  }

  async function handleAuthorize(formData: FormData) {
    "use server"
    const currentUser = await getCurrentUser()
    if (!currentUser) throw new Error("Unauthorized")
    const request = await resolveRequest(params, currentUser.id)
    if (!request.ok) throw new Error(request.detail)

    const rawHandle = String(formData.get("handle") ?? "")
      .toLowerCase()
      .trim()
    const handle =
      rawHandle.replace(/[^a-z0-9_-]/g, "").slice(0, 32) ||
      `${
        request.clientName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 24) || "bot"
      }-${randomBytes(2).toString("hex")}`

    const serverAdmin = createAdminClient()
    const { data: agent, error: agentError } = await serverAdmin
      .from("agents")
      .insert({
        org_id: request.orgId,
        handle,
        display_name: request.clientName,
        kind: "external",
        visibility: "team",
        room_ids: request.roomId ? [request.roomId] : [],
      })
      .select()
      .single()
    if (agentError || !agent) {
      throw new Error(
        agentError?.code === "23505"
          ? `@${handle} is already taken in this workspace`
          : "Could not create the bot",
      )
    }
    if (request.roomId) {
      await serverAdmin.from("room_agents").insert({ room_id: request.roomId, agent_id: agent.id })
    }

    const rawCode = `mesh_code_${randomBytes(24).toString("hex")}`
    await serverAdmin.from("oauth_codes").insert({
      code_hash: hashAgentApiKey(rawCode),
      client_id: request.clientId,
      agent_id: agent.id,
      code_challenge: request.codeChallenge,
      redirect_uri: request.redirectUri,
      scopes: request.scopes,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })

    const target = new URL(request.redirectUri)
    target.searchParams.set("code", rawCode)
    if (request.state) target.searchParams.set("state", request.state)
    redirect(target.toString())
  }

  const suggestedHandle =
    resolved.clientName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 32) || "bot"

  return (
    <Frame>
      <div className="flex items-center gap-3">
        <SayabotMark className="h-9 w-9" />
        <div className="min-w-0">
          <h1 className="text-[15px] font-medium">Connect {resolved.clientName}</h1>
          <p className="truncate text-[12px] text-faint">Signed in as {user.email}</p>
        </div>
      </div>

      <p className="mt-5 text-[13px] leading-relaxed text-muted">
        <span className="text-text">{resolved.clientName}</span> wants to join{" "}
        <span className="text-text">
          {resolved.roomName ? `#${resolved.roomName}` : "your workspace"}
        </span>{" "}
        in <span className="text-text">{resolved.orgName}</span> as a bot.
      </p>

      <div className="mt-4 rounded-xl border border-line bg-panel p-3">
        <p className="text-[12px] text-faint">It will be able to</p>
        <ul className="mt-2 space-y-1.5">
          {resolved.scopes.map((scope) => (
            <li key={scope} className="flex items-start gap-2 text-[13px]">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
              {SCOPES[scope]}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-faint">
        After you approve, you will be sent to{" "}
        <span className="font-mono text-muted">{resolved.redirectHost}</span>. Only continue if you
        started this from that app.
      </p>

      <form action={handleAuthorize} className="mt-5">
        <label htmlFor="handle" className="block text-[12px] text-muted">
          Bot handle
        </label>
        <div className="mt-1.5 flex items-center rounded-sm border border-line-strong bg-void px-3 focus-within:border-accent">
          <span className="select-none text-[13px] text-faint">@</span>
          <input
            id="handle"
            name="handle"
            defaultValue={suggestedHandle}
            pattern="[a-zA-Z0-9_\-]{1,32}"
            maxLength={32}
            required
            className="h-10 w-full bg-transparent px-1 text-[13px] outline-none"
          />
        </div>
        <div className="mt-5 flex gap-2">
          <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "flex-1")}>
            Cancel
          </Link>
          <button type="submit" className={cn(buttonVariants({ variant: "primary" }), "flex-1")}>
            Approve
          </button>
        </div>
      </form>
    </Frame>
  )
}
