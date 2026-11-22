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
        .string()
        .min(1)
        .describe(
          "The connector source or catalog app identifier (e.g. 'github', 'google_drive', 'slack', 'composio', 'clickup', 'linear', 'notion', 'sentry', 'stripe', 'jira', etc.). For apps like Gmail, Calendar, Notion, Linear, HubSpot via Composio, you can pass source: 'composio' with 'app' or pass the app name directly.",
        ),
      name: z.string().describe("Human readable name, e.g. 'GitHub', 'Slack', 'Composio', 'ClickUp'"),
      reason: z
        .string()
        .describe(
          "Clear explanation of why this connector is needed for the user's task and what connecting it will allow the bot to do",
        ),
      app: z
        .string()
        .optional()
        .describe(
          "Specific app toolkit slug when source is 'composio', e.g. 'gmail', 'linear', 'notion', 'googlecalendar'",
        ),
    }),
    dangerous: false,
    execute: async (input: {
      source: string
      name: string
      reason: string
      app?: string
    }) => {
      let source = input.source
      let app = input.app
      if (
        [
          "gmail",
          "googlecalendar",
          "calendar",
          "notion",
          "linear",
          "hubspot",
          "trello",
          "airtable",
          "zoom",
        ].includes(source)
      ) {
        app = app || source
        source = "composio"
      }
      return {
        ok: true,
        suggested: true,
        source,
        name: input.name,
        reason: input.reason,
        app,
      }
    },
  }
}
