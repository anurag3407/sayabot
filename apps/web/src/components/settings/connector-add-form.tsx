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
  {
    value: "discord",
    label: "Discord (Read and post in server channels)",
    tokenLabel: "Discord bot token",
    placeholder: "MTE4…",
    help: "discord.com/developers → New Application → Bot → Reset Token. Turn on Message Content Intent, then invite the bot to your server (OAuth2 → URL Generator → bot, with Read Messages and Send Messages).",
  },
  {
    value: "telegram",
    label: "Telegram (Bot chats and channels)",
    tokenLabel: "Telegram bot token",
    placeholder: "123456789:ABC…",
    help: "Message @BotFather in Telegram, send /newbot, and paste the token it gives you. People start a chat with the bot; agents can read those chats and reply.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp Business (Send messages)",
    tokenLabel: "WhatsApp Cloud API access token",
    placeholder: "EAAG…",
    help: "Meta for Developers → your app → WhatsApp → API setup. Use a permanent System User token for anything beyond testing.",
  },
  {
    value: "onepassword",
    label: "1Password",
    tokenLabel: "Connect token or service-account token",
    placeholder: "ops_… or leave blank if the app is signed in",
    help: "Connect: your Connect server URL plus its token. Or tick the computer option and leave this blank if `op` is already signed in there.",
  },
  {
    value: "bitwarden",
    label: "Bitwarden",
    tokenLabel: "Secrets Manager access token or session key",
    placeholder: "0.… or leave blank if the app is signed in",
    help: "Secrets Manager: an access token. Or tick the computer option if `bw` is unlocked on that computer.",
  },
  {
    value: "protonpass",
    label: "Proton Pass",
    tokenLabel: "Leave blank if Proton Pass is signed in on this computer",
    placeholder: "optional",
    help: "Proton Pass runs through `pass-cli` on a computer with the Sayabot app open. Search returns titles only. Reading a secret waits for approval.",
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
                  : source === "discord"
                    ? "Community Discord"
                    : source === "telegram"
                      ? "Support bot"
                      : source === "whatsapp"
                        ? "Business WhatsApp"
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
          required={source !== "protonpass" && source !== "onepassword" && source !== "bitwarden"}
        />
        <HelpText>{current.help}</HelpText>
      </Field>

      {(source === "onepassword" || source === "bitwarden" || source === "protonpass") && source !== "protonpass" && (
        <label className="flex items-center gap-2 text-[13px] text-text">
          <input type="checkbox" name="onComputer" />
          Use the app signed in on a computer, instead of an API
        </label>
      )}
      {source === "onepassword" && (
        <Field label="1Password Connect URL" htmlFor="op-connect">
          <Input id="op-connect" name="connectUrl" placeholder="https://connect.example.com" />
          <HelpText>Only for Connect. Leave blank when using the app on a computer.</HelpText>
        </Field>
      )}
      {source === "bitwarden" && (
        <Field label="Bitwarden region" htmlFor="bw-region">
          <Select id="bw-region" name="region" defaultValue="us">
            <option value="us">bitwarden.com</option>
            <option value="eu">bitwarden.eu</option>
          </Select>
          <HelpText>Used for Secrets Manager. Ignored when the app runs on a computer.</HelpText>
        </Field>
      )}

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

      {source === "discord" && (
        <Field label="Discord server ID (Optional)" htmlFor="discord-guild">
          <Input id="discord-guild" name="guildId" inputMode="numeric" placeholder="e.g. 1180123456789012345" />
          <HelpText>Right-click your server → Copy Server ID (needs Developer Mode). Lets agents list its channels.</HelpText>
        </Field>
      )}

      {source === "whatsapp" && (
        <Field label="Phone number ID" htmlFor="wa-phone-id">
          <Input id="wa-phone-id" name="phoneNumberId" inputMode="numeric" placeholder="e.g. 106540352242922" required />
          <HelpText>Shown under API setup next to your business number. It&apos;s an ID, not the phone number itself.</HelpText>
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
