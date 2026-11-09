import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { requireOrgAccess, isOrgAdmin } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { parseCapabilities } from "@sayabot/core"
import { saveAgentAsTemplate } from "@/lib/actions/templates"
import { ActionForm } from "@/components/ui/action-form"
import { ComputerPanel, type ComputerInfo } from "@/components/room/computer-panel"
import { listAgentConnectorGrants, listWorkspaceConnectors } from "@/lib/queries"
import { AgentConnectorScopeManager } from "@/components/agents/agent-connector-scope"

export const metadata: Metadata = { title: "Agent Profile" }

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ org: string; agentId: string }>
}) {
  const { org: orgSlug, agentId } = await params
  const access = await requireOrgAccess(orgSlug)
  if (!access) notFound()

  const admin = createAdminClient()

  // 1. Fetch agent
  const { data: agent } = await admin
    .from("agents")
    .select("*, agent_computers(*)")
    .eq("id", agentId)
    .eq("org_id", access.org.id)
    .maybeSingle()

  if (!agent) notFound()

  // 2. Fetch grants
  const { data: grants } = await admin
    .from("agent_secret_grants")
    .select("id, env_name, placeholder, allowed_hosts, inject, requires_approval, vault_secrets(label, last4)")
    .eq("agent_id", agent.id)
    .is("revoked_at", null)

  // 3. Fetch assigned tasks
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, number, title, status, room_id, created_at, rooms(name)")
    .eq("assignee_agent_id", agent.id)
    .order("created_at", { ascending: false })
    .limit(10)

  // 4. Fetch connector grants and workspace connectors
  const [connectorGrants, availableConnectors] = await Promise.all([
    listAgentConnectorGrants(access.org.id, agent.id),
    listWorkspaceConnectors(access.org.id),
  ])

  const capabilities = parseCapabilities(agent.capabilities)
  const computer = agent.agent_computers?.[0]
  const canEdit = isOrgAdmin(access.role)

  const computerList: ComputerInfo[] = computer
    ? [
        {
          agentId: agent.id,
          handle: agent.handle,
          displayName: agent.display_name,
          status: computer.status,
          profile: computer.profile,
          lastActiveAt: computer.last_active_at,
        },
      ]
    : []

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 space-y-8">
        {/* Breadcrumb */}
        <div>
          <p className="font-mono text-[12px] text-faint">
            <Link href={`/${orgSlug}`} className="hover:text-text">
              workspace
            </Link>{" "}
            /{" "}
            <Link href={`/${orgSlug}/agents`} className="hover:text-text">
              agents
            </Link>{" "}
            / @{agent.handle}
          </p>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                @{agent.handle.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{agent.display_name}</h1>
                <p className="font-mono text-xs text-muted-foreground">@{agent.handle} · {agent.kind}</p>
              </div>
            </div>

            {canEdit && (
              <ActionForm action={saveAgentAsTemplate} submitLabel="Save as Template" submitVariant="outline">
                <input type="hidden" name="orgSlug" value={orgSlug} />
                <input type="hidden" name="agentId" value={agent.id} />
                <input type="hidden" name="name" value={`${agent.display_name} Template`} />
                <input type="hidden" name="description" value={agent.bio || `Template derived from @${agent.handle}`} />
              </ActionForm>
            )}
          </div>
        </div>

        {/* Model & Config */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-border bg-card space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Model & Runtime</h3>
            <div className="flex items-center justify-between text-sm font-medium">
              <span>{agent.model || "Default Model"}</span>
              <span className="font-mono text-xs text-muted-foreground">
                Engine: {(agent.params as any)?.engine || "v1"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>Max Steps: {(agent.params as any)?.maxSteps ?? 6}</span>
              <span>Temp: {(agent.params as any)?.temperature ?? "default"}</span>
            </div>
            {agent.system_prompt && (
              <div className="mt-2 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg line-clamp-4 font-mono">
                {agent.system_prompt}
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl border border-border bg-card space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Capabilities</h3>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {Object.entries(capabilities).map(([k, v]) => (
                <span
                  key={k}
                  className={`text-xs px-2 py-0.5 rounded-md font-mono ${
                    v ? "bg-primary/10 text-primary font-medium" : "bg-muted text-faint line-through"
                  }`}
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Bot Computer Panel */}
        {capabilities.computer && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Persistent Computer</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Isolated gVisor container with volume {computer?.volume || "default"}.
              </p>
            </div>
            <div className="h-96">
              <ComputerPanel orgSlug={orgSlug} computers={computerList} />
            </div>
          </div>
        )}

        {/* Secret Grants */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Secret Grants</h3>
            <Link
              href={`/${orgSlug}/settings/vault`}
              className="text-xs text-primary font-medium hover:underline"
            >
              Manage in Vault →
            </Link>
          </div>

          {(grants ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No secrets granted to this bot.</p>
          ) : (
            <div className="divide-y divide-border">
              {(grants ?? []).map((g: any) => (
                <div key={g.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-medium">${g.env_name}</span>
                    <span className="text-muted-foreground ml-2">({g.vault_secrets?.label})</span>
                    <div className="text-[11px] text-faint mt-0.5">
                      Hosts: {g.allowed_hosts?.join(", ")}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-muted bg-muted px-1.5 py-0.5 rounded">
                    {g.placeholder?.slice(0, 16)}...
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workspace Connectors & Scoping */}
        <AgentConnectorScopeManager
          orgSlug={orgSlug}
          agentId={agent.id}
          grants={connectorGrants}
          availableConnectors={availableConnectors}
          canEdit={canEdit}
        />

        {/* Recent Tasks */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Assigned Tasks</h3>
          {(tasks ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No tasks currently assigned to this bot.</p>
          ) : (
            <div className="divide-y divide-border">
              {(tasks ?? []).map((t: any) => (
                <div key={t.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono text-faint mr-2">MESH-{t.number}</span>
                    <span className="font-medium text-foreground">{t.title}</span>
                    <span className="text-muted-foreground ml-2">in #{t.rooms?.name}</span>
                  </div>
                  <span className="capitalize px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground">
                    {t.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
