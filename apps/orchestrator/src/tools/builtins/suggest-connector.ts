import { z } from "zod"
import type { ToolSpec } from "../audited"

export interface SuggestConnectorOptions {
  orgId: string
  agentId: string
  roomId: string
}

export function suggestConnectorTool(_opts: SuggestConnectorOptions): ToolSpec {
  return {
    name: "suggest_connector",
    description:
      "Proactively suggest connecting a workspace service (GitHub, Google Drive, Slack, Composio, Jira, Notion, Linear, Discord, Telegram, WhatsApp, 1Password, Bitwarden, etc.) directly in the chat with an interactive button when the user requests an external integration task that is not yet connected or granted.",
    schema: z.object({
      source: z
        .enum([
          "github",
          "google_drive",
          "slack",
          "composio",
          "jira",
          "discord",
          "telegram",
          "whatsapp",
          "onepassword",
          "bitwarden",
          "protonpass",
          "supabase",
          "cloudflare_r2",
          "notion",
          "linear",
          "gmail",
          "googlecalendar",
        ])
        .describe("The connector source or platform identifier"),
      name: z.string().describe("Human readable name, e.g. 'GitHub', 'Slack', 'Composio'"),
      reason: z
        .string()
        .describe(
          "Clear explanation of why this connector is needed for the user's task and what connecting it will allow the bot to do",
        ),
      app: z
        .string()
        .optional()
        .describe("Specific app toolkit slug for Composio, e.g. 'gmail', 'linear', 'notion'"),
    }),
    dangerous: false,
    execute: async (input: {
      source: string
      name: string
      reason: string
      app?: string
    }) => {
      return {
        ok: true,
        suggested: true,
        source: input.source,
        name: input.name,
        reason: input.reason,
        app: input.app,
      }
    },
  }
}
