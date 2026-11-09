import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { sql } from "drizzle-orm"
import type { AgentCapabilities } from "@sayabot/core"
import { DEFAULT_CAPABILITIES } from "@sayabot/core"
import { createDb, requireDatabaseUrl } from "./client"
import { modelPricing } from "./schema/ops"
import { type SecretSlot, agentTemplates } from "./schema/templates"

dotenv.config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true })

const { db, pool } = createDb(requireDatabaseUrl())

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function loadTemplatePrompt(slug: string): string {
  try {
    const filePath = path.join(__dirname, "templates", `${slug}.md`)
    return fs.readFileSync(filePath, "utf8").trim()
  } catch {
    return ""
  }
}

const pricing = [
  { provider: "openai" as const, model: "gpt-4o", inputPerMtok: 2.5, outputPerMtok: 10 },
  { provider: "openai" as const, model: "gpt-4o-mini", inputPerMtok: 0.15, outputPerMtok: 0.6 },
  { provider: "openai" as const, model: "gpt-4.1", inputPerMtok: 2, outputPerMtok: 8 },
  { provider: "openai" as const, model: "gpt-4.1-mini", inputPerMtok: 0.4, outputPerMtok: 1.6 },
  { provider: "openai" as const, model: "o3-mini", inputPerMtok: 1.1, outputPerMtok: 4.4 },
  { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", inputPerMtok: 3, outputPerMtok: 15 },
  { provider: "anthropic" as const, model: "claude-opus-4-20250514", inputPerMtok: 15, outputPerMtok: 75 },
  { provider: "anthropic" as const, model: "claude-3-5-haiku-latest", inputPerMtok: 0.8, outputPerMtok: 4 },
  { provider: "google" as const, model: "gemini-2.5-pro", inputPerMtok: 1.25, outputPerMtok: 10 },
  { provider: "google" as const, model: "gemini-2.5-flash", inputPerMtok: 0.3, outputPerMtok: 2.5 },
  { provider: "groq" as const, model: "llama-3.3-70b-versatile", inputPerMtok: 0.59, outputPerMtok: 0.79 },
  { provider: "cerebras" as const, model: "llama-3.3-70b", inputPerMtok: 0.85, outputPerMtok: 1.2 },
]

export interface CuratedTemplateSeed {
  slug: string
  name: string
  description: string
  icon: string
  category: string
  capabilities: AgentCapabilities
  secretSlots: SecretSlot[]
  defaultModelHint?: string
}

export const CURATED_TEMPLATES: CuratedTemplateSeed[] = [
  {
    slug: "researcher",
    name: "Researcher",
    description: "Deep web research, fact verification, and synthesized briefing docs on Canvas.",
    icon: "search",
    category: "research",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: { profile: "browser" },
      github: false,
      postgres: false,
      secrets: false,
    },
    secretSlots: [],
    defaultModelHint: "claude-sonnet-4-20250514",
  },
  {
    slug: "coder",
    name: "Coder",
    description: "Full-stack implementation, git management, and test execution with a persistent computer.",
    icon: "code",
    category: "engineering",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: { profile: "standard" },
      github: true,
      secrets: true,
    },
    secretSlots: [
      {
        envName: "GITHUB_TOKEN",
        label: "GitHub Personal Access Token (repo scope)",
        kind: "api_token",
        hosts: ["api.github.com", "github.com", "*.githubusercontent.com"],
        inject: { mode: "header", template: "Authorization: Bearer {secret}" },
        required: true,
        helpUrl: "https://github.com/settings/tokens",
      },
    ],
    defaultModelHint: "gpt-4o",
  },
  {
    slug: "reviewer",
    name: "Code Reviewer",
    description: "Pull request auditing, security review, and edge-case detection with GitHub bridge.",
    icon: "check-circle",
    category: "engineering",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: false,
      github: true,
      postgres: false,
      secrets: false,
    },
    secretSlots: [
      {
        envName: "GITHUB_TOKEN",
        label: "GitHub Token (read-only PR review)",
        kind: "api_token",
        hosts: ["api.github.com", "github.com"],
        inject: { mode: "header", template: "Authorization: Bearer {secret}" },
        required: false,
      },
    ],
    defaultModelHint: "claude-sonnet-4-20250514",
  },
  {
    slug: "designer",
    name: "Designer",
    description: "UI/UX component design, responsive visual validation, and SVG generation.",
    icon: "palette",
    category: "design",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: { profile: "browser" },
      github: false,
      postgres: false,
      secrets: false,
    },
    secretSlots: [],
    defaultModelHint: "gemini-2.5-pro",
  },
  {
    slug: "writer",
    name: "Writer",
    description: "Polished technical documentation, launch announcements, and marketing copy.",
    icon: "pen-tool",
    category: "writing",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: false,
      github: false,
      postgres: false,
      secrets: false,
    },
    secretSlots: [],
    defaultModelHint: "claude-sonnet-4-20250514",
  },
  {
    slug: "analyst",
    name: "Data Analyst",
    description: "Database inspection, SQL query optimization, and structured quantitative metrics.",
    icon: "bar-chart-2",
    category: "data",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: { profile: "standard" },
      github: false,
      postgres: true,
      secrets: true,
    },
    secretSlots: [
      {
        envName: "DATABASE_URL",
        label: "Read-only Database Connection String",
        kind: "api_token",
        hosts: ["*.supabase.co", "*.postgres.database.azure.com"],
        inject: { mode: "basic" },
        required: false,
      },
    ],
    defaultModelHint: "gpt-4o",
  },
  {
    slug: "ops",
    name: "Ops / On-call",
    description: "Incident triage, infrastructure health diagnostics, and on-call automation.",
    icon: "activity",
    category: "ops",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: false,
      computer: { profile: "standard" },
      github: false,
      postgres: false,
      secrets: true,
      mcp: true,
    },
    secretSlots: [
      {
        envName: "SLACK_BOT_TOKEN",
        label: "Slack Bot Token (alert notifications)",
        kind: "api_token",
        hosts: ["slack.com", "api.slack.com"],
        inject: { mode: "header", template: "Authorization: Bearer {secret}" },
        required: false,
      },
      {
        envName: "PAGERDUTY_TOKEN",
        label: "PagerDuty API Key",
        kind: "api_token",
        hosts: ["api.pagerduty.com"],
        inject: { mode: "header", template: "Token token={secret}" },
        required: false,
      },
    ],
    defaultModelHint: "gpt-4.1",
  },
  {
    slug: "assistant",
    name: "General Assistant",
    description: "All-purpose collaborator for project organization, task tracking, and discussions.",
    icon: "bot",
    category: "general",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
    },
    secretSlots: [],
    defaultModelHint: "gpt-4o",
  },
  {
    slug: "blank",
    name: "Blank",
    description: "Clean slate with minimal tools for custom agent persona design.",
    icon: "plus-circle",
    category: "general",
    capabilities: {
      canvas: true,
      tasks: true,
      sandbox: false,
      webSearch: false,
      github: false,
      postgres: false,
      mcp: false,
      computer: false,
      secrets: false,
      memory: true,
      subagents: true,
      cron: true,
    },
    secretSlots: [],
    defaultModelHint: "gpt-4o-mini",
  },
]

try {
  await db.insert(modelPricing).values(pricing).onConflictDoNothing()
  console.log(`Seeded ${pricing.length} model prices (existing rows untouched).`)

  for (const t of CURATED_TEMPLATES) {
    const prompt = loadTemplatePrompt(t.slug)
    await db
      .insert(agentTemplates)
      .values({
        orgId: null,
        slug: t.slug,
        name: t.name,
        description: t.description,
        icon: t.icon,
        category: t.category,
        systemPrompt: prompt,
        defaultModel: t.defaultModelHint,
        capabilities: t.capabilities,
        secretSlots: t.secretSlots,
      })
      .onConflictDoUpdate({
        target: [agentTemplates.orgId, agentTemplates.slug],
        set: {
          name: t.name,
          description: t.description,
          icon: t.icon,
          category: t.category,
          systemPrompt: prompt,
          defaultModel: t.defaultModelHint,
          capabilities: t.capabilities,
          secretSlots: t.secretSlots,
          updatedAt: sql`now()`,
        },
      })
  }
  console.log(`Seeded ${CURATED_TEMPLATES.length} curated agent templates.`)
} finally {
  await pool.end()
}
