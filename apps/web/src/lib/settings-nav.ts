/**
 * The one list of settings destinations. The settings sidebar, the overview page, the rail
 * popover and the phone drawer all read from here so they cannot drift apart again.
 */
export type SettingsIconKey =
  "profile" | "workspace" | "keys" | "vector" | "vault" | "tools" | "bots" | "pricing"

export interface SettingsLink {
  segment: string
  label: string
  description: string
  icon: SettingsIconKey
  adminOnly: boolean
}

export interface SettingsGroup {
  label: string
  links: SettingsLink[]
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Account",
    links: [
      {
        segment: "profile",
        label: "Profile & alerts",
        description: "Your name, avatar, @handle and which notifications reach you.",
        icon: "profile",
        adminOnly: false,
      },
    ],
  },
  {
    label: "Workspace",
    links: [
      {
        segment: "workspace",
        label: "General & members",
        description: "Workspace name, invites, roles, SSO and the audit log.",
        icon: "workspace",
        adminOnly: true,
      },
      {
        segment: "keys",
        label: "Models & keys",
        description: "Provider API keys and AI accounts that power your agents.",
        icon: "keys",
        adminOnly: true,
      },
      {
        segment: "pricing",
        label: "Pricing & budgets",
        description: "Per-model token prices used to enforce spend limits.",
        icon: "pricing",
        adminOnly: true,
      },
    ],
  },
  {
    label: "Agents & tools",
    links: [
      {
        segment: "tools",
        label: "Tools & MCP",
        description: "Built-in tools, web search and external MCP servers.",
        icon: "tools",
        adminOnly: true,
      },
      {
        segment: "bots",
        label: "External agents",
        description: "Bring Claude Code, ChatGPT, Cursor or your own bot into rooms.",
        icon: "bots",
        adminOnly: true,
      },
      {
        segment: "vault",
        label: "Secret vault",
        description: "Sealed credentials agents can use without ever seeing them.",
        icon: "vault",
        adminOnly: true,
      },
      {
        segment: "vector",
        label: "Memory & RAG",
        description: "Vector database and embedding model for long-term recall.",
        icon: "vector",
        adminOnly: true,
      },
    ],
  },
]

export function visibleSettingsGroups(isAdmin: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => isAdmin || !link.adminOnly),
  })).filter((group) => group.links.length > 0)
}
