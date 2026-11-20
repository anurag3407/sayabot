import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { sql } from "drizzle-orm"
import type { AgentCapabilities } from "@sayabot/core"
import { DEFAULT_CAPABILITIES } from "@sayabot/core"
import { createDb, requireDatabaseUrl, type Db, type DbPool } from "./client"
import { modelPricing } from "./schema/ops"
import { type SecretSlot, agentTemplates } from "./schema/templates"

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

export const pricing = [
  { provider: "openai" as const, model: "gpt-4o", inputPerMtok: 2.5, outputPerMtok: 10 },
  { provider: "openai" as const, model: "gpt-4o-mini", inputPerMtok: 0.15, outputPerMtok: 0.6 },
  { provider: "openai" as const, model: "gpt-4.1", inputPerMtok: 2, outputPerMtok: 8 },
  { provider: "openai" as const, model: "gpt-4.1-mini", inputPerMtok: 0.4, outputPerMtok: 1.6 },
  { provider: "openai" as const, model: "o3-mini", inputPerMtok: 1.1, outputPerMtok: 4.4 },
  {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-20250514",
    inputPerMtok: 3,
    outputPerMtok: 15,
  },
  {
    provider: "anthropic" as const,
    model: "claude-opus-4-20250514",
    inputPerMtok: 15,
    outputPerMtok: 75,
  },
  {
    provider: "anthropic" as const,
    model: "claude-3-5-haiku-latest",
    inputPerMtok: 0.8,
    outputPerMtok: 4,
  },
  { provider: "google" as const, model: "gemini-2.5-pro", inputPerMtok: 1.25, outputPerMtok: 10 },
  { provider: "google" as const, model: "gemini-2.5-flash", inputPerMtok: 0.3, outputPerMtok: 2.5 },
  {
    provider: "groq" as const,
    model: "llama-3.3-70b-versatile",
    inputPerMtok: 0.59,
    outputPerMtok: 0.79,
  },
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
    description:
      "Full-stack implementation, git management, and test execution with a persistent computer.",
    icon: "code",
    category: "engineering",
    capabilities: {
      ...DEFAULT_CAPABILITIES,
      sandbox: true,
      computer: { profile: "standard" },
      github: true,
      postgres: true,
      secrets: true,
      tasks: true,
      canvas: true,
      memory: true,
      subagents: true,
    },
    secretSlots: [
      {
        envName: "GITHUB_TOKEN",
        label: "GitHub Token",
        kind: "api_token",
        hosts: ["api.github.com"],
        inject: { mode: "header", template: "Bearer {{secret}}" },
        required: false,
      },
    ],
    defaultModelHint: "claude-sonnet-4-20250514",
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
      document: false,
      github: false,
      postgres: false,
      mcp: false,
      computer: false,
      secrets: false,
      memory: true,
      subagents: true,
      cron: true,
      connectors: true,
      storage: false,
    },
    secretSlots: [],
    defaultModelHint: "gpt-4o-mini",
  },
]

export async function seedDatabase(db: Db, pool?: DbPool): Promise<void> {
  if (pool) {
    for (const p of pricing) {
      await pool.query(
        `INSERT INTO model_pricing (provider, model, input_per_mtok, output_per_mtok)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, model) DO NOTHING`,
        [p.provider, p.model, p.inputPerMtok, p.outputPerMtok],
      )
    }

    for (const t of CURATED_TEMPLATES) {
      const prompt = loadTemplatePrompt(t.slug)
      await pool.query(
        `INSERT INTO agent_templates (org_id, slug, name, description, icon, category, system_prompt, default_model, capabilities, secret_slots)
         VALUES (null, $1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (org_id, slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           icon = EXCLUDED.icon,
           category = EXCLUDED.category,
           system_prompt = EXCLUDED.system_prompt,
           default_model = EXCLUDED.default_model,
           capabilities = EXCLUDED.capabilities,
           secret_slots = EXCLUDED.secret_slots,
           updated_at = now()`,
        [
          t.slug,
          t.name,
          t.description,
          t.icon,
          t.category,
          prompt,
          t.defaultModelHint,
          JSON.stringify(t.capabilities),
          JSON.stringify(t.secretSlots),
        ],
      )
    }
    return
  }

  await db.insert(modelPricing).values(pricing).onConflictDoNothing()

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
}

/**
 * Creates default local organization, user, agent, and chat room.
 * Enables zero-config 1-click startup for Sayabot desktop on macOS & Windows.
 */
export async function seedLocalWorkspace(
  db: Db,
  pool: DbPool,
): Promise<{ orgId: string; userId: string; agentId: string; roomId: string }> {
  const userId = "00000000-0000-0000-0000-000000000001"
  const orgId = "00000000-0000-0000-0000-000000000002"
  const agentId = "00000000-0000-0000-0000-000000000003"
  const roomId = "00000000-0000-0000-0000-000000000004"

  // 1. Auth user
  await pool.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
     VALUES ($1, 'local@sayabot.local', '{"name":"Local Operator"}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [userId],
  )

  // 2. Profile
  await pool.query(
    `INSERT INTO profiles (id, display_name)
     VALUES ($1, 'Local Operator')
     ON CONFLICT (id) DO NOTHING`,
    [userId],
  )

  // 3. Organization
  await pool.query(
    `INSERT INTO orgs (id, name, slug)
     VALUES ($1, 'Local Workspace', 'local-workspace')
     ON CONFLICT (id) DO NOTHING`,
    [orgId],
  )

  // 4. Org member
  await pool.query(
    `INSERT INTO org_members (org_id, user_id, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    [orgId, userId],
  )

  // 5. Seed curated templates & pricing
  await seedDatabase(db, pool)

  // 6. Default Local Sayabot Agent
  await pool.query(
    `INSERT INTO agents (id, org_id, handle, display_name, bio, model, system_prompt, capabilities)
     VALUES ($1, $2, 'sayabot', 'Sayabot', 'Local autonomous assistant', 'gemini-2.5-flash', 'You are Sayabot, an autonomous agent working in a local workspace.', '{"sandbox":true,"canvas":true,"tasks":true,"memory":true,"computer":true}')
     ON CONFLICT (id) DO NOTHING`,
    [agentId, orgId],
  )

  // 7. Default Room
  await pool.query(
    `INSERT INTO rooms (id, org_id, name, created_by)
     VALUES ($1, $2, 'general', $3)
     ON CONFLICT (id) DO NOTHING`,
    [roomId, orgId, userId],
  )

  // 8. Agent in Room
  await pool.query(
    `INSERT INTO room_agents (room_id, agent_id, position)
     VALUES ($1, $2, 0)
     ON CONFLICT (room_id, agent_id) DO NOTHING`,
    [roomId, agentId],
  )

  return { orgId, userId, agentId, roomId }
}

async function seedCli() {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true })
  const url = requireDatabaseUrl()
  const { db, pool } = createDb(url)
  try {
    console.log("Seeding Sayabot database...")
    await seedDatabase(db)
    console.log(`Seeded curated templates and pricing.`)
  } finally {
    await pool.end()
  }
}

if (process.argv[1] === __filename) {
  void seedCli()
}
