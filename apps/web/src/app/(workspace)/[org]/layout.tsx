import { requireOrgAccess, listUserOrgs } from "@/lib/auth"
import { listOrgAgents } from "@/lib/queries"
import { loadChatList } from "@/lib/queries-ia"
import { WorkspaceShell } from "@/components/workspace-shell"
import { PLANS } from "@sayabot/core"
import { isOrgAdmin } from "@/lib/auth"
import { edition } from "@/lib/env"
import { workspacePlan, workspaceUsage } from "@/lib/plan-limits"
import { ensureWorkspaceOrchestrator } from "@/lib/saya"
import { loadSidebarUsage } from "@/lib/sidebar-usage"

/** Sayabot Cloud admins: how much of the month's server replies are used, once it's 80% or more. */
async function planUsageNotice(orgId: string, admin: boolean) {
  if (edition() !== "cloud" || !admin) return null
  const [{ plan }, usage] = await Promise.all([workspacePlan(orgId), workspaceUsage(orgId)])
  const limit = PLANS[plan].limits.serverTurnsPerMonth
  if (limit === null || usage.serverTurns < limit * 0.8) return null
  return { used: usage.serverTurns, limit, planName: PLANS[plan].name }
}

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ org: string }>
}) {
  const { org: orgSlug } = await params
  const access = await requireOrgAccess(orgSlug)
  // Existing workspaces were created before Saya. Do this before the agent list is read,
  // otherwise the sidebar stays empty for this request.
  try {
    await ensureWorkspaceOrchestrator({ orgId: access.org.id, userId: access.user.id })
  } catch (error) {
    console.warn("[saya] could not ensure the workspace orchestrator", error)
  }
  const [chatData, orgAgents, orgs, planUsage, usage] = await Promise.all([
    loadChatList(access),
    listOrgAgents(access.org.id),
    listUserOrgs(access.user.id),
    planUsageNotice(access.org.id, isOrgAdmin(access.role)),
    loadSidebarUsage(access.org.id),
  ])
  return (
    <WorkspaceShell
      org={{ slug: access.org.slug, name: access.org.name }}
      orgs={orgs}
      chats={chatData.items}
      bots={orgAgents.map((agent) => ({
        id: agent.id,
        handle: agent.handle,
        displayName: agent.displayName,
        kind: agent.kind,
      }))}
      inboxCount={chatData.inboxCount}
      user={{
        id: access.user.id,
        notifications: access.user.notifications,
        sound: access.user.sound,
        displayName: access.user.displayName,
        avatarUrl: access.user.avatarUrl,
        email: access.user.email,
        isGuest: access.user.isGuest === true,
      }}
      role={access.role}
      planUsage={planUsage}
      usage={usage}
    >
      {children}
    </WorkspaceShell>
  )
}
