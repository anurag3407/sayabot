import { z } from "zod"
import type { ToolSpec } from "../tools/audited"

export const TOOL_SEARCH_THRESHOLD = 40

export const ALWAYS_CORE_TOOLS = new Set([
  "fs_read",
  "fs_edit",
  "fs_write",
  "fs_glob",
  "fs_grep",
  "computer_shell",
  "git_status",
  "git_diff",
  "git_commit",
  "git_push",
  "update_plan",
  "spawn_subagent",
  "remember",
  "recall",
  "forget",
  "canvas_read",
  "canvas_write",
  "canvas_patch",
  "find_tools",
  "load_skill",
  "propose_skill",
  "search_skills",
  "code_outline",
  "code_definition",
  "code_references",
  "code_diagnostics",
  "workspace_detect",
  "workspace_fork",
  "workspace_inspect",
  "verify_workspace",
  "subagent_status",
  "report_findings",
])

export interface IndexedToolDoc {
  name: string
  description: string
  spec: ToolSpec
  tokens: string[]
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/**
 * Pure BM25 search over tool specifications.
 */
export class ToolIndex {
  private docs: IndexedToolDoc[] = []
  private docFrequencies: Map<string, number> = new Map()
  private avgDocLen = 0

  constructor(tools: ToolSpec[]) {
    let totalLen = 0
    this.docs = tools.map((spec) => {
      const text = `${spec.name} ${spec.description}`
      const tokens = tokenize(text)
      totalLen += tokens.length

      const uniqueTokens = new Set(tokens)
      for (const token of uniqueTokens) {
        this.docFrequencies.set(token, (this.docFrequencies.get(token) ?? 0) + 1)
      }

      return {
        name: spec.name,
        description: spec.description,
        spec,
        tokens,
      }
    })

    this.avgDocLen = this.docs.length > 0 ? totalLen / this.docs.length : 1
  }

  search(query: string, limit = 8): ToolSpec[] {
    const qTokens = tokenize(query)
    if (qTokens.length === 0) return []

    const k1 = 1.2
    const b = 0.75
    const N = this.docs.length

    const scores = this.docs.map((doc) => {
      let score = 0
      const tokenCounts = new Map<string, number>()
      for (const t of doc.tokens) {
        tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1)
      }

      for (const qt of qTokens) {
        const tf = tokenCounts.get(qt) ?? 0
        if (tf === 0) continue

        const df = this.docFrequencies.get(qt) ?? 1
        // Standard BM25 IDF formula
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
        const numerator = tf * (k1 + 1)
        const denominator = tf + k1 * (1 - b + b * (doc.tokens.length / this.avgDocLen))
        score += idf * (numerator / denominator)
      }

      // Name exact match boost
      if (doc.name.toLowerCase().includes(query.toLowerCase())) {
        score += 2.0
      }

      return { doc, score }
    })

    return scores
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.doc.spec)
  }
}

export const findToolsSchema = z.object({
  query: z.string().min(1).describe("Search keywords for tool capabilities or operations (e.g. 'stripe payments', 'linear issues')"),
})

export function buildFindToolsSpec(args: {
  allSpecs: ToolSpec[]
  onToolsFound?: (tools: ToolSpec[]) => void
}): ToolSpec {
  const index = new ToolIndex(args.allSpecs)

  return {
    name: "find_tools",
    description:
      "Searches the workspace MCP tools catalog when you need capabilities not currently exposed in your active tools.",
    schema: findToolsSchema,
    dangerous: false,
    execute: async ({ query }: { query: string }) => {
      const matches = index.search(query, 8)
      if (args.onToolsFound) {
        args.onToolsFound(matches)
      }
      return {
        query,
        count: matches.length,
        tools: matches.map((m) => ({
          name: m.name,
          description: m.description,
        })),
        hint:
          matches.length > 0
            ? "These tools have been activated for you. You can call them in subsequent steps."
            : "No matching tools found in the catalog.",
      }
    },
  }
}

/**
 * Splits tools into an always-exposed core and a searchable catalog when the
 * total exceeds TOOL_SEARCH_THRESHOLD.
 *
 * `all` holds every spec (core, catalog and find_tools) so each one can be
 * registered with the model call; `activeToolNames()` returns the subset to
 * expose on the next step (core + find_tools + whatever find_tools has
 * activated so far). When no partitioning happens, `activeToolNames()`
 * returns undefined, meaning every tool is active.
 */
export function partitionToolsForSearch(
  specs: ToolSpec[],
): {
  exposed: ToolSpec[]
  all: ToolSpec[]
  searchTool?: ToolSpec
  activeToolNames: () => string[] | undefined
} {
  specs = [...specs].sort((a, b) => a.name.localeCompare(b.name))
  if (specs.length <= TOOL_SEARCH_THRESHOLD) {
    return { exposed: specs, all: specs, activeToolNames: () => undefined }
  }

  const core: ToolSpec[] = []
  const nonCore: ToolSpec[] = []

  for (const s of specs) {
    if (ALWAYS_CORE_TOOLS.has(s.name)) {
      core.push(s)
    } else {
      nonCore.push(s)
    }
  }

  const activated = new Set<string>()
  const searchTool = buildFindToolsSpec({
    allSpecs: nonCore,
    onToolsFound: (found) => {
      for (const t of found) activated.add(t.name)
    },
  })

  const exposed = [...core, searchTool]
  return {
    exposed,
    all: [...exposed, ...nonCore].sort((a, b) => a.name.localeCompare(b.name)),
    searchTool,
    activeToolNames: () => [...exposed.map((s) => s.name), ...activated].sort(),
  }
}
