"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  saveAgentConnectorGrant,
  deleteAgentConnectorGrant,
} from "@/lib/actions/connectors"
import { Button } from "@/components/ui/button"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import type { AgentConnectorGrantView, WorkspaceConnectorView } from "@/lib/types"

export function AgentConnectorScopeManager({
  orgSlug,
  agentId,
  grants,
  availableConnectors,
  canEdit,
}: {
  orgSlug: string
  agentId: string
  grants: AgentConnectorGrantView[]
  availableConnectors: WorkspaceConnectorView[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>(
    availableConnectors[0]?.id ?? "",
  )
  const [allowedFolders, setAllowedFolders] = useState("")
  const [allowedChannels, setAllowedChannels] = useState("")
  const [allowedRepos, setAllowedRepos] = useState("")

  const selectedConnector = availableConnectors.find((c) => c.id === selectedConnectorId)

  function handleAddGrant(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedConnectorId) return
    setError(null)

    const formData = new FormData()
    formData.append("orgSlug", orgSlug)
    formData.append("agentId", agentId)
    formData.append("connectorId", selectedConnectorId)
    if (allowedFolders) formData.append("allowedFolders", allowedFolders)
    if (allowedChannels) formData.append("allowedChannels", allowedChannels)
    if (allowedRepos) formData.append("allowedRepos", allowedRepos)

    startTransition(async () => {
      const res = await saveAgentConnectorGrant(null, formData)
      if (!res.ok) {
        setError(res.error ?? "Failed to grant connector")
      } else {
        setAllowedFolders("")
        setAllowedChannels("")
        setAllowedRepos("")
        router.refresh()
      }
    })
  }

  function handleRevoke(grantId: string) {
    if (!confirm("Revoke this connector grant from the agent?")) return
    setError(null)
    startTransition(async () => {
      const res = await deleteAgentConnectorGrant({ orgSlug, grantId })
      if (!res.ok) {
        setError(res.error ?? "Failed to revoke grant")
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Workspace Knowledge Connectors
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tier-2 scoping: grant access to company Google Drive, Slack, or GitHub with strict boundaries.
          </p>
        </div>
        <Link
          href={`/${orgSlug}/settings/connectors`}
          className="text-xs text-primary font-medium hover:underline"
        >
          Manage Connectors →
        </Link>
      </div>

      {/* Current Grants */}
      {grants.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No workspace connectors granted to this bot. Add one below to let this agent search Drive, Slack, or GitHub.
        </p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-panel">
          {grants.map((grant) => {
            const conn = grant.connector
            const source = conn?.source ?? "unknown"
            const scopes = grant.scopeConfig

            return (
              <div
                key={grant.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">
                      {conn?.name ?? "Connector"}
                    </span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                      {source}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {scopes.allowedFolders && scopes.allowedFolders.length > 0 && (
                      <span>Folders: {scopes.allowedFolders.join(", ")}</span>
                    )}
                    {scopes.allowedChannels && scopes.allowedChannels.length > 0 && (
                      <span>Channels: #{scopes.allowedChannels.join(", #")}</span>
                    )}
                    {scopes.allowedRepos && scopes.allowedRepos.length > 0 && (
                      <span>Repos: {scopes.allowedRepos.join(", ")}</span>
                    )}
                    {!scopes.allowedFolders?.length &&
                      !scopes.allowedChannels?.length &&
                      !scopes.allowedRepos?.length && (
                        <span className="text-faint">Full workspace access for this connector</span>
                      )}
                  </div>
                </div>

                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px] text-danger hover:bg-danger/10 hover:text-danger self-end sm:self-center"
                    disabled={pending}
                    onClick={() => handleRevoke(grant.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Grant Form */}
      {canEdit && availableConnectors.length > 0 && (
        <form onSubmit={handleAddGrant} className="pt-2 border-t border-border space-y-3">
          <h4 className="text-xs font-semibold text-foreground">Grant Connector Access</h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Select Workspace Connector" htmlFor="grant-connector">
              <Select
                id="grant-connector"
                value={selectedConnectorId}
                onChange={(e) => setSelectedConnectorId(e.target.value)}
              >
                {availableConnectors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.source})
                  </option>
                ))}
              </Select>
            </Field>

            {selectedConnector?.source === "google_drive" && (
              <Field label="Allowed Folder IDs (comma-separated)" htmlFor="grant-folders">
                <Input
                  id="grant-folders"
                  placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                  value={allowedFolders}
                  onChange={(e) => setAllowedFolders(e.target.value)}
                />
                <HelpText>Leave blank to allow searching all accessible folders.</HelpText>
              </Field>
            )}

            {selectedConnector?.source === "slack" && (
              <Field label="Allowed Channels (comma-separated)" htmlFor="grant-channels">
                <Input
                  id="grant-channels"
                  placeholder="e.g. general, announcements, releases"
                  value={allowedChannels}
                  onChange={(e) => setAllowedChannels(e.target.value)}
                />
                <HelpText>Leave blank to allow searching all channels bot is in.</HelpText>
              </Field>
            )}

            {selectedConnector?.source === "github" && (
              <Field label="Allowed Repositories (owner/repo)" htmlFor="grant-repos">
                <Input
                  id="grant-repos"
                  placeholder="e.g. sayalabs/saaya, acme/frontend"
                  value={allowedRepos}
                  onChange={(e) => setAllowedRepos(e.target.value)}
                />
                <HelpText>Leave blank to allow searching all authorized repos.</HelpText>
              </Field>
            )}
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <Button type="submit" size="sm" disabled={pending || !selectedConnectorId}>
            {pending ? "Granting…" : "Grant Scoped Access"}
          </Button>
        </form>
      )}
    </div>
  )
}
