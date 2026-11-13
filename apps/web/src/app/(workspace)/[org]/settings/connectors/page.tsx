import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { requireOrgAdmin } from "@/lib/auth"
import { listOrgAgents, listRooms, listWorkspaceConnectors } from "@/lib/queries"
import { Section } from "@/components/settings/section"
import { EmptyState } from "@/components/ui/empty"
import { ConnectorAddForm } from "@/components/settings/connector-add-form"
import { ConnectorChatForm } from "@/components/settings/connector-chat-form"
import {
  DeleteConnectorButton,
  TestConnectorButton,
} from "@/components/settings/connector-actions"

export const maxDuration = 60

export const metadata: Metadata = {
  title: "Workspace Connectors",
}

const SOURCE_INFO: Record<
  string,
  { label: string; icon: string; description: string; color: string }
> = {
  google_drive: {
    label: "Google Drive",
    icon: "📁",
    description: "Search documents, read Google Docs text, export Google Sheets to CSV, and inspect presentations.",
    color: "border-blue-500/20 bg-blue-500/5 text-blue-400",
  },
  slack: {
    label: "Slack",
    icon: "💬",
    description: "Search workspace conversation history, resolve thread replies, and lookup team members.",
    color: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
  },
  github: {
    label: "GitHub",
    icon: "🐙",
    description: "Search repo source code, retrieve files, and inspect issues, PR discussions, and code reviews.",
    color: "border-purple-500/20 bg-purple-500/5 text-purple-400",
  },
  discord: {
    label: "Discord",
    icon: "🎮",
    description: "Read server channels and post messages as your bot. Every post waits for approval.",
    color: "border-indigo-500/20 bg-indigo-500/5 text-indigo-400",
  },
  telegram: {
    label: "Telegram",
    icon: "✈️",
    description: "Read what people send your bot and reply to them. Every reply waits for approval.",
    color: "border-sky-500/20 bg-sky-500/5 text-sky-400",
  },
  whatsapp: {
    label: "WhatsApp",
    icon: "📱",
    description: "Send WhatsApp messages and templates from your business number. Every message waits for approval.",
    color: "border-green-500/20 bg-green-500/5 text-green-400",
  },
  onepassword: {
    label: "1Password",
    icon: "🔑",
    description: "Search item titles, and read a secret only after someone approves it.",
    color: "border-blue-500/20 bg-blue-500/5 text-blue-400",
  },
  bitwarden: {
    label: "Bitwarden",
    icon: "🔐",
    description: "Search secret names, and read a value only after someone approves it.",
    color: "border-amber-500/20 bg-amber-500/5 text-amber-400",
  },
  protonpass: {
    label: "Proton Pass",
    icon: "🛡️",
    description: "Looks up items through the Proton Pass app on a computer with Sayabot open.",
    color: "border-violet-500/20 bg-violet-500/5 text-violet-400",
  },
}

export default async function ConnectorsSettingsPage({
  params,
}: {
  params: Promise<{ org: string }>
}) {
  const { org: orgSlug } = await params
  const access = await requireOrgAdmin(orgSlug)
  if (!access) notFound()

  const [connectors, rooms, agents] = await Promise.all([
    listWorkspaceConnectors(access.org.id),
    listRooms(access.org.id),
    listOrgAgents(access.org.id),
  ])

  return (
    <div className="space-y-8">
      {/* 1. Educational Architectural Banner */}
      <div className="rounded-lg border border-accent/20 bg-accent/5 p-4">
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-[13px] font-semibold text-text">
            ⚡ Two-Tier Enterprise Connectors Architecture
          </h2>
          <p className="text-[12px] leading-relaxed text-muted">
            <strong>Tier 1 (Workspace Level):</strong> Connect your company tools once here with AES-256-GCM encryption. Credentials never leave the secure server.
            <br />
            <strong>Tier 2 (Agent Scoping):</strong> In each agent&apos;s settings, grant access to specific connectors and restrict allowed folders (Google Drive), channels (Slack), or repositories (GitHub). No agent can access resources outside its granted scope.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-muted">
          Looking for Notion, Jira, Linear, Canva, CRMs or finance apps? Over 200 more apps connect
          with a single sign-in from the Marketplace.
        </p>
        <Link
          href={`/${orgSlug}/marketplace`}
          className="shrink-0 text-[12px] font-medium text-accent hover:underline"
        >
          Open Marketplace →
        </Link>
      </div>

      {/* 2. Active Connectors */}
      <Section
        title="Active Workspace Connectors"
        description="Services currently connected to this workspace. Agents with assigned grants can query these tools natively."
      >
        {connectors.length === 0 ? (
          <EmptyState
            title="No connectors linked yet"
            body="Add Google Drive, Slack, GitHub, Discord, Telegram or WhatsApp below. For Notion, Jira, Linear, Canva and 200+ more, use the Marketplace."
          />
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-panel">
            {connectors.map((connector) => {
              const info = SOURCE_INFO[connector.source] ?? {
                label: connector.source,
                icon: "🔗",
                description: "External workspace connector",
                color: "border-accent/20 bg-accent/5 text-accent",
              }

              const isError = connector.status === "error"

              return (
                <div
                  key={connector.id}
                  className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{info.icon}</span>
                      <span className="font-medium text-text">{connector.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase font-semibold ${info.color}`}
                      >
                        {info.label}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${
                          isError
                            ? "bg-danger/10 text-danger"
                            : "bg-ok/10 text-ok"
                        }`}
                      >
                        {isError ? "● Error" : "● Active"}
                      </span>
                    </div>

                    <p className="text-[12px] text-muted">{info.description}</p>

                    {(connector.source === "telegram" || connector.source === "discord" || connector.source === "whatsapp") &&
                    rooms.length > 0 &&
                    agents.length > 0 ? (
                      <ConnectorChatForm
                        orgSlug={orgSlug}
                        connectorId={connector.id}
                        source={connector.source}
                        rooms={rooms}
                        agents={agents.map((agent) => ({ id: agent.id, handle: agent.handle, displayName: agent.displayName }))}
                        inbound={
                          (connector.config.inbound as {
                            enabled?: boolean
                            roomId?: string
                            agentId?: string
                            allowedChats?: string[]
                          } | undefined) ?? null
                        }
                      />
                    ) : null}

                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-faint">
                      <span>Key ends in <code className="font-mono text-text">...{connector.last4}</code></span>
                      {connector.lastSyncedAt && (
                        <span>
                          • Last verified: {new Date(connector.lastSyncedAt).toLocaleString()}
                        </span>
                      )}
                      {connector.errorMessage && (
                        <span className="text-danger">
                          • {connector.errorMessage}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <TestConnectorButton
                      orgSlug={orgSlug}
                      connectorId={connector.id}
                    />
                    <DeleteConnectorButton
                      orgSlug={orgSlug}
                      connectorId={connector.id}
                      name={connector.name}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* 3. Connect New Service */}
      <Section
        title="Connect a New Workspace Service"
        description="Add a new OAuth token or API key to link company knowledge to your workspace."
      >
        <div className="rounded-lg border border-border bg-panel p-4">
          <ConnectorAddForm orgSlug={orgSlug} />
        </div>
      </Section>
    </div>
  )
}
