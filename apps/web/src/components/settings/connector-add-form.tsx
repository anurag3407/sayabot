"use client"

import { useState } from "react"
import { ActionForm } from "@/components/ui/action-form"
import { Field, HelpText, Input, Select } from "@/components/ui/field"
import { saveWorkspaceConnector } from "@/lib/actions/connectors"

const CONNECTOR_SOURCES = [
  {
    value: "google_drive",
    label: "Google Drive (Docs, Sheets, Slides, Drive Search)",
    tokenLabel: "Google OAuth Access Token / Service Token",
    placeholder: "ya29.a0A... or Service Account Access Token",
    help: "Requires 'https://www.googleapis.com/auth/drive.readonly' scope. Agents can search, read Google Docs, and export Sheets to CSV.",
  },
  {
    value: "slack",
    label: "Slack (Channels, Discussions, Thread History)",
    tokenLabel: "Slack Bot User OAuth Token (xoxb-...)",
    placeholder: "xoxb-...",
    help: "Requires 'channels:history', 'channels:read', 'users:read', 'search:read' scopes. Agents can search conversations and resolve threads.",
  },
  {
    value: "github",
    label: "GitHub (Code Search, File Contents, PRs & Issues)",
    tokenLabel: "GitHub Personal Access Token (classic or fine-grained)",
    placeholder: "ghp_... or github_pat_...",
    help: "Requires 'repo' scope. Agents can search codebase symbols, read source files, and inspect issues and review comments.",
  },
]

export function ConnectorAddForm({ orgSlug }: { orgSlug: string }) {
  const [source, setSource] = useState<string>("google_drive")
  const current = CONNECTOR_SOURCES.find((s) => s.value === source) ?? CONNECTOR_SOURCES[0]!

  return (
    <ActionForm action={saveWorkspaceConnector} submitLabel="Connect Workspace Service" resetOnSuccess>
      <input type="hidden" name="orgSlug" value={orgSlug} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Connector Source" htmlFor="connector-source">
          <Select
            id="connector-source"
            name="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {CONNECTOR_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Connector Display Name" htmlFor="connector-name">
          <Input
            id="connector-name"
            name="name"
            placeholder={
              source === "google_drive"
                ? "Company Google Drive"
                : source === "slack"
                  ? "Engineering Slack"
                  : "Core GitHub Org"
            }
            required
          />
        </Field>
      </div>

      <Field label={current.tokenLabel} htmlFor="connector-token">
        <Input
          id="connector-token"
          name="token"
          type="password"
          placeholder={current.placeholder}
          required
        />
        <HelpText>{current.help}</HelpText>
      </Field>

      {source === "google_drive" && (
        <Field label="Google Drive Domain / Root Folder (Optional)" htmlFor="drive-domain">
          <Input
            id="drive-domain"
            name="driveDomain"
            placeholder="e.g. acme.com or 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
          />
          <HelpText>Limit searches to a specific Google Workspace domain or root folder ID.</HelpText>
        </Field>
      )}

      {source === "slack" && (
        <Field label="Default Channel / Team Domain (Optional)" htmlFor="slack-default">
          <Input
            id="slack-default"
            name="defaultChannel"
            placeholder="e.g. general or engineering"
          />
          <HelpText>Default fallback channel for message searches.</HelpText>
        </Field>
      )}

      {source === "github" && (
        <Field label="Default GitHub Org / Owner (Optional)" htmlFor="github-org">
          <Input
            id="github-org"
            name="defaultOrg"
            placeholder="e.g. sayalabs or vercel"
          />
          <HelpText>Default organization or user account to search repositories in.</HelpText>
        </Field>
      )}
    </ActionForm>
  )
}
